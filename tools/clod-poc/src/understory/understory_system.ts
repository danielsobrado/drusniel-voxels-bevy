import * as THREE from "three";
import type { ClodPageNode, PageFootprint } from "../types.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstoryClassSettings, type UnderstorySettings } from "./understory_config.js";
import {
  createUnderstoryGeometryMap,
  disposeUnderstoryGeometryMap,
  type UnderstoryGeometryMap,
} from "./understory_geometry.js";
import {
  emptyUnderstoryGenerationStats,
  generateUnderstoryInstances,
  type UnderstoryGenerationStats,
  type UnderstoryInstance,
  type UnderstoryTerrainSampler,
} from "./understory_instances.js";
import { createUnderstoryMaterialHandle, type UnderstoryMaterialHandle } from "./understory_material.js";
import { createUnderstoryNodeMaterialHandle } from "./understory_node_material.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { EnvironmentLighting } from "../environment.js";
import {
  UnderstoryGpuRingCompute,
  understoryGpuRingComputeUnsupportedReason,
  createGpuRingDrawResources,
  clearGpuRingDraw,
  type UnderstoryGpuRingDrawResources,
  type UnderstoryGpuRingStats,
  type UnderstoryWebGpuBackendAccess,
  type UnderstoryHydrologyData,
} from "../gpu/understory_ring_compute.js";
import { understoryRingGroupCapacity, understoryRingCell } from "./understory_ring_math.js";
import { getDigEditsSnapshot, getDigEditRevision } from "../terrain.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import { generateUnderstoryRingValidationCounts } from "./understory_ring_validation.js";

export interface UnderstorySystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: UnderstorySettings;
  sampler?: UnderstoryTerrainSampler;
  /** Use the WebGPU node material path instead of the classic WebGL material. */
  webgpu?: boolean;
  /** Initial lighting for the WebGPU node material path. */
  lighting?: EnvironmentLighting;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: UnderstoryWebGpuBackendAccess | null;
  supportsGpu?: boolean;
  /** Hydrology water-surface data (R=waterY, G=wetMask, B=carvedBed). When set, GPU understory uses carved-bed height in flat areas and rejects water bodies. */
  hydrologyData?: UnderstoryHydrologyData | null;
}

export function understoryUsesGpuRingDraw(settings: UnderstorySettings): boolean {
  return settings.enabled && settings.gpu.enabled && !settings.gpu.debugForceCpu;
}

export interface UnderstoryStats extends UnderstoryGenerationStats {
  totalInstances: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  shrub: number;
  fern: number;
  sapling: number;
  flower: number;
  deadLog: number;
  stump: number;
  gpuStatus: "disabled" | "unsupported" | "ring" | "fallback-cpu" | "error";
  gpuCandidateCount: number;
  gpuAcceptedCount: number;
  gpuVisibleCount: number;
  gpuOverflowed: boolean;
  gpuDispatchMs: number | null;
}

export interface UnderstoryLightingProxy {
  x: number;
  z: number;
  classId: UnderstoryClass;
  scale: number;
  densityWeight: number;
}

interface UnderstoryPatch {
  nodeId: string;
  footprint: PageFootprint;
  centerX: number;
  centerZ: number;
  radius: number;
  group: THREE.Group;
  instances: UnderstoryInstance[];
  meshes: Record<UnderstoryClass, THREE.InstancedMesh>;
  visible: boolean;
  generationStats: UnderstoryGenerationStats;
}

const INSTANCE_ATTRIBUTE_EPSILON = 1e-5;

export class UnderstorySystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly sampler: UnderstoryTerrainSampler | undefined;
  private readonly root = new THREE.Group();
  private readonly matrix = new THREE.Matrix4();
  private readonly translation = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private settings: UnderstorySettings;
  private geometries: UnderstoryGeometryMap;
  private materialHandle: UnderstoryMaterialHandle;
  private patches: UnderstoryPatch[] = [];
  private patchesDirty = true;
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly lastCenter: THREE.Vector3;
  private stats: UnderstoryStats = emptyUnderstoryStats();
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: UnderstoryWebGpuBackendAccess | null;
  private readonly supportsGpu: boolean;
  private readonly gpuRingUnsupportedReason: string | null;
  private gpuStatus: UnderstoryStats["gpuStatus"] = "disabled";
  private gpuVisibleCount = 0;
  private gpuOverflowed = false;
  private gpuDispatchMs: number | null = null;
  private gpuRingCompute: UnderstoryGpuRingCompute | null = null;
  private gpuRingInit: Promise<void> | null = null;
  private gpuRingKey = "";
  private gpuRingGeneration = 0;
  private gpuRingDraw: UnderstoryGpuRingDrawResources | null = null;
  private ringMeshes: THREE.Mesh[] = [];
  private gpuRingStats: UnderstoryGpuRingStats = {
    status: "disabled",
    candidateCount: 0,
    acceptedCandidates: 0,
    counts: { shrub: 0, fern: 0, sapling: 0, flower: 0, dead_log: 0, stump: 0 },
    groupCounts: [],
    overflowed: false,
    submitMs: null,
    readbackMs: null,
    skippedDispatches: 0,
  };
  private lastGpuValidationSignature = "";
  private readonly frustumPlaneScratch = new Float32Array(24);
  private readonly hydrologyData: UnderstoryHydrologyData | null;

  constructor(options: UnderstorySystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = options.settings;
    this.sampler = options.sampler;
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    this.supportsGpu = options.supportsGpu ?? !!this.gpuDevice;
    this.hydrologyData = options.hydrologyData ?? null;
    this.gpuRingUnsupportedReason = this.gpuDevice
      ? understoryGpuRingComputeUnsupportedReason(this.gpuDevice)
      : null;
    this.geometries = createUnderstoryGeometryMap(this.settings);
    this.materialHandle = options.webgpu
      ? createUnderstoryNodeMaterialHandle(this.settings, options.lighting)
      : createUnderstoryMaterialHandle(this.settings);
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.root.name = "understory";
    this.root.visible = this.settings.enabled;
    this.scene.add(this.root);
    if (this.settings.enabled && !this.usesGpuRingDraw()) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (!enabled) {
      this.gpuStatus = "disabled";
      this.updateStats();
      return;
    }
    if (!wasEnabled) this.refreshForCenter(this.lastCenter);
  }

  private usesGpuRingDraw(): boolean {
    return understoryUsesGpuRingDraw(this.settings) && this.supportsGpu && !!this.gpuDevice && !this.gpuRingUnsupportedReason;
  }

  private updateCpuFallbackGpuStatus(): void {
    if (!this.settings.gpu.enabled) {
      this.gpuStatus = "disabled";
      return;
    }
    if (this.settings.gpu.debugForceCpu) {
      this.gpuStatus = "fallback-cpu";
      return;
    }
    if (!this.supportsGpu || !this.gpuDevice || !this.gpuBackend) {
      this.gpuStatus = this.settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      return;
    }
    if (this.gpuRingUnsupportedReason) {
      this.gpuStatus = this.settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      return;
    }
    this.gpuStatus = this.settings.gpu.fallbackToCpu ? "fallback-cpu" : "disabled";
  }

  updateSettings(settings: Partial<UnderstorySettings>): void {
    const needsGeometry = settings.classes !== undefined;
    const needsPatchRefresh =
      needsGeometry ||
      settings.enabled !== undefined ||
      settings.seed !== undefined ||
      settings.distanceM !== undefined ||
      settings.refreshDistanceM !== undefined ||
      settings.maxInstances !== undefined ||
      settings.placement !== undefined ||
      settings.ecology !== undefined;
    this.settings = { ...this.settings, ...settings };
    if (needsGeometry) {
      disposeUnderstoryGeometryMap(this.geometries);
      this.geometries = createUnderstoryGeometryMap(this.settings);
      this.clearPatches();
    }
    this.materialHandle.updateSettings(this.settings);
    this.applyMaterials();
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.updateSettings(this.settings);
    }
    if (needsPatchRefresh) this.patchesDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  update(timeSeconds: number, center: THREE.Vector3, camera?: THREE.Camera): void {
    this.materialHandle.setTime(timeSeconds);
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.setTime(timeSeconds);
    }
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    if (this.usesGpuRingDraw()) {
      if (this.patches.length > 0) this.clearPatches();
      this.updateGpuRingUnderstory(center, camera);
      return;
    }
    if (this.gpuRingCompute || this.gpuRingInit || this.gpuRingDraw || this.ringMeshes.length > 0) {
      this.clearGpuRing();
    }
    this.updateCpuFallbackGpuStatus();
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
      this.refreshForCenter(center);
    } else {
      this.updatePatchVisibility(center);
    }
  }

  rebuild(): void {
    this.clearGpuRing();
    this.clearPatches();
    if (this.settings.enabled) {
      if (this.usesGpuRingDraw()) {
        this.gpuStatus = "ring";
      } else {
        this.updateCpuFallbackGpuStatus();
        this.refreshForCenter(this.lastCenter);
      }
    } else {
      this.gpuStatus = "disabled";
    }
    this.root.visible = this.settings.enabled;
  }

  /** Schedule deferred re-scatter on the next update cycle. */
  markPatchesDirty(): void {
    this.patchesDirty = true;
  }

  /** Remove patches for edited LOD0 nodes (fast path — no re-scatter).
   *  Caller must trigger refreshForCenter later. */
  removePatchesForNodes(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    const retained: UnderstoryPatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) this.removePatch(patch);
      else retained.push(patch);
    }
    this.patches = retained;
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    this.removePatchesForNodes(nodeIds);
    this.refreshForCenter(this.lastCenter);
  }

  dispose(): void {
    this.clearGpuRing();
    this.clearPatches();
    this.scene.remove(this.root);
    disposeUnderstoryGeometryMap(this.geometries);
    this.materialHandle.dispose();
  }

  getStats(): UnderstoryStats {
    this.updateStats();
    return { ...this.stats };
  }

  updateForestLighting(state: ForestLightingMaterialState | null): void {
    this.materialHandle.updateForestLighting(state);
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.updateForestLighting(state);
    }
  }

  updateLighting(lighting: EnvironmentLighting): void {
    this.materialHandle.updateLighting?.(lighting);
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.updateLighting?.(lighting);
    }
  }

  getLightingProxies(): UnderstoryLightingProxy[] {
    if (!this.settings.enabled) return [];
    const proxies: UnderstoryLightingProxy[] = [];
    for (const patch of this.patches) {
      if (!patch.visible) continue;
      for (const instance of patch.instances) {
        proxies.push({
          x: instance.position[0],
          z: instance.position[2],
          classId: instance.classId,
          scale: instance.scale,
          densityWeight: this.settings.classes[instance.classId].density,
        });
      }
    }
    return proxies;
  }

  private ensureGpuRingCompute(): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.usesGpuRingDraw()) return;
    const key = understoryGpuRingKey(this.settings, this.worldCells);
    if (this.gpuRingCompute && this.gpuRingKey === key) return;
    if (this.gpuRingInit && this.gpuRingKey === key) return;

    this.clearGpuRingDraw();
    this.gpuRingKey = key;
    this.gpuRingDraw = createGpuRingDrawResources(this.settings, this.worldCells, this.gpuBackend);
    for (const mesh of this.gpuRingDraw.meshes) {
      mesh.visible = false;
      this.root.add(mesh);
      this.ringMeshes.push(mesh);
    }
    this.gpuRingStats = { status: "initializing", candidateCount: 0, acceptedCandidates: 0, counts: this.gpuRingStats.counts, groupCounts: [], overflowed: false, submitMs: null, readbackMs: null, skippedDispatches: 0 };

    const initKey = key;
    const initGeneration = this.gpuRingGeneration;
    const edits = resolveDigEdits(getDigEditsSnapshot());
    this.gpuRingInit = UnderstoryGpuRingCompute.create(
      this.gpuDevice, edits, this.gpuRingDraw.outputBuffers, this.settings, this.hydrologyData,
    ).then((compute) => {
      if (this.gpuRingKey !== initKey || this.gpuRingGeneration !== initGeneration) {
        compute.destroy();
        return;
      }
      this.gpuRingCompute = compute;
      this.gpuRingStats = compute.stats(this.settings.enabled);
    }).catch((error) => {
      console.warn("[understory] GPU ring compute init failed:", error);
      this.gpuRingStats = { ...this.gpuRingStats, status: "failed", reason: String(error) };
    }).finally(() => { this.gpuRingInit = null; });
  }

  private updateGpuRingUnderstory(center: THREE.Vector3, camera?: THREE.Camera): void {
    if (!this.supportsGpu || !this.gpuDevice || !this.gpuBackend) {
      this.gpuStatus = this.gpuDevice ? "unsupported" : "disabled";
      this.gpuRingStats = { ...this.gpuRingStats, status: "failed", reason: this.gpuDevice ? "unsupported" : "no device" };
      this.updateStats();
      return;
    }
    if (this.gpuRingUnsupportedReason) {
      this.gpuStatus = "unsupported";
      this.gpuRingStats = { ...this.gpuRingStats, status: "failed", reason: this.gpuRingUnsupportedReason };
      this.updateStats();
      return;
    }

    this.ensureGpuRingCompute();
    this.gpuRingStats = this.gpuRingCompute?.stats(true) ?? this.gpuRingStats;

    const gpu = this.settings.gpu;
    if (this.gpuRingStats.status === "failed" && gpu.fallbackToCpu) {
      this.clearGpuRing();
      this.gpuStatus = "fallback-cpu";
      this.updateStats();
      if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
        this.refreshForCenter(center);
      } else {
        this.updatePatchVisibility(center);
      }
      return;
    }

    if (this.gpuRingCompute && this.gpuRingDraw) {
      const indexCounts = this.gpuRingIndexCounts();
      const dispatched = this.gpuRingCompute.dispatch({
        centerX: center.x,
        centerZ: center.z,
        worldCells: this.worldCells,
        maxInstancesPerGroup: understoryRingGroupCapacity(this.settings),
        indexCounts,
        frustumPlanes: this.frustumPlanes(camera),
        hydroEnabled: !!this.hydrologyData,
      });
      if (dispatched) {
        for (const mesh of this.ringMeshes) mesh.visible = true;
      }
      this.gpuRingStats = this.gpuRingCompute.stats(true);
      this.validateGpuRingAgainstCpu(center, camera);
    }

    const c = this.gpuRingStats.counts;
    this.gpuVisibleCount = c.shrub + c.fern + c.sapling + c.flower + c.dead_log + c.stump;
    this.gpuOverflowed = this.gpuRingStats.overflowed;
    this.gpuDispatchMs = this.gpuRingStats.submitMs;
    this.gpuStatus = this.gpuRingStats.status === "failed" ? "error" : "ring";
    this.updateStats();
  }

  private validateGpuRingAgainstCpu(center: THREE.Vector3, camera?: THREE.Camera): void {
    if (!this.settings.gpu.debugValidateAgainstCpu || this.gpuRingStats.readbackMs === null) return;

    const signature = [
      Math.round(center.x / understoryRingCell(this.settings)),
      Math.round(center.z / understoryRingCell(this.settings)),
      this.gpuRingStats.groupCounts.join(","),
      this.gpuRingStats.overflowed ? 1 : 0,
    ].join("|");
    if (signature === this.lastGpuValidationSignature) return;
    this.lastGpuValidationSignature = signature;

    const expected = generateUnderstoryRingValidationCounts({
      centerX: center.x,
      centerZ: center.z,
      worldCells: this.worldCells,
      settings: this.settings,
      sampler: this.sampler,
      maxInstancesPerGroup: understoryRingGroupCapacity(this.settings),
      frustumPlanes: this.frustumPlanes(camera),
    });
    const maxDelta = UNDERSTORY_CLASSES.reduce((max, cls) =>
      Math.max(max, Math.abs((this.gpuRingStats.counts[cls] ?? 0) - (expected.counts[cls] ?? 0))),
    0);
    const gpuTotal = this.gpuVisibleCount;
    const cpuTotal = UNDERSTORY_CLASSES.reduce((sum, cls) => sum + (expected.counts[cls] ?? 0), 0);
    const tolerance = Math.max(4, Math.ceil(Math.max(cpuTotal, gpuTotal) * 0.02));
    if (maxDelta > tolerance || expected.overflowed !== this.gpuRingStats.overflowed) {
      console.warn(
        "[understory-gpu-ring] CPU/GPU count parity failed " +
        `gpu=${JSON.stringify(this.gpuRingStats.counts)} cpu=${JSON.stringify(expected.counts)} ` +
        `maxDelta=${maxDelta} tolerance=${tolerance} ` +
        `overflow gpu=${this.gpuRingStats.overflowed} cpu=${expected.overflowed}`,
      );
    }
  }

  private frustumPlanes(camera?: THREE.Camera): Float32Array {
    if (!camera) {
      this.frustumPlaneScratch.fill(0);
      for (let i = 0; i < 6; i++) this.frustumPlaneScratch[i * 4 + 3] = 1_000_000;
      return this.frustumPlaneScratch;
    }
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    (camera as THREE.Camera & { updateProjectionMatrix?: () => void }).updateProjectionMatrix?.();
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);
    for (let i = 0; i < 6; i++) {
      const plane = frustum.planes[i];
      const offset = i * 4;
      this.frustumPlaneScratch[offset] = plane.normal.x;
      this.frustumPlaneScratch[offset + 1] = plane.normal.y;
      this.frustumPlaneScratch[offset + 2] = plane.normal.z;
      this.frustumPlaneScratch[offset + 3] = plane.constant;
    }
    return this.frustumPlaneScratch;
  }

  private gpuRingIndexCounts(): [number, number, number, number, number, number] {
    const counts = [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number];
    if (!this.gpuRingDraw) return counts;
    for (let i = 0; i < UNDERSTORY_CLASSES.length && i < this.gpuRingDraw.meshes.length; i++) {
      const geom = this.gpuRingDraw.meshes[i].geometry;
      const idx = geom.getIndex();
      counts[i] = idx ? idx.count : 0;
    }
    return counts;
  }

  private clearGpuRing(): void {
    if (!this.gpuRingCompute && !this.gpuRingInit && !this.gpuRingDraw && this.ringMeshes.length === 0) return;
    this.gpuRingGeneration++;
    this.gpuRingCompute?.destroy();
    this.gpuRingCompute = null;
    this.gpuRingInit = null;
    this.gpuRingKey = "";
    this.clearGpuRingDraw();
    this.gpuVisibleCount = 0;
    this.gpuOverflowed = false;
    this.gpuDispatchMs = null;
    this.lastGpuValidationSignature = "";
    this.gpuRingStats = { status: this.gpuDevice ? "idle" : "disabled", candidateCount: 0, acceptedCandidates: 0, counts: { shrub: 0, fern: 0, sapling: 0, flower: 0, dead_log: 0, stump: 0 }, groupCounts: [], overflowed: false, submitMs: null, readbackMs: null, skippedDispatches: 0 };
  }

  private clearGpuRingDraw(): void {
    for (const mesh of this.ringMeshes) {
      this.root.remove(mesh);
    }
    this.ringMeshes = [];
    clearGpuRingDraw(this.gpuRingDraw);
    this.gpuRingDraw = null;
  }

  private refreshForCenter(center: THREE.Vector3): void {
    this.lastRefreshCenter.copy(center);
    this.patchesDirty = false;
    const distance = this.settings.distanceM;
    const retained: UnderstoryPatch[] = [];
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
    let totalInstances = this.patches.reduce((sum, patch) => sum + patch.instances.length, 0);
    let added = 0;
    for (const { node } of candidates) {
      if (added >= this.settings.maxNewPatchesPerFrame || totalInstances >= this.settings.maxInstances) break;
      const patch = this.createPatch(node, this.settings.maxInstances - totalInstances);
      totalInstances += patch.instances.length;
      this.patches.push(patch);
      this.root.add(patch.group);
      added++;
    }
    if (added < candidates.length) this.patchesDirty = true;
    this.updatePatchVisibility(center);
  }

  private createPatch(node: ClodPageNode, capacityLeft: number): UnderstoryPatch {
    const generationStats = emptyUnderstoryGenerationStats();
    const footprint = clampFootprint(node.footprint, this.worldCells);
    const instances = generateUnderstoryInstances(
      footprint,
      this.settings,
      capacityLeft,
      generationStats,
      this.sampler,
      this.worldCells,
    );
    const centerX = footprintCenterX(footprint);
    const centerZ = footprintCenterZ(footprint);
    const group = new THREE.Group();
    group.name = `understory-patch-${node.id}`;
    group.position.set(centerX, 0, centerZ);
    const meshes = {} as Record<UnderstoryClass, THREE.InstancedMesh>;
    for (const cls of UNDERSTORY_CLASSES) {
      const classInstances = instances.filter((instance) => instance.classId === cls);
      const capacity = Math.max(1, classInstances.length);
      const geometry = this.geometries[cls].clone();
      geometry.setAttribute("understoryWindPhase", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      geometry.setAttribute("understoryWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
      const mesh = new THREE.InstancedMesh(geometry, this.materialFor(cls), capacity);
      mesh.name = `understory-${node.id}-${cls}`;
      mesh.count = 0;
      mesh.frustumCulled = true;
      mesh.castShadow = this.classCastsShadow(cls);
      mesh.receiveShadow = false;
      meshes[cls] = mesh;
      group.add(mesh);
    }
    const patch = {
      nodeId: node.id,
      footprint,
      centerX,
      centerZ,
      radius: footprintRadius(footprint),
      group,
      instances,
      meshes,
      visible: false,
      generationStats,
    };
    this.populatePatchMeshes(patch);
    return patch;
  }

  private populatePatchMeshes(patch: UnderstoryPatch): void {
    const counts = new Map<UnderstoryClass, number>();
    for (const cls of UNDERSTORY_CLASSES) counts.set(cls, 0);
    for (const instance of patch.instances) {
      const mesh = patch.meshes[instance.classId];
      const index = counts.get(instance.classId) ?? 0;
      if (index >= mesh.instanceMatrix.count) continue;
      this.translation.set(instance.position[0] - patch.centerX, instance.position[1], instance.position[2] - patch.centerZ);
      this.rotation.setFromAxisAngle(this.upAxis, instance.rotationY);
      this.scale.setScalar(instance.scale);
      this.matrix.compose(this.translation, this.rotation, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      const phase = mesh.geometry.getAttribute("understoryWindPhase") as THREE.InstancedBufferAttribute;
      (phase.array as Float32Array)[index] = instance.windPhase;
      const worldXZ = mesh.geometry.getAttribute("understoryWorldXZ") as THREE.InstancedBufferAttribute;
      const worldArray = worldXZ.array as Float32Array;
      worldArray[index * 2] = instance.position[0];
      worldArray[index * 2 + 1] = instance.position[2];
      counts.set(instance.classId, index + 1);
    }
    for (const cls of UNDERSTORY_CLASSES) {
      const mesh = patch.meshes[cls];
      const count = counts.get(cls) ?? 0;
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      const phase = mesh.geometry.getAttribute("understoryWindPhase");
      if (phase) phase.needsUpdate = true;
      const worldXZ = mesh.geometry.getAttribute("understoryWorldXZ");
      if (worldXZ) worldXZ.needsUpdate = true;
      if (count > 0) {
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
    }
  }

  private updatePatchVisibility(center: THREE.Vector3): void {
    for (const patch of this.patches) {
      const visible = distance2d(center.x, center.z, patch.centerX, patch.centerZ) <= this.settings.distanceM + patch.radius;
      patch.visible = visible;
      patch.group.visible = visible;
      for (const mesh of Object.values(patch.meshes)) mesh.visible = visible && mesh.count > 0;
    }
    this.updateStats();
  }

  private clearPatches(): void {
    for (const patch of this.patches) this.removePatch(patch);
    this.patches = [];
    this.updateStats();
  }

  private removePatch(patch: UnderstoryPatch): void {
    this.root.remove(patch.group);
    for (const mesh of Object.values(patch.meshes)) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }

  private materialFor(cls: UnderstoryClass): THREE.Material {
    return this.settings.render.debugColorByClass
      ? this.materialHandle.debugMaterials[cls]
      : this.materialHandle.regularMaterial;
  }

  private applyMaterials(): void {
    for (const patch of this.patches) {
      for (const cls of UNDERSTORY_CLASSES) {
        patch.meshes[cls].material = this.materialFor(cls);
        patch.meshes[cls].castShadow = this.classCastsShadow(cls);
      }
    }
  }

  private classCastsShadow(cls: UnderstoryClass): boolean {
    if (!this.settings.render.shadows) return false;
    return UNDERSTORY_CLASSES.indexOf(cls) <= UNDERSTORY_CLASSES.indexOf(this.settings.render.maxShadowClass);
  }

  private updateStats(): void {
    const stats = emptyUnderstoryStats();
    const gpuRing = this.gpuStatus === "ring" || this.gpuStatus === "error";
    if (gpuRing) {
      const c = this.gpuRingStats.counts;
      stats.totalInstances = this.gpuVisibleCount;
      stats.shrub = c.shrub;
      stats.fern = c.fern;
      stats.sapling = c.sapling;
      stats.flower = c.flower;
      stats.deadLog = c.dead_log;
      stats.stump = c.stump;
      stats.generatedCandidates = this.gpuRingStats.candidateCount;
      stats.acceptedCandidates = this.gpuRingStats.acceptedCandidates || this.gpuVisibleCount;
    } else {
      for (const patch of this.patches) {
        stats.totalInstances += patch.instances.length;
        stats.patches++;
        if (patch.visible) stats.visiblePatches++;
        else stats.culledPatches++;
        mergeGenerationStats(stats, patch.generationStats);
        for (const instance of patch.instances) {
          if (instance.classId === "shrub") stats.shrub++;
          else if (instance.classId === "fern") stats.fern++;
          else if (instance.classId === "sapling") stats.sapling++;
          else if (instance.classId === "flower") stats.flower++;
          else if (instance.classId === "dead_log") stats.deadLog++;
          else stats.stump++;
        }
      }
    }
    stats.gpuStatus = this.gpuStatus;
    stats.gpuCandidateCount = gpuRing ? this.gpuRingStats.candidateCount : 0;
    stats.gpuAcceptedCount = gpuRing ? (this.gpuRingStats.acceptedCandidates || this.gpuVisibleCount) : 0;
    stats.gpuVisibleCount = gpuRing ? this.gpuVisibleCount : 0;
    stats.gpuOverflowed = this.gpuOverflowed;
    stats.gpuDispatchMs = this.gpuDispatchMs;
    this.stats = stats;
  }
}

export function emptyUnderstoryStats(): UnderstoryStats {
  return {
    totalInstances: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    shrub: 0,
    fern: 0,
    sapling: 0,
    flower: 0,
    deadLog: 0,
    stump: 0,
    gpuStatus: "disabled",
    gpuCandidateCount: 0,
    gpuAcceptedCount: 0,
    gpuVisibleCount: 0,
    gpuOverflowed: false,
    gpuDispatchMs: null,
    ...emptyUnderstoryGenerationStats(),
  };
}

function mergeGenerationStats(target: UnderstoryGenerationStats, source: UnderstoryGenerationStats): void {
  target.generatedCandidates += source.generatedCandidates;
  target.acceptedCandidates += source.acceptedCandidates;
  target.rejectedSlope += source.rejectedSlope;
  target.rejectedHeight += source.rejectedHeight;
  target.rejectedMaterial += source.rejectedMaterial;
  target.rejectedEcology += source.rejectedEcology;
  target.rejectedSpacing += source.rejectedSpacing;
  target.acceptedShrub += source.acceptedShrub;
  target.acceptedFern += source.acceptedFern;
  target.acceptedSapling += source.acceptedSapling;
  target.acceptedFlower += source.acceptedFlower;
  target.acceptedDeadLog += source.acceptedDeadLog;
  target.acceptedStump += source.acceptedStump;
}

function clampFootprint(footprint: PageFootprint, worldCells: number): PageFootprint {
  return {
    minX: THREE.MathUtils.clamp(footprint.minX, 0, worldCells),
    minZ: THREE.MathUtils.clamp(footprint.minZ, 0, worldCells),
    maxX: THREE.MathUtils.clamp(footprint.maxX, 0, worldCells),
    maxZ: THREE.MathUtils.clamp(footprint.maxZ, 0, worldCells),
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
  if (Math.abs(ax - bx) < INSTANCE_ATTRIBUTE_EPSILON && Math.abs(az - bz) < INSTANCE_ATTRIBUTE_EPSILON) return 0;
  return Math.hypot(ax - bx, az - bz);
}

function classKeyRow(cls: UnderstoryClassSettings): string {
  return `${cls.enabled ? 1 : 0}:${cls.weight}:${cls.density}:${cls.minScale}:${cls.maxScale}:${cls.heightPreference}:${cls.shadePreference}:${cls.moisturePreference}:${cls.forestEdgeBias}:${cls.windWeight}`;
}

function understoryGpuRingKey(settings: UnderstorySettings, worldCells: number): string {
  const gpu = settings.gpu;
  const eco = settings.ecology;
  const cls = settings.classes;
  return [
    worldCells,
    settings.seed,
    settings.distanceM,
    gpu.maxVisible,
    gpu.workgroupSize,
    settings.placement.spacingM,
    settings.placement.slopeMinY,
    settings.placement.minHeightM,
    settings.placement.maxHeightM,
    settings.placement.minGroundWeight,
    settings.placement.minTreeInfluence,
    eco.enabled ? 1 : 0,
    eco.forestInfluenceScaleM,
    eco.forestEdgeWidthM,
    eco.clearingPreference,
    eco.moistureNoiseScaleM,
    eco.moistureStrength,
    eco.shadeStrength,
    eco.densityNoiseScaleM,
    eco.densityNoiseStrength,
    eco.deadfallOldForestBias,
    classKeyRow(cls.shrub),
    classKeyRow(cls.fern),
    classKeyRow(cls.sapling),
    classKeyRow(cls.flower),
    classKeyRow(cls.dead_log),
    classKeyRow(cls.stump),
    getDigEditRevision(),
  ].join(":");
}
