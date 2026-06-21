import * as THREE from "three";
import type { ClodPageNode, PageFootprint } from "../types.js";
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

const TREE_BOUNDS_REFRESH_DISTANCE_M = 1.0;
const TREE_INSTANCE_ATTRIBUTE_EPSILON = 1e-5;

export interface TreeSystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
  impostorAtlases?: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
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

export class TreeSystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly sampler: TreeTerrainSampler | undefined;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly translation = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private settings: TreeSettings;
  private geometries: TreeGeometryMap;
  private bakedImpostorGeometries: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>> = {};
  private impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>> = {};
  private impostorMaterials: Partial<Record<TreeSpeciesId, THREE.Material>> = {};
  private readonly materialHandle: TreeMaterialHandle;
  private readonly meshBoundsState = new WeakMap<THREE.InstancedMesh, TreeMeshBoundsState>();
  private patches: TreePatch[] = [];
  private patchesDirty = true;
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly lastCenter: THREE.Vector3;
  private stats: TreeStats = emptyTreeStats();

  constructor(options: TreeSystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = { ...options.settings };
    this.sampler = options.sampler;
    this.geometries = createTreeGeometryMap(this.settings);
    if (options.impostorAtlases) this.setImpostorAtlases(options.impostorAtlases);
    this.materialHandle = createTreeMaterialHandle(this.settings);
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.root.name = "trees";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled && !wasEnabled) this.refreshForCenter(this.lastCenter);
    if (!enabled) this.updateStats();
  }

  updateSettings(settings: Partial<TreeSettings>): void {
    const needsGeometry = settings.species !== undefined && settings.species !== this.settings.species;
    const needsPatchRefresh =
      needsGeometry ||
      settings.enabled !== undefined ||
      settings.seed !== undefined ||
      settings.distanceM !== undefined ||
      settings.refreshDistanceM !== undefined ||
      settings.maxInstances !== undefined ||
      settings.placement !== undefined ||
      settings.lod !== undefined;
    Object.assign(this.settings, settings);
    if (needsGeometry) {
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
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
      this.refreshForCenter(center);
    }
    this.updatePatchLods(center, cameraPosition ?? center);
  }

  rebuild(): void {
    this.clearPatches();
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

  async bakeImpostors(renderer: unknown): Promise<{ supported: boolean; reason: string | null }> {
    if (!this.settings.impostors.enabled || !this.settings.impostors.bakeOnStart) {
      return { supported: false, reason: "tree impostor baking disabled" };
    }
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
    const counts = new Map<THREE.InstancedMesh, number>();
    const matrixChanged = new Map<THREE.InstancedMesh, boolean>();
    const worldXZChanged = new Map<THREE.InstancedMesh, boolean>();
    const impostorUvChanged = new Map<THREE.InstancedMesh, boolean>();
    for (const patch of this.patches) {
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const mesh = patch.meshes[species][lod];
          counts.set(mesh, 0);
          matrixChanged.set(mesh, false);
          worldXZChanged.set(mesh, false);
          impostorUvChanged.set(mesh, false);
        }
      }
      patch.visible = distance2d(center.x, center.z, patch.centerX, patch.centerZ) <= lodDistances.impostor + patch.radius;
      patch.group.visible = patch.visible;
      if (!patch.visible) {
        for (const species of TREE_SPECIES) {
          for (const lod of TREE_LODS) this.updateTreeMeshAfterLod(patch.meshes[species][lod], 0, center, false, false, false);
        }
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
        const lod = selection.lod;
        patch.previousLods[instanceIndex] = lod;
        const mesh = patch.meshes[instance.species][lod];
        const index = counts.get(mesh) ?? 0;
        if (index >= mesh.instanceMatrix.count) continue;
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
        if (this.writeMatrixIfChanged(mesh, index, this.matrix)) matrixChanged.set(mesh, true);
        if (this.writeTreeWorldXZIfChanged(mesh, index, instance.position[0], instance.position[2])) {
          worldXZChanged.set(mesh, true);
        }
        if (lod === "impostor" && this.writeTreeImpostorUvRectIfChanged(mesh, index, instance, cameraPosition)) {
          impostorUvChanged.set(mesh, true);
        }
        counts.set(mesh, index + 1);
      }
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const mesh = patch.meshes[species][lod];
          this.updateTreeMeshAfterLod(
            mesh,
            counts.get(mesh) ?? 0,
            center,
            matrixChanged.get(mesh) ?? false,
            worldXZChanged.get(mesh) ?? false,
            impostorUvChanged.get(mesh) ?? false,
          );
        }
      }
    }
    this.updateStats();
  }

  private updateTreeMeshAfterLod(
    mesh: THREE.InstancedMesh,
    nextCount: number,
    center: THREE.Vector3,
    matrixChanged: boolean,
    worldXZChanged: boolean,
    impostorUvChanged: boolean,
  ): void {
    const previousState = this.meshBoundsState.get(mesh);
    const countChanged = mesh.count !== nextCount;
    mesh.count = nextCount;

    if (matrixChanged) mesh.instanceMatrix.needsUpdate = true;
    if (worldXZChanged) this.treeWorldXZ(mesh).needsUpdate = true;
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
    const centerMoved = previousState
      ? distance2d(center.x, center.z, previousState.centerX, previousState.centerZ) >= TREE_BOUNDS_REFRESH_DISTANCE_M
      : true;
    if (!previousState?.hasBounds || countChanged || centerMoved || matrixChanged) {
      this.updateTreeMeshBounds(mesh);
      this.meshBoundsState.set(mesh, {
        count: nextCount,
        centerX: center.x,
        centerZ: center.z,
        hasBounds: true,
      });
    }
  }

  private updateTreeMeshBounds(mesh: THREE.InstancedMesh): void {
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
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
    this.updateStats();
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
      for (const species of TREE_SPECIES) {
        stats.nearTrees += patch.meshes[species].near.count;
        stats.midTrees += patch.meshes[species].mid.count;
        stats.farTrees += patch.meshes[species].far.count;
        stats.impostorTrees += patch.meshes[species].impostor.count;
      }
    }
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
