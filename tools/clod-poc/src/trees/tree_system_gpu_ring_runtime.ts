import * as THREE from "three";
import { renderableIndirectDrawCountForGeometry } from "../gpu/indirect_draw_geometry.js";
import { getDigEditRevision, getDigEditsSnapshot } from "../terrain/terrain.js";
import {
  TREE_GPU_RING_CELL,
  TreeGpuRingCompute,
  treeGpuRingGroupCapacity,
  TREE_GPU_RING_GROUP_COUNT,
  TREE_GPU_RING_SHADOW_GROUP_COUNT,
  treeGpuRingKey,
  treeGpuRingSlotCount,
  type TreeGpuRingIndexCounts,
  type TreeGpuRingStats,
} from "../gpu/tree_ring_compute.js";
import { getTerrainFieldCoreConfig, resolveDigEdits } from "../gpu/terrain_field_core.js";
import { getRealtimeSunShadowCascadeCameras } from "../rendering/realtime_sun_shadows.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings } from "./tree_config.js";
import type { TreeTerrainSampler } from "./tree_instances.js";
import { generateTreeRingValidationCounts } from "./tree_ring_validation_counts.js";
import { treeRingShadowCascadePlanesFromCameras } from "./tree_ring_shadow_casters.js";
import { buildTreeRingClusterVisibilityMask, TreeRingClusterVisibilityCache, type TreeRingClusterVisibilityMask } from "./tree_ring_cluster_visibility.js";
import type { TreeVisibleClusterMaskStats } from "./tree_system_stats.js";
import {
  formatTreeLodCounts,
  visibleTreeLodCount,
} from "./tree_system_math.js";
import { packTreeSystemGpuFrustumPlanes } from "./tree_system_gpu_policy.js";
import { setTreeGpuRingMeshesVisible, type TreeGpuRingMesh } from "./tree_system_gpu_ring_draw.js";
import { disposeTreeGpuRingOwnedResources } from "./tree_gpu_ring_resource_lifecycle.js";
import type {
  TreeGpuRingDrawResources,
  TreeStats,
  TreeWebGpuBackendAccess,
} from "./tree_system_types.js";
import type { TreeSpeciesId } from "./tree_config.js";
import { runtimeWorldUsesCameraRelativeCoordinates } from "../world/runtime_world_policy.js";

export interface TreeGpuRingRuntimeState {
  status: TreeStats["gpuStatus"];
  visibleCount: number;
  overflowed: boolean;
  dispatchMs: number | null;
  loggedError: string | null;
  compute: TreeGpuRingCompute | null;
  init: Promise<void> | null;
  key: string;
  failedKey: string;
  generation: number;
  draw: TreeGpuRingDrawResources | null;
  ringMeshes: TreeGpuRingMesh[];
  prepassTwins: THREE.Mesh[];
  stats: TreeGpuRingStats;
  frustumPlaneScratch: Float32Array<ArrayBuffer>;
  lastValidationSignature: string;
  clusterVisibilityCache: TreeRingClusterVisibilityCache;
  clusterVisibilityProviderKey: string;
  clusterVisibilityProviderRevision: number;
  clusterVisibilitySampler: TreeTerrainSampler | undefined;
}

export interface TreeGpuRingRuntimeInput {
  state: TreeGpuRingRuntimeState;
  root: THREE.Object3D;
  settings: TreeSettings;
  worldCells: number;
  sampler: TreeTerrainSampler | undefined;
  gpuDevice: GPUDevice | null;
  gpuBackend: TreeWebGpuBackendAccess | null;
  supportsGpuTrees: boolean;
  unsupportedReason: string | null;
  lodCounts: Record<TreeLod, number>;
  createDrawResources(maxInstancesPerGroup: number): TreeGpuRingDrawResources;
  geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry;
}

export function createTreeGpuRingRuntimeState(gpuDevice: GPUDevice | null): TreeGpuRingRuntimeState {
  return {
    status: "disabled",
    visibleCount: 0,
    overflowed: false,
    dispatchMs: null,
    loggedError: null,
    compute: null,
    init: null,
    key: "",
    failedKey: "",
    generation: 0,
    draw: null,
    ringMeshes: [],
    prepassTwins: [],
    stats: createTreeGpuRingStats(gpuDevice ? "idle" : "disabled"),
    frustumPlaneScratch: new Float32Array(24) as Float32Array<ArrayBuffer>,
    lastValidationSignature: "",
    clusterVisibilityCache: new TreeRingClusterVisibilityCache(),
    clusterVisibilityProviderKey: "",
    clusterVisibilityProviderRevision: 0,
    clusterVisibilitySampler: undefined,
  };
}

export function treeGpuRingMaterialHandles(state: TreeGpuRingRuntimeState): Iterable<TreeMaterialHandleLike> {
  return Object.values(state.draw?.materialHandles ?? {});
}

export interface TreeMaterialHandleLike {
  setTime(timeSeconds: number): void;
  setFadeCenter?(x: number, z: number): void;
  updateLighting?(state: unknown): void;
  updateForestLighting?(state: unknown): void;
  dispose(): void;
}

export function updateTreeGpuRingTrees(input: TreeGpuRingRuntimeInput, center: THREE.Vector3, camera?: THREE.Camera): boolean {
  const gpu = input.settings.gpu;
  if (!input.supportsGpuTrees || !input.gpuDevice || !input.gpuBackend) {
    clearTreeGpuRing(input);
    input.state.status = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
    return false;
  }
  if (input.unsupportedReason) {
    clearTreeGpuRing(input);
    input.state.status = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
    if (input.state.loggedError !== input.unsupportedReason) {
      input.state.loggedError = input.unsupportedReason;
      console.warn(`[trees-gpu-ring] falling back to CPU: ${input.unsupportedReason}`);
    }
    return false;
  }

  const key = treeGpuRingKey(input.settings, input.worldCells);
  if (input.state.failedKey === key) {
    input.state.status = gpu.fallbackToCpu ? "fallback-cpu" : "error";
    return false;
  }

  ensureTreeGpuRingCompute(input, key);
  if (input.state.failedKey === key) return false;

  const stats = input.state.compute?.stats(true) ?? input.state.stats;
  input.state.stats = stats;
  if (stats.status === "failed") {
    failTreeGpuRing(input, key, stats.reason ?? "tree GPU ring failed");
    return false;
  }
  if (input.state.compute && input.state.draw) {
    const frustumPlanes = packTreeSystemGpuFrustumPlanes(camera, input.state.frustumPlaneScratch);
    const shadowCameras = getRealtimeSunShadowCascadeCameras();
    const shadowCascadePlanes = shadowCameras.length > 0 ? treeRingShadowCascadePlanesFromCameras(shadowCameras) : undefined;
    const shadowCapacity = treeGpuRingShadowGroupCapacity(input.settings, shadowCascadePlanes);
    const terrainRevision = getDigEditRevision();
    const providerRevision = updateTreeClusterVisibilityProviderRevision(input);
    const visibleClusterMask = input.settings.gpu.terrainVisibility.enabled && input.sampler
      ? buildTreeRingClusterVisibilityMask({
        centerX: center.x,
        centerZ: center.z,
        cameraY: camera?.position.y ?? center.y,
        worldCells: input.worldCells,
        unbounded: runtimeWorldUsesCameraRelativeCoordinates() || getTerrainFieldCoreConfig().islandShape.enabled,
        settings: input.settings,
        sampler: input.sampler,
        terrainRevision,
        providerRevision,
        cache: input.state.clusterVisibilityCache,
      })
      : null;
    const slotCount = treeGpuRingSlotCount(input.settings);
    const dispatched = input.state.compute.dispatch({
      centerX: center.x,
      centerZ: center.z,
      cameraY: camera?.position.y ?? center.y,
      worldCells: input.worldCells,
      maxInstancesPerGroup: treeGpuRingGroupCapacity(input.settings),
      maxShadowCastersPerGroup: shadowCapacity,
      indexCounts: treeGpuRingIndexCounts(input),
      frustumPlanes,
      shadowCascadePlanes: shadowCapacity > 0 ? shadowCascadePlanes : undefined,
      visibleClusterMaskWords: visibleClusterMask?.words,
      visibleClusterDimCells: visibleClusterMask?.clusterDimCells,
      visibleClusterGrid: visibleClusterMask?.clusterGrid,
      activeSlotIndices: visibleClusterMask?.activeSlotIndices,
      candidateCountBeforePrefilter: visibleClusterMask?.candidateSlotsBeforePrefilter ?? slotCount,
      candidateCountAfterPrefilter: visibleClusterMask?.candidateSlotsAfterPrefilter ?? slotCount,
    });
    if (dispatched) setTreeGpuRingDrawsVisible(input.state, true);
    const nextStats = input.state.compute.stats(true) as TreeGpuRingStats & {
      visibleClusterMaskStats?: TreeVisibleClusterMaskStats | null;
    };
    nextStats.visibleClusterMaskStats = treeVisibleClusterMaskStats(visibleClusterMask);
    input.state.stats = nextStats;
    validateTreeGpuRingAgainstCpu(input, center, camera, frustumPlanes, shadowCapacity > 0 ? shadowCascadePlanes : undefined, visibleClusterMask);
  }

  input.lodCounts.near = input.state.stats.counts.near;
  input.lodCounts.mid = input.state.stats.counts.mid;
  input.lodCounts.far = input.state.stats.counts.far;
  input.lodCounts.impostor = input.state.stats.counts.impostor;
  input.state.status = "ring";
  input.state.visibleCount = visibleTreeLodCount(input.state.stats.counts);
  input.state.overflowed = input.state.stats.overflowed;
  input.state.dispatchMs = input.state.stats.submitMs;
  return true;
}

export function clearTreeGpuRing(input: TreeGpuRingRuntimeInput): void {
  input.state.generation++;
  const compute = input.state.compute;
  input.state.compute = null;
  input.state.init = null;
  input.state.key = "";
  input.state.failedKey = "";
  destroyTreeGpuRingCompute(compute);
  clearTreeGpuRingDraw(input.state, input.root);
  input.state.stats = createTreeGpuRingStats(input.gpuDevice ? "idle" : "disabled");
  input.state.visibleCount = 0;
  input.state.overflowed = false;
  input.state.dispatchMs = null;
  input.state.lastValidationSignature = "";
}

export function setTreeGpuRingDrawsVisible(state: TreeGpuRingRuntimeState, visible: boolean): void {
  setTreeGpuRingMeshesVisible(state.ringMeshes, visible);
  setTreeGpuRingMeshesVisible(state.prepassTwins, visible);
}

function ensureTreeGpuRingCompute(input: TreeGpuRingRuntimeInput, key: string): void {
  if (!input.gpuDevice || !input.gpuBackend) return;
  if (input.state.failedKey === key) return;
  if (input.state.compute && input.state.key === key) return;
  if (input.state.init && input.state.key === key) return;

  clearTreeGpuRing(input);
  input.state.key = key;
  try {
    input.state.draw = input.createDrawResources(treeGpuRingGroupCapacity(input.settings));
    input.state.ringMeshes = input.state.draw.meshes;
    setTreeGpuRingDrawsVisible(input.state, false);
    for (const mesh of input.state.ringMeshes) input.root.add(mesh);
    const slotCount = treeGpuRingSlotCount(input.settings);
    input.state.stats = {
      ...createTreeGpuRingStats("initializing"),
      candidateCount: slotCount,
      candidateCountBeforePrefilter: slotCount,
      candidateCountAfterPrefilter: slotCount,
    };
    const initKey = key;
    const initGeneration = input.state.generation;
    const edits = resolveDigEdits(getDigEditsSnapshot());
    input.state.init = TreeGpuRingCompute.create(input.gpuDevice, edits, input.state.draw.outputBuffers, input.settings)
      .then((nextCompute) => {
        if (input.state.key !== initKey || input.state.generation !== initGeneration) {
          destroyTreeGpuRingCompute(nextCompute);
          return;
        }
        input.state.compute = nextCompute;
        input.state.failedKey = "";
        input.state.loggedError = null;
        input.state.stats = nextCompute.stats(input.settings.enabled);
      })
      .catch((error) => {
        if (input.state.key !== initKey || input.state.generation !== initGeneration) return;
        failTreeGpuRing(input, initKey, error);
      })
      .finally(() => {
        if (input.state.key === initKey && input.state.generation === initGeneration) input.state.init = null;
      });
  } catch (error) {
    failTreeGpuRing(input, key, error);
  }
}

function failTreeGpuRing(input: TreeGpuRingRuntimeInput, key: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  clearTreeGpuRing(input);
  input.state.failedKey = key;
  input.state.loggedError = reason;
  input.state.stats = {
    ...createTreeGpuRingStats("failed"),
    reason,
  };
  input.state.status = input.settings.gpu.fallbackToCpu ? "fallback-cpu" : "error";
  const action = input.settings.gpu.fallbackToCpu ? "falling back to CPU" : "GPU ring disabled";
  console.warn(`[trees-gpu-ring] ${action}: ${reason}`);
}

function destroyTreeGpuRingCompute(compute: TreeGpuRingCompute | null): void {
  if (!compute) return;
  try {
    compute.destroy();
  } catch (error) {
    console.warn("[trees-gpu-ring] compute disposal failed", error);
  }
}

function validateTreeGpuRingAgainstCpu(
  input: TreeGpuRingRuntimeInput,
  center: THREE.Vector3,
  camera: THREE.Camera | undefined,
  frustumPlanes: ArrayLike<number>,
  shadowCascadePlanes: ArrayLike<number> | undefined,
  visibleClusterMask: TreeRingClusterVisibilityMask | null,
): void {
  if (!input.settings.gpu.debugValidateAgainstCpu || input.state.stats.readbackMs === null) return;
  const signature = [
    Math.round(center.x / TREE_GPU_RING_CELL),
    Math.round(center.z / TREE_GPU_RING_CELL),
    input.state.stats.groupCounts.join(","),
    input.state.stats.shadowGroupCounts.join(","),
    input.state.stats.overflowed ? 1 : 0,
    input.state.stats.shadowOverflowed ? 1 : 0,
    input.state.stats.candidateCountAfterPrefilter,
    visibleClusterMask?.candidateSlotsAfterPrefilter ?? treeGpuRingSlotCount(input.settings),
  ].join("|");
  if (signature === input.state.lastValidationSignature) return;
  input.state.lastValidationSignature = signature;

  const capacity = treeGpuRingGroupCapacity(input.settings);
  const shadowCapacity = treeGpuRingShadowGroupCapacity(input.settings, shadowCascadePlanes);
  const cpuCounts = generateTreeRingValidationCounts({
    centerX: center.x,
    centerZ: center.z,
    cameraY: camera?.position.y ?? center.y,
    worldCells: input.worldCells,
    settings: input.settings,
    sampler: input.sampler,
    maxInstancesPerGroup: capacity,
    maxShadowCastersPerGroup: shadowCapacity,
    frustumPlanes,
    shadowCascadePlanes: shadowCapacity > 0 ? shadowCascadePlanes : undefined,
    activeSlotIndices: visibleClusterMask?.activeSlotIndices,
  });
  const gpuCounts = input.state.compute?.stats(true);
  if (!gpuCounts) return;
  const deltas = TREE_LODS.map((lod) => Math.abs((gpuCounts.counts[lod] ?? 0) - (cpuCounts.counts[lod] ?? 0)));
  const maxDelta = Math.max(...deltas);
  const tolerance = Math.max(4, Math.ceil(Math.max(visibleTreeLodCount(cpuCounts.counts), visibleTreeLodCount(gpuCounts.counts)) * 0.02));
  const shadowMaxDelta = maxGroupDelta(gpuCounts.shadowGroupCounts, cpuCounts.shadowGroupCounts);
  const shadowTolerance = Math.max(4, Math.ceil(Math.max(sumCounts(cpuCounts.shadowGroupCounts), sumCounts(gpuCounts.shadowGroupCounts)) * 0.02));
  if (
    maxDelta > tolerance ||
    cpuCounts.overflowed !== gpuCounts.overflowed ||
    shadowMaxDelta > shadowTolerance ||
    cpuCounts.shadowOverflowed !== gpuCounts.shadowOverflowed
  ) {
    console.warn(
      "[trees-gpu-ring] CPU/GPU count parity failed " +
        `gpu=${formatTreeLodCounts(gpuCounts.counts)} cpu=${formatTreeLodCounts(cpuCounts.counts)} ` +
        `maxDelta=${maxDelta} tolerance=${tolerance} ` +
        `overflow gpu=${gpuCounts.overflowed} cpu=${cpuCounts.overflowed} ` +
        `shadowMaxDelta=${shadowMaxDelta} shadowTolerance=${shadowTolerance} ` +
        `shadowOverflow gpu=${gpuCounts.shadowOverflowed} cpu=${cpuCounts.shadowOverflowed}`,
    );
  }
}

function updateTreeClusterVisibilityProviderRevision(input: TreeGpuRingRuntimeInput): number {
  if (!input.sampler) return 0;
  const key = treeClusterVisibilityProviderKey(input);
  if (key !== input.state.clusterVisibilityProviderKey) {
    input.state.clusterVisibilityProviderKey = key;
    input.state.clusterVisibilityProviderRevision++;
    input.state.clusterVisibilityCache.clear();
  }
  input.state.clusterVisibilitySampler = input.sampler;
  return input.state.clusterVisibilityProviderRevision;
}

function treeClusterVisibilityProviderKey(input: TreeGpuRingRuntimeInput): string {
  const visibility = input.settings.gpu.terrainVisibility;
  return [
    input.sampler ? "sampler" : "none",
    input.worldCells,
    visibility.enabled ? 1 : 0,
    visibility.minDistanceM,
    visibility.sampleCount,
    visibility.heightMarginM,
    visibility.crownHeightM,
    treeTerrainSamplerSourceRevision(input.sampler),
  ].join("|");
}

function treeTerrainSamplerSourceRevision(sampler: TreeTerrainSampler | undefined): number {
  const revision = sampler?.sourceRevision;
  const value = typeof revision === "function" ? revision() : revision;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function treeGpuRingIndexCounts(input: TreeGpuRingRuntimeInput): TreeGpuRingIndexCounts {
  const counts = {} as TreeGpuRingIndexCounts;
  for (const species of TREE_SPECIES) {
    counts[species] = {} as Record<TreeLod, number>;
    for (const lod of TREE_LODS) {
      counts[species][lod] = indexCountFor(input.geometryForGpuRing(species, lod));
    }
  }
  return counts;
}

function indexCountFor(geometry: THREE.BufferGeometry): number {
  return renderableIndirectDrawCountForGeometry(geometry);
}

function treeGpuRingShadowGroupCapacity(settings: TreeSettings, shadowCascadePlanes: ArrayLike<number> | undefined): number {
  if (!shadowCascadePlanes || settings.lod.shadowsMaxLod === "none") return 0;
  return treeGpuRingGroupCapacity(settings);
}

function treeVisibleClusterMaskStats(mask: TreeRingClusterVisibilityMask | null): TreeVisibleClusterMaskStats | null {
  if (!mask) return null;
  return {
    visibleClusterHidden: mask.hiddenClusters,
    visibleClusterVisible: mask.visibleClusters,
    visibleClusterUnknownKept: mask.unknownKeptClusters,
    gpuPrefilterTestedClusters: mask.hiddenClusters + mask.visibleClusters,
    gpuPrefilterRejectedClusters: mask.hiddenClusters,
    gpuPrefilterAcceptedClusters: mask.visibleClusters - mask.unknownKeptClusters,
    gpuPrefilterUnknownKeptClusters: mask.unknownKeptClusters,
    gpuPrefilterFarSummaryConsulted: mask.farSummaryConsultedClusters,
    gpuPrefilterSkippedCandidateEstimate: mask.skippedCandidateEstimate,
    gpuCandidateCountBeforePrefilter: mask.candidateSlotsBeforePrefilter,
    gpuCandidateCountAfterPrefilter: mask.candidateSlotsAfterPrefilter,
    gpuPrefilterCacheHits: mask.cacheHits,
    gpuPrefilterCacheMisses: mask.cacheMisses,
    gpuPrefilterSourceFarSummary: mask.sourceCounts.naadfFarSummary,
    gpuPrefilterSourceTerrainSampler: mask.sourceCounts.terrainVisibilitySampler,
    gpuPrefilterSourceFallback: mask.sourceCounts.conservativeFallback,
  };
}

function maxGroupDelta(a: readonly number[], b: readonly number[]): number {
  const count = Math.max(a.length, b.length);
  let maxDelta = 0;
  for (let i = 0; i < count; i++) {
    maxDelta = Math.max(maxDelta, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return maxDelta;
}

function sumCounts(counts: readonly number[]): number {
  return counts.reduce((sum, count) => sum + Math.max(0, Math.floor(count)), 0);
}

function clearTreeGpuRingDraw(state: TreeGpuRingRuntimeState, root: THREE.Object3D): void {
  disposeTreeGpuRingOwnedResources({
    root,
    meshes: state.ringMeshes,
    prepassTwins: state.prepassTwins,
    materialHandles: state.draw?.materialHandles ?? {},
  });
  state.prepassTwins = [];
  state.ringMeshes = [];
  state.draw = null;
}

function createTreeGpuRingStats(status: TreeGpuRingStats["status"]): TreeGpuRingStats {
  return {
    status,
    candidateCount: 0,
    candidateCountBeforePrefilter: 0,
    candidateCountAfterPrefilter: 0,
    acceptedCandidates: 0,
    counts: { near: 0, mid: 0, far: 0, impostor: 0 },
    groupCounts: new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0),
    shadowGroupCounts: new Array<number>(TREE_GPU_RING_SHADOW_GROUP_COUNT).fill(0),
    overflowed: false,
    shadowOverflowed: false,
    submitMs: null,
    readbackMs: null,
    skippedDispatches: 0,
    terrainVisibilityCounts: null,
  };
}
