import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { getDigEditsSnapshot } from "../terrain.js";
import type { ClodPageNode, PageFootprint } from "../types.js";
import {
  TreeGpuRingCompute,
  treeGpuRingComputeUnsupportedReason,
  treeGpuRingGroupCapacity,
  treeGpuRingGroupIndex,
  TREE_GPU_RING_GROUP_COUNT,
  treeGpuRingKey,
  treeGpuRingSlotCount,
  type TreeGpuRingStats,
  type TreeGpuRingOutputBuffers,
  type TreeGpuRingIndexCounts,
} from "../gpu/tree_ring_compute.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import {
  TREE_LODS,
  TREE_SPECIES,
  type TreeLod,
  type TreeSettings,
  type TreeSpeciesId,
} from "./tree_config.js";
import {
  disposeTreeGeometryMap,
  createTreeBakedImpostorGeometry,
  createTreeGeometryMap,
  treeGeometryKey,
  type TreeGeometryMap,
} from "./tree_geometry.js";
import {
  bakeTreeImpostorAtlases,
  type TreeImpostorAtlas,
} from "./tree_impostor_baker.js";
import {
  createTreeImpostorMaterial,
  updateTreeImpostorMaterialSettings,
} from "./tree_impostor_material.js";
import { octFrameIndexForDirection } from "./tree_impostor_octahedral.js";
import { selectTreeLod, treeLodDistances } from "./tree_lod.js";
import {
  emptyTreeGenerationStats,
  generateTreeInstances,
  type TreeGenerationStats,
  type TreeInstance,
  type TreeTerrainSampler,
} from "./tree_instances.js";
import { createTreeMaterialHandle, type TreeMaterialHandle } from "./tree_material.js";
import {
  createTreeNodeMaterialHandle,
  createTreeRingNodeMaterialHandle,
  type TreeRingInstanceBuffers,
} from "./tree_node_material.js";
import type { EnvironmentLighting } from "../environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";

const TREE_BOUNDS_REFRESH_DISTANCE_M = 1.0;
const TREE_INSTANCE_ATTRIBUTE_EPSILON = 1e-5;

export interface TreeSystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
  impostorAtlases?: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  /** Use the WebGPU node material path instead of the classic WebGL material. */
  webgpu?: boolean;
  /** Initial lighting for the WebGPU node material path. */
  lighting?: EnvironmentLighting;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: TreeWebGpuBackendAccess | null;
  supportsGpuTrees?: boolean;
}

export interface TreeWebGpuBackendAccess {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export interface TreeStats extends TreeGenerationStats {
  totalTrees: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  nearTrees: number;
  midTrees: number;
  farTrees: number;
  impostorTrees: number;
  gpuStatus: "disabled" | "unsupported" | "ready" | "fallback-cpu" | "error";
  gpuCandidateCount: number;
  gpuVisibleCount: number;
  gpuOverflowed: boolean;
  gpuDispatchMs: number | null;
  gpuReadbackMs: number | null;
  gpuShowCounts: boolean;
  impostorStatus: TreeImpostorStatus;
  impostorReason: string | null;
}

export type TreeImpostorStatus = "disabled" | "pending" | "baking" | "baked" | "fallback";

export interface TreeLightingProxy {
  x: number;
  z: number;
  height: number;
  scale: number;
  crownRadius: number;
  species: TreeSpeciesId;
}

interface TreePatch {
  nodeId: string;
  footprint: PageFootprint;
  centerX: number;
  centerZ: number;
  radius: number;
  instances: TreeInstance[];
  group: THREE.Group;
  meshes: Record<TreeSpeciesId, Record<TreeLod, THREE.InstancedMesh>>;
  previousLods: (TreeLod | null)[];
  visible: boolean;
  generationStats: TreeGenerationStats;
}

interface TreeMeshBoundsState {
  count: number;
  centerX: number;
  centerZ: number;
  hasBounds: boolean;
}

/** Per-frame per-mesh write bookkeeping shared by the CPU and GPU LOD paths. */
interface TreeMeshWriteState {
  counts: Map<THREE.InstancedMesh, number>;
  matrixChanged: Map<THREE.InstancedMesh, boolean>;
  worldXZChanged: Map<THREE.InstancedMesh, boolean>;
  impostorUvChanged: Map<THREE.InstancedMesh, boolean>;
  fadeChanged: Map<THREE.InstancedMesh, boolean>;
}

type TreeGpuRingMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;

type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

interface TreeGpuRingDrawResources {
  meshes: TreeGpuRingMesh[];
  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  outputBuffers: TreeGpuRingOutputBuffers;
  materialHandles: Record<TreeLod, TreeMaterialHandle>;
}

export class TreeSystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly sampler: TreeTerrainSampler | undefined;
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: TreeWebGpuBackendAccess | null;
  private readonly supportsGpuTrees: boolean;
  private readonly gpuRingUnsupportedReason: string | null;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly translation = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private settings: TreeSettings;
  private geometries: TreeGeometryMap;
  private geometryKey: string;
  private impostorStatus: TreeImpostorStatus = "disabled";
  private impostorReason: string | null = null;
  private bakedImpostorGeometries: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>> = {};
  private impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>> = {};
  private impostorMaterials: Partial<Record<TreeSpeciesId, THREE.Material>> = {};
  private readonly materialHandle: TreeMaterialHandle;
  private readonly meshBoundsState = new WeakMap<THREE.InstancedMesh, TreeMeshBoundsState>();
  private patches: TreePatch[] = [];
  private patchesDirty = true;
  private gpuStatus: TreeStats["gpuStatus"] = "disabled";
  private gpuVisibleCount = 0;
  private gpuOverflowed = false;
  private gpuDispatchMs: number | null = null;
  private gpuReadbackMs: number | null = null;
  private gpuLoggedError: string | null = null;
  private gpuRingCompute: TreeGpuRingCompute | null = null;
  private gpuRingInit: Promise<void> | null = null;
  private gpuRingKey = "";
  private gpuRingDraw: TreeGpuRingDrawResources | null = null;
  private ringMeshes: TreeGpuRingMesh[] = [];
  private gpuRingStats: TreeGpuRingStats = {
    status: "disabled",
    candidateCount: 0,
    acceptedCandidates: 0,
    counts: { near: 0, mid: 0, far: 0, impostor: 0 },
    groupCounts: new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0),
    dispatchMs: null,
    readbackMs: null,
    skippedDispatches: 0,
  };
  private readonly frustumPlaneScratch = new Float32Array(24);
  private hasGpuRingFrustum = false;
  private currentLighting: EnvironmentLighting | undefined;
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly lastCenter: THREE.Vector3;
  // Visible instance count per *primary* LOD (crossfade secondary draws excluded),
  // so the reported LOD distribution still sums to the visible instance count.
  private readonly lodCounts: Record<TreeLod, number> = { near: 0, mid: 0, far: 0, impostor: 0 };
  private stats: TreeStats = emptyTreeStats();

  constructor(options: TreeSystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = { ...options.settings };
    this.sampler = options.sampler;
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    this.supportsGpuTrees = options.supportsGpuTrees ?? !!this.gpuDevice;
    this.gpuRingUnsupportedReason = this.gpuDevice
      ? treeGpuRingComputeUnsupportedReason(this.gpuDevice)
      : null;
    this.geometries = createTreeGeometryMap(this.settings);
    this.geometryKey = treeGeometryKey(this.settings);
    if (options.impostorAtlases) this.setImpostorAtlases(options.impostorAtlases);
    this.impostorStatus = this.settings.impostors.enabled && this.settings.impostors.bakeOnStart
      ? "pending"
      : "disabled";
    this.currentLighting = options.lighting;
    this.materialHandle = options.webgpu
      ? createTreeNodeMaterialHandle(this.settings, options.lighting)
      : createTreeMaterialHandle(this.settings);
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.root.name = "trees";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled && !this.usesGpuRingDraw()) this.rebuild();
  }

  updateLighting(lighting: EnvironmentLighting): void {
    this.currentLighting = lighting;
    this.materialHandle.updateLighting?.(lighting);
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.updateLighting?.(lighting);
    }
  }

  updateForestLighting(state: ForestLightingMaterialState | null): void {
    this.materialHandle.updateForestLighting?.(state);
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.updateForestLighting?.(state);
    }
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled && !wasEnabled && !this.usesGpuRingDraw()) this.refreshForCenter(this.lastCenter);
    if (!enabled) {
      this.resetLodCounts();
      this.updateStats();
    }
  }

  updateSettings(settings: Partial<TreeSettings>): void {
    Object.assign(this.settings, settings);
    const nextGeometryKey = treeGeometryKey(this.settings);
    const needsGeometry = nextGeometryKey !== this.geometryKey;
    const needsPatchRefresh =
      needsGeometry ||
      settings.enabled !== undefined ||
      settings.seed !== undefined ||
      settings.distanceM !== undefined ||
      settings.refreshDistanceM !== undefined ||
      settings.maxInstances !== undefined ||
      settings.placement !== undefined ||
      settings.lod !== undefined;
    if (settings.gpu) {
      this.clearGpuRing();
      if (!settings.gpu.enabled) this.gpuStatus = "disabled";
      else if (settings.gpu.debugForceCpu) this.gpuStatus = "fallback-cpu";
    }
    if (needsGeometry) {
      this.geometryKey = nextGeometryKey;
      disposeTreeGeometryMap(this.geometries);
      this.geometries = createTreeGeometryMap(this.settings);
      this.disposeBakedImpostorGeometries();
      this.clearPatches();
    }
    this.materialHandle.updateSettings(this.settings);
    this.updateImpostorMaterials();
    this.applyMaterials();
    if (needsPatchRefresh) this.patchesDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  update(timeSeconds: number, center: THREE.Vector3, cameraPosition?: THREE.Vector3): void {
    this.materialHandle.setTime(timeSeconds);
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.setTime(timeSeconds);
      handle.setFadeCenter?.(center.x, center.z);
    }
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.resetLodCounts();
      this.updateStats();
      return;
    }
    if (this.usesGpuRingDraw()) {
      if (this.patches.length > 0) this.clearPatches();
      if (this.updateGpuRingTrees(center, cameraPosition ?? center)) return;
    } else {
      this.clearGpuRing();
    }
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
      this.refreshForCenter(center);
    }
    this.updatePatchLods(center, cameraPosition ?? center);
  }

  rebuild(): void {
    this.clearPatches();
    this.clearGpuRing();
    if (this.usesGpuRingDraw()) {
      this.updateStats();
      return;
    }
    if (this.settings.enabled) this.refreshForCenter(this.lastCenter);
    this.root.visible = this.settings.enabled;
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    const retained: TreePatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) this.removePatch(patch);
      else retained.push(patch);
    }
    this.patches = retained;
    this.refreshForCenter(this.lastCenter);
  }

  dispose(): void {
    this.clearGpuRing();
    this.clearPatches();
    this.scene.remove(this.root);
    disposeTreeGeometryMap(this.geometries);
    this.disposeBakedImpostorGeometries();
    this.disposeImpostorMaterials();
    for (const atlas of Object.values(this.impostorAtlases)) atlas?.dispose();
    this.materialHandle.dispose();
  }

  getStats(): TreeStats {
    this.updateStats();
    return { ...this.stats };
  }

  getLightingProxies(): TreeLightingProxy[] {
    if (!this.settings.enabled) return [];
    const proxies: TreeLightingProxy[] = [];
    for (const patch of this.patches) {
      if (!patch.visible) continue;
      for (const instance of patch.instances) {
        const species = this.settings.species[instance.species];
        const crownRadius = species.crownRadiusM * instance.scale;
        proxies.push({
          x: instance.position[0],
          z: instance.position[2],
          height: (species.trunkHeightM + species.crownRadiusM * 2) * instance.scale,
          scale: instance.scale,
          crownRadius,
          species: instance.species,
        });
      }
    }
    return proxies;
  }

  async bakeImpostors(renderer: unknown): Promise<{ supported: boolean; reason: string | null }> {
    if (!this.settings.impostors.enabled || !this.settings.impostors.bakeOnStart) {
      this.impostorStatus = "disabled";
      this.impostorReason = "tree impostor baking disabled";
      return { supported: false, reason: this.impostorReason };
    }
    this.impostorStatus = "baking";
    this.impostorReason = null;
    const result = await bakeTreeImpostorAtlases({
      renderer,
      settings: this.settings,
      geometries: this.geometries,
      material: this.materialHandle.regularMaterial,
    });
    if (result.supported) {
      this.setImpostorAtlases(result.atlases);
      this.applyMaterials();
      this.replaceImpostorMeshGeometries();
      this.updatePatchLods(this.lastCenter, this.lastCenter);
      this.impostorStatus = "baked";
      this.impostorReason = null;
    } else {
      this.impostorStatus = "fallback";
      this.impostorReason = result.reason;
    }
    return { supported: result.supported, reason: result.reason };
  }

  private setImpostorAtlases(atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>): void {
    for (const atlas of Object.values(this.impostorAtlases)) atlas?.dispose();
    this.impostorAtlases = { ...atlases };
    this.disposeImpostorMaterials();
    this.updateImpostorMaterials();
  }

  private refreshForCenter(center: THREE.Vector3): void {
    this.lastRefreshCenter.copy(center);
    this.patchesDirty = false;
    const distance = this.settings.distanceM;
    const retained: TreePatch[] = [];
    for (const patch of this.patches) {
      if (distance2d(center.x, center.z, patch.centerX, patch.centerZ) > distance + patch.radius) {
        this.removePatch(patch);
      } else {
        retained.push(patch);
      }
    }
    this.patches = retained;

    const existing = new Set(this.patches.map((patch) => patch.nodeId));
    const candidates = this.nodes
      .filter((node) => !existing.has(node.id))
      .map((node) => ({ node, distance: distance2d(center.x, center.z, footprintCenterX(node.footprint), footprintCenterZ(node.footprint)) }))
      .filter(({ node, distance: d }) => d <= distance + footprintRadius(node.footprint))
      .sort((a, b) => a.distance - b.distance);
    let totalTrees = this.patches.reduce((sum, patch) => sum + patch.instances.length, 0);
    let added = 0;
    for (const { node } of candidates) {
      if (added >= this.settings.maxNewPatchesPerFrame || totalTrees >= this.settings.maxInstances) break;
      const patch = this.createPatch(node, this.settings.maxInstances - totalTrees);
      totalTrees += patch.instances.length;
      this.patches.push(patch);
      this.root.add(patch.group);
      added++;
    }

    if (added < candidates.length) this.patchesDirty = true;
    this.updatePatchLods(center, center);
  }

  private createPatch(node: ClodPageNode, capacityLeft: number): TreePatch {
    const generationStats = emptyTreeGenerationStats();
    const instances = generateTreeInstances(
      node.footprint,
      this.settings,
      capacityLeft,
      generationStats,
      this.sampler,
      this.worldCells,
    );
    const group = new THREE.Group();
    group.name = `tree-patch-${node.id}`;
    const centerX = footprintCenterX(node.footprint);
    const centerZ = footprintCenterZ(node.footprint);
    group.position.set(centerX, 0, centerZ);
    const meshes = {} as Record<TreeSpeciesId, Record<TreeLod, THREE.InstancedMesh>>;
    for (const species of TREE_SPECIES) {
      const speciesCapacity = Math.max(1, instances.filter((instance) => instance.species === species).length);
      meshes[species] = {} as Record<TreeLod, THREE.InstancedMesh>;
      for (const lod of TREE_LODS) {
        const geometry = this.geometryFor(species, lod).clone();
        geometry.setAttribute("treeWorldXZ", new THREE.InstancedBufferAttribute(
          new Float32Array(speciesCapacity * 2),
          2,
        ));
        geometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(
          new Float32Array(speciesCapacity).fill(1),
          1,
        ));
        if (lod === "impostor") {
          geometry.setAttribute("treeImpostorUvRect", new THREE.InstancedBufferAttribute(
            new Float32Array(speciesCapacity * 4),
            4,
          ));
        }
        const mesh = new THREE.InstancedMesh(
          geometry,
          this.materialFor(species, lod),
          speciesCapacity,
        );
        mesh.name = `trees-${node.id}-${species}-${lod}`;
        mesh.count = 0;
        mesh.frustumCulled = true;
        mesh.visible = false;
        mesh.castShadow = this.treeLodCastsShadow(lod);
        mesh.receiveShadow = false;
        meshes[species][lod] = mesh;
        group.add(mesh);
      }
    }
    return {
      nodeId: node.id,
      footprint: node.footprint,
      centerX,
      centerZ,
      radius: footprintRadius(node.footprint),
      instances,
      group,
      meshes,
      previousLods: instances.map(() => null),
      visible: false,
      generationStats,
    };
  }

  private updatePatchLods(center: THREE.Vector3, cameraPosition: THREE.Vector3 = center): void {
    const lodDistances = treeLodDistances(this.settings);
    const write = this.newWriteState();
    this.resetLodCounts();
    const crossfade = this.settings.lod.crossfadeEnabled && this.settings.lod.ditherEnabled;
    for (const patch of this.patches) {
      this.resetPatchWriteState(patch, write);
      patch.visible = distance2d(center.x, center.z, patch.centerX, patch.centerZ) <= lodDistances.impostor + patch.radius;
      patch.group.visible = patch.visible;
      if (!patch.visible) {
        this.flushPatchMeshes(patch, center, write);
        continue;
      }
      for (let instanceIndex = 0; instanceIndex < patch.instances.length; instanceIndex++) {
        const instance = patch.instances[instanceIndex];
        const distance = distance2d(center.x, center.z, instance.position[0], instance.position[2]);
        if (distance > lodDistances.impostor) {
          patch.previousLods[instanceIndex] = null;
          continue;
        }
        const selection = selectTreeLod(distance, patch.previousLods[instanceIndex], this.settings);
        patch.previousLods[instanceIndex] = selection.lod;
        const primaryLod = this.resolveLod(instance.species, selection.lod);
        this.lodCounts[primaryLod]++;
        this.placeTreeInstance(patch, instance, primaryLod, crossfade ? selection.fade : 1, cameraPosition, write);
        // Screen-door crossfade: draw the neighbouring LOD too, dithered by the
        // complementary weight, so the swap is gradual instead of a hard pop.
        if (crossfade && selection.secondaryLod) {
          const secondaryLod = this.resolveLod(instance.species, selection.secondaryLod);
          if (secondaryLod !== primaryLod) {
            this.placeTreeInstance(patch, instance, secondaryLod, selection.secondaryFade, cameraPosition, write);
          }
        }
      }
      this.flushPatchMeshes(patch, center, write);
    }
    this.updateStats();
  }

  private newWriteState(): TreeMeshWriteState {
    return {
      counts: new Map(),
      matrixChanged: new Map(),
      worldXZChanged: new Map(),
      impostorUvChanged: new Map(),
      fadeChanged: new Map(),
    };
  }

  private resetLodCounts(): void {
    this.lodCounts.near = 0;
    this.lodCounts.mid = 0;
    this.lodCounts.far = 0;
    this.lodCounts.impostor = 0;
  }

  private resetPatchWriteState(patch: TreePatch, write: TreeMeshWriteState): void {
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const mesh = patch.meshes[species][lod];
        write.counts.set(mesh, 0);
        write.matrixChanged.set(mesh, false);
        write.worldXZChanged.set(mesh, false);
        write.impostorUvChanged.set(mesh, false);
        write.fadeChanged.set(mesh, false);
      }
    }
  }

  private flushPatchMeshes(patch: TreePatch, center: THREE.Vector3, write: TreeMeshWriteState): void {
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const mesh = patch.meshes[species][lod];
        this.updateTreeMeshAfterLod(
          mesh,
          write.counts.get(mesh) ?? 0,
          center,
          lod,
          write.matrixChanged.get(mesh) ?? false,
          write.worldXZChanged.get(mesh) ?? false,
          write.impostorUvChanged.get(mesh) ?? false,
          write.fadeChanged.get(mesh) ?? false,
        );
      }
    }
  }

  private placeTreeInstance(
    patch: TreePatch,
    instance: TreeInstance,
    lod: TreeLod,
    fade: number,
    cameraPosition: THREE.Vector3,
    write: TreeMeshWriteState,
  ): void {
    const mesh = patch.meshes[instance.species][lod];
    const index = write.counts.get(mesh) ?? 0;
    if (index >= mesh.instanceMatrix.count) return;
    this.translation.set(
      instance.position[0] - patch.centerX,
      instance.position[1],
      instance.position[2] - patch.centerZ,
    );
    const rotationY = lod === "impostor" && this.settings.impostors.axialBillboard
      ? Math.atan2(cameraPosition.x - instance.position[0], cameraPosition.z - instance.position[2])
      : instance.rotationY;
    this.rotation.setFromAxisAngle(this.upAxis, rotationY);
    this.scale.setScalar(instance.scale);
    this.matrix.compose(this.translation, this.rotation, this.scale);
    if (this.writeMatrixIfChanged(mesh, index, this.matrix)) write.matrixChanged.set(mesh, true);
    if (this.writeTreeWorldXZIfChanged(mesh, index, instance.position[0], instance.position[2])) {
      write.worldXZChanged.set(mesh, true);
    }
    if (this.writeTreeLodFadeIfChanged(mesh, index, fade)) write.fadeChanged.set(mesh, true);
    if (lod === "impostor" && this.writeTreeImpostorUvRectIfChanged(mesh, index, instance, cameraPosition)) {
      write.impostorUvChanged.set(mesh, true);
    }
    write.counts.set(mesh, index + 1);
  }

  /**
   * Remap the LOD that gets drawn for an instance. Currently only honours
   * `impostors.fallbackToPlaceholder`: when impostors are on but no baked atlas
   * is ready and placeholder fallback is disabled, clamp the impostor band to the
   * far mesh instead of drawing the procedural placeholder cards.
   */
  private resolveLod(species: TreeSpeciesId, lod: TreeLod): TreeLod {
    if (
      lod === "impostor" &&
      this.settings.impostors.enabled &&
      !this.canUseBakedImpostor(species) &&
      !this.settings.impostors.fallbackToPlaceholder
    ) {
      return "far";
    }
    return lod;
  }

  private usesGpuRingDraw(): boolean {
    const gpu = this.settings.gpu;
    return this.settings.enabled && gpu.enabled && !gpu.debugForceCpu;
  }

  private updateGpuRingTrees(center: THREE.Vector3, cameraPosition: THREE.Vector3): boolean {
    void cameraPosition;
    const gpu = this.settings.gpu;
    if (!this.supportsGpuTrees || !this.gpuDevice || !this.gpuBackend) {
      this.gpuStatus = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      this.clearGpuRing();
      return false;
    }
    if (this.gpuRingUnsupportedReason) {
      this.gpuStatus = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      this.gpuLoggedError ??= this.gpuRingUnsupportedReason;
      console.warn(`[trees-gpu-ring] falling back to CPU: ${this.gpuRingUnsupportedReason}`);
      this.clearGpuRing();
      return false;
    }

    this.ensureGpuRingCompute();
    const stats = this.gpuRingCompute?.stats(true) ?? this.gpuRingStats;
    this.gpuRingStats = stats;
    if (stats.status === "failed" && gpu.fallbackToCpu) {
      if (stats.reason && this.gpuLoggedError !== stats.reason) {
        this.gpuLoggedError = stats.reason;
        console.warn(`[trees-gpu-ring] falling back to CPU: ${stats.reason}`);
      }
      this.clearGpuRing();
      this.gpuStatus = "fallback-cpu";
      return false;
    }
    if (this.gpuRingCompute && this.gpuRingDraw) {
      const frustumPlanes = this.frustumPlanes();
      this.gpuRingCompute.dispatch({
        centerX: center.x,
        centerZ: center.z,
        worldCells: this.worldCells,
        maxInstancesPerGroup: treeGpuRingGroupCapacity(this.settings),
        indexCounts: this.gpuRingIndexCounts(),
        frustumPlanes,
      });
      this.gpuRingStats = this.gpuRingCompute.stats(true);
    }

    this.resetLodCounts();
    this.lodCounts.near = this.gpuRingStats.counts.near;
    this.lodCounts.mid = this.gpuRingStats.counts.mid;
    this.lodCounts.far = this.gpuRingStats.counts.far;
    this.lodCounts.impostor = this.gpuRingStats.counts.impostor;
    this.gpuStatus = this.gpuRingStats.status === "failed" ? "error" : "ready";
    this.gpuVisibleCount = this.gpuRingStats.counts.near
      + this.gpuRingStats.counts.mid
      + this.gpuRingStats.counts.far
      + this.gpuRingStats.counts.impostor;
    this.gpuOverflowed = false;
    this.gpuDispatchMs = this.gpuRingStats.dispatchMs;
    this.gpuReadbackMs = this.gpuRingStats.readbackMs;
    this.updateStats();
    return true;
  }

  private ensureGpuRingCompute(): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.usesGpuRingDraw()) return;
    const key = treeGpuRingKey(this.settings, this.worldCells);
    if (this.gpuRingCompute && this.gpuRingKey === key) return;
    if (this.gpuRingInit && this.gpuRingKey === key) return;

    this.clearGpuRing();
    this.gpuRingKey = key;
    this.gpuRingDraw = this.createGpuRingDrawResources(treeGpuRingGroupCapacity(this.settings));
    this.ringMeshes = this.gpuRingDraw.meshes;
    for (const mesh of this.ringMeshes) this.root.add(mesh);
    this.gpuRingStats = {
      status: "initializing",
      candidateCount: treeGpuRingSlotCount(this.settings),
      acceptedCandidates: 0,
      counts: { near: 0, mid: 0, far: 0, impostor: 0 },
      groupCounts: new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0),
      dispatchMs: null,
      readbackMs: null,
      skippedDispatches: 0,
    };
    const initKey = key;
    const edits = resolveDigEdits(getDigEditsSnapshot());
    this.gpuRingInit = TreeGpuRingCompute.create(this.gpuDevice, edits, this.gpuRingDraw.outputBuffers, this.settings)
      .then((compute) => {
        if (this.gpuRingKey !== initKey) {
          compute.destroy();
          return;
        }
        this.gpuRingCompute = compute;
        this.gpuRingStats = compute.stats(this.settings.enabled);
      })
      .catch((error) => {
        if (this.gpuRingKey !== initKey) return;
        this.gpuRingStats = {
          ...this.gpuRingStats,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        if (this.gpuRingKey === initKey) this.gpuRingInit = null;
      });
  }

  private gpuRingIndexCounts(): TreeGpuRingIndexCounts {
    const counts = {} as TreeGpuRingIndexCounts;
    for (const species of TREE_SPECIES) {
      counts[species] = {} as Record<TreeLod, number>;
      for (const lod of TREE_LODS) {
        counts[species][lod] = this.indexCountFor(this.geometryForGpuRing(species, lod));
      }
    }
    return counts;
  }

  private createGpuRingDrawResources(maxInstancesPerGroup: number): TreeGpuRingDrawResources {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU tree draw resources without a backend");
    const count = Math.max(1, maxInstancesPerGroup);
    const sharedInstanceCount = count * TREE_GPU_RING_GROUP_COUNT;
    const indirect = new StorageBufferAttribute(new Uint32Array(TREE_GPU_RING_GROUP_COUNT * 5), 5);
    indirect.name = "tree-ring-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    const cell = this.createStorageInstancedAttribute("cell", sharedInstanceCount);
    const ringBuffers: TreeRingInstanceBuffers = { cell, capacity: sharedInstanceCount };
    const materialHandles = {} as Record<TreeLod, TreeMaterialHandle>;
    for (const lod of TREE_LODS) {
      materialHandles[lod] = this.currentLighting
        ? createTreeRingNodeMaterialHandle(this.settings, ringBuffers, lod, this.currentLighting)
        : createTreeRingNodeMaterialHandle(this.settings, ringBuffers, lod);
    }
    const meshes: TreeGpuRingMesh[] = [];
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const group = treeGpuRingGroupIndex(species, lod);
        meshes.push(this.createGpuRingTierDraw(
          species,
          lod,
          count,
          indirect,
          group * 5 * Uint32Array.BYTES_PER_ELEMENT,
          materialHandles[lod],
        ));
      }
    }
    return {
      meshes,
      cell,
      indirect,
      materialHandles,
      outputBuffers: {
        cell: this.gpuBufferForAttribute(cell),
        indirectArgs: this.gpuBufferForAttribute(indirect),
      },
    };
  }

  private createGpuRingTierDraw(
    species: TreeSpeciesId,
    lod: TreeLod,
    count: number,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
    materialHandle: TreeMaterialHandle,
  ): TreeGpuRingMesh {
    const source = this.geometryForGpuRing(species, lod);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(source.getIndex());
    for (const name of Object.keys(source.attributes)) {
      geometry.setAttribute(name, source.getAttribute(name));
    }
    geometry.instanceCount = count;
    this.setGpuRingIndirect(geometry, indirect, indirectOffset);
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(this.worldCells + 1, 256, this.worldCells + 1),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(
      geometry,
      this.settings.render.debugColorByLod ? materialHandle.debugMaterials[lod] : materialHandle.regularMaterial,
    );
    mesh.name = `trees-ring-gpu-${species}-${lod}`;
    mesh.frustumCulled = false;
    mesh.castShadow = this.treeLodCastsShadow(lod);
    mesh.receiveShadow = false;
    return mesh;
  }

  private createStorageInstancedAttribute(name: string, count: number): StorageInstancedBufferAttribute {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU tree storage attribute without a backend");
    const attribute = new StorageInstancedBufferAttribute(count, 4);
    attribute.name = `tree-ring-${name}`;
    this.gpuBackend.createStorageAttribute(attribute);
    return attribute;
  }

  private setGpuRingIndirect(
    geometry: THREE.InstancedBufferGeometry,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
  ): void {
    const indirectGeometry = geometry as IndirectInstancedBufferGeometry;
    if (!indirectGeometry.setIndirect) {
      throw new Error("tree GPU ring requires InstancedBufferGeometry.setIndirect support");
    }
    indirectGeometry.setIndirect(indirect, indirectOffset);
  }

  private gpuBufferForAttribute(attribute: THREE.BufferAttribute): GPUBuffer {
    if (!this.gpuBackend) throw new Error("Cannot read WebGPU tree buffer without a backend");
    const buffer = this.gpuBackend.get(attribute).buffer;
    if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "tree ring attribute"}`);
    return buffer;
  }

  private frustumPlanes(): Float32Array {
    // Stage 1 uses a conservative always-inside frustum if the app does not pass a camera.
    if (!this.hasGpuRingFrustum) {
      this.frustumPlaneScratch.fill(0);
      for (let i = 0; i < 6; i++) this.frustumPlaneScratch[i * 4 + 3] = 1_000_000;
      this.hasGpuRingFrustum = true;
    }
    return this.frustumPlaneScratch;
  }

  private indexCountFor(geometry: THREE.BufferGeometry): number {
    return geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0;
  }

  private updateTreeMeshAfterLod(
    mesh: THREE.InstancedMesh,
    nextCount: number,
    center: THREE.Vector3,
    lod: TreeLod,
    matrixChanged: boolean,
    worldXZChanged: boolean,
    impostorUvChanged: boolean,
    fadeChanged: boolean,
  ): void {
    const previousState = this.meshBoundsState.get(mesh);
    const countChanged = mesh.count !== nextCount;
    mesh.count = nextCount;

    if (matrixChanged) mesh.instanceMatrix.needsUpdate = true;
    if (worldXZChanged) this.treeWorldXZ(mesh).needsUpdate = true;
    if (fadeChanged) this.treeLodFade(mesh).needsUpdate = true;
    if (impostorUvChanged) this.treeImpostorUvRect(mesh).needsUpdate = true;

    if (nextCount <= 0) {
      mesh.visible = false;
      this.meshBoundsState.set(mesh, {
        count: nextCount,
        centerX: center.x,
        centerZ: center.z,
        hasBounds: false,
      });
      return;
    }

    mesh.visible = true;
    // Billboard impostors yaw toward the camera every frame, so `matrixChanged`
    // fires constantly; gating bounds on it would recompute the sphere/box each
    // frame. For those, recompute only when instance positions move (worldXZ) and
    // use conservative (inflated) bounds that stay valid under any yaw.
    const billboard = lod === "impostor" && this.settings.impostors.axialBillboard;
    const positionsChanged = billboard ? worldXZChanged : matrixChanged;
    const centerMoved = previousState
      ? distance2d(center.x, center.z, previousState.centerX, previousState.centerZ) >= TREE_BOUNDS_REFRESH_DISTANCE_M
      : true;
    if (!previousState?.hasBounds || countChanged || centerMoved || positionsChanged) {
      this.updateTreeMeshBounds(mesh, billboard);
      this.meshBoundsState.set(mesh, {
        count: nextCount,
        centerX: center.x,
        centerZ: center.z,
        hasBounds: true,
      });
    }
  }

  private updateTreeMeshBounds(mesh: THREE.InstancedMesh, billboard: boolean): void {
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    if (!billboard) return;
    // Inflate by one tree's own radius so any per-instance yaw stays inside the
    // bounds we just computed at the current angle.
    const margin = mesh.geometry.boundingSphere?.radius ?? 0;
    if (mesh.boundingSphere) mesh.boundingSphere.radius += margin;
    mesh.boundingBox?.expandByScalar(margin);
  }

  private writeMatrixIfChanged(mesh: THREE.InstancedMesh, index: number, matrix: THREE.Matrix4): boolean {
    const array = mesh.instanceMatrix.array;
    const offset = index * 16;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(array[offset + i] - matrix.elements[i]) > TREE_INSTANCE_ATTRIBUTE_EPSILON) {
        mesh.setMatrixAt(index, matrix);
        return true;
      }
    }
    return false;
  }

  private writeTreeWorldXZIfChanged(mesh: THREE.InstancedMesh, index: number, x: number, z: number): boolean {
    const attribute = this.treeWorldXZ(mesh);
    const array = attribute.array as Float32Array;
    const offset = index * 2;
    if (
      Math.abs(array[offset] - x) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
      Math.abs(array[offset + 1] - z) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
    ) {
      return false;
    }
    array[offset] = x;
    array[offset + 1] = z;
    return true;
  }

  private writeTreeLodFadeIfChanged(mesh: THREE.InstancedMesh, index: number, fade: number): boolean {
    const attribute = this.treeLodFade(mesh);
    const array = attribute.array as Float32Array;
    if (Math.abs(array[index] - fade) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
    array[index] = fade;
    return true;
  }

  private writeTreeImpostorUvRectIfChanged(
    mesh: THREE.InstancedMesh,
    index: number,
    instance: TreeInstance,
    cameraPosition: THREE.Vector3,
  ): boolean {
    const attribute = this.treeImpostorUvRect(mesh);
    const atlas = this.impostorAtlases[instance.species];
    if (!atlas?.ready) return this.writeUvRect(attribute, index, 0, 0, 1, 1);

    const maxFrame = atlas.frames.length - 1;
    const frozen = this.settings.impostors.debugFreezeFrame;
    const frameIndex = frozen >= 0
      ? Math.min(maxFrame, frozen)
      : octFrameIndexForDirection(
        new THREE.Vector3(
          cameraPosition.x - instance.position[0],
          cameraPosition.y - instance.position[1],
          cameraPosition.z - instance.position[2],
        ),
        atlas.gridSize,
      );
    const frame = atlas.frames[frameIndex] ?? atlas.frames[0];
    return this.writeUvRect(attribute, index, frame.uvMin[0], frame.uvMin[1], frame.uvMax[0], frame.uvMax[1]);
  }

  private writeUvRect(
    attribute: THREE.InstancedBufferAttribute,
    index: number,
    minU: number,
    minV: number,
    maxU: number,
    maxV: number,
  ): boolean {
    const array = attribute.array as Float32Array;
    const offset = index * 4;
    if (
      Math.abs(array[offset] - minU) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
      Math.abs(array[offset + 1] - minV) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
      Math.abs(array[offset + 2] - maxU) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
      Math.abs(array[offset + 3] - maxV) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
    ) {
      return false;
    }
    array[offset] = minU;
    array[offset + 1] = minV;
    array[offset + 2] = maxU;
    array[offset + 3] = maxV;
    return true;
  }

  private treeWorldXZ(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    return mesh.geometry.getAttribute("treeWorldXZ") as THREE.InstancedBufferAttribute;
  }

  private treeLodFade(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    return mesh.geometry.getAttribute("treeLodFade") as THREE.InstancedBufferAttribute;
  }

  private treeImpostorUvRect(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    return mesh.geometry.getAttribute("treeImpostorUvRect") as THREE.InstancedBufferAttribute;
  }

  private materialFor(species: TreeSpeciesId, lod: TreeLod): THREE.Material {
    if (this.settings.render.debugColorByLod) return this.materialHandle.debugMaterials[lod];
    if (lod === "impostor" && this.canUseBakedImpostor(species)) {
      return this.impostorMaterials[species] ?? this.materialHandle.regularMaterial;
    }
    return this.materialHandle.regularMaterial;
  }

  private applyMaterials(): void {
    for (const patch of this.patches) {
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const mesh = patch.meshes[species][lod];
          mesh.material = this.materialFor(species, lod);
          mesh.castShadow = this.treeLodCastsShadow(lod);
        }
      }
    }
  }

  private geometryFor(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    if (lod === "impostor" && this.canUseBakedImpostor(species)) {
      this.bakedImpostorGeometries[species] ??= createTreeBakedImpostorGeometry(species, this.settings);
      return this.bakedImpostorGeometries[species]!;
    }
    return this.geometries[species][lod];
  }

  private geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    // Stage 3b decision: GPU ring uses the procedural impostor-card geometry first.
    // WebGPU render-to-atlas baking can replace this later without blocking the pipeline.
    return this.geometries[species][lod];
  }

  private canUseBakedImpostor(species: TreeSpeciesId): boolean {
    return this.settings.impostors.enabled && !!this.impostorAtlases[species]?.ready;
  }

  private updateImpostorMaterials(): void {
    for (const species of TREE_SPECIES) {
      const atlas = this.impostorAtlases[species];
      if (!atlas?.ready) continue;
      this.impostorMaterials[species] ??= createTreeImpostorMaterial(this.settings, atlas);
      updateTreeImpostorMaterialSettings(this.impostorMaterials[species]!, this.settings);
    }
  }

  private replaceImpostorMeshGeometries(): void {
    for (const patch of this.patches) {
      for (const species of TREE_SPECIES) {
        const mesh = patch.meshes[species].impostor;
        const oldGeometry = mesh.geometry;
        const nextGeometry = this.geometryFor(species, "impostor").clone();
        const capacity = mesh.instanceMatrix.count;
        nextGeometry.setAttribute("treeWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
        nextGeometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1));
        nextGeometry.setAttribute("treeImpostorUvRect", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
        mesh.geometry = nextGeometry;
        oldGeometry.dispose();
        this.meshBoundsState.delete(mesh);
      }
    }
  }

  private disposeBakedImpostorGeometries(): void {
    for (const geometry of Object.values(this.bakedImpostorGeometries)) geometry?.dispose();
    this.bakedImpostorGeometries = {};
  }

  private disposeImpostorMaterials(): void {
    for (const material of Object.values(this.impostorMaterials)) material?.dispose();
    this.impostorMaterials = {};
  }

  private treeLodCastsShadow(lod: TreeLod): boolean {
    const maxLod = this.settings.lod.shadowsMaxLod;
    if (maxLod === "none") return false;
    return TREE_LODS.indexOf(lod) <= TREE_LODS.indexOf(maxLod);
  }

  private clearPatches(): void {
    for (const patch of this.patches) this.removePatch(patch);
    this.patches = [];
    this.resetLodCounts();
    this.updateStats();
  }

  private clearGpuRing(): void {
    this.gpuRingCompute?.destroy();
    this.gpuRingCompute = null;
    this.gpuRingInit = null;
    this.gpuRingKey = "";
    this.hasGpuRingFrustum = false;
    this.clearGpuRingDraw();
    this.gpuRingStats = {
      status: this.gpuDevice ? "idle" : "disabled",
      candidateCount: 0,
      acceptedCandidates: 0,
      counts: { near: 0, mid: 0, far: 0, impostor: 0 },
      groupCounts: new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0),
      dispatchMs: null,
      readbackMs: null,
      skippedDispatches: 0,
    };
  }

  private clearGpuRingDraw(): void {
    for (const mesh of this.ringMeshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this.ringMeshes = [];
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.dispose();
    }
    this.gpuRingDraw = null;
  }

  private removePatch(patch: TreePatch): void {
    this.root.remove(patch.group);
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const mesh = patch.meshes[species][lod];
        mesh.geometry.dispose();
        mesh.dispose();
      }
    }
  }

  private updateStats(): void {
    const stats = emptyTreeStats();
    for (const patch of this.patches) {
      stats.totalTrees += patch.instances.length;
      stats.patches++;
      if (patch.visible) stats.visiblePatches++;
      else stats.culledPatches++;
      stats.generatedCandidates += patch.generationStats.generatedCandidates;
      stats.acceptedCandidates += patch.generationStats.acceptedCandidates;
      stats.rejectedSlope += patch.generationStats.rejectedSlope;
      stats.rejectedHeight += patch.generationStats.rejectedHeight;
      stats.rejectedMaterial += patch.generationStats.rejectedMaterial;
    }
    stats.nearTrees = this.lodCounts.near;
    stats.midTrees = this.lodCounts.mid;
    stats.farTrees = this.lodCounts.far;
    stats.impostorTrees = this.lodCounts.impostor;
    stats.gpuStatus = this.gpuStatus;
    stats.gpuCandidateCount = this.usesGpuRingDraw() ? this.gpuRingStats.candidateCount : 0;
    stats.gpuVisibleCount = this.gpuVisibleCount;
    stats.gpuOverflowed = this.gpuOverflowed;
    stats.gpuDispatchMs = this.gpuDispatchMs;
    stats.gpuReadbackMs = this.gpuReadbackMs;
    stats.gpuShowCounts = this.settings.gpu.debugShowGpuCounts;
    stats.impostorStatus = this.impostorStatus;
    stats.impostorReason = this.impostorReason;
    this.stats = stats;
  }
}

function emptyTreeStats(): TreeStats {
  return {
    totalTrees: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    nearTrees: 0,
    midTrees: 0,
    farTrees: 0,
    impostorTrees: 0,
    gpuStatus: "disabled",
    gpuCandidateCount: 0,
    gpuVisibleCount: 0,
    gpuOverflowed: false,
    gpuDispatchMs: null,
    gpuReadbackMs: null,
    gpuShowCounts: true,
    impostorStatus: "disabled",
    impostorReason: null,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    rejectedSlope: 0,
    rejectedHeight: 0,
    rejectedMaterial: 0,
  };
}

function footprintCenterX(footprint: PageFootprint): number {
  return (footprint.minX + footprint.maxX) * 0.5;
}

function footprintCenterZ(footprint: PageFootprint): number {
  return (footprint.minZ + footprint.maxZ) * 0.5;
}

function footprintRadius(footprint: PageFootprint): number {
  return Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
}

function distance2d(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}
