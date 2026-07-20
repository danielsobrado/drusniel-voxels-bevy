import { shouldRequestGpuReadback } from "../diagnostics/gpu_readback_policy.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "../trees/tree_config.js";
import { treeMaterialDensityVector, treeSpeciesMaterialVector } from "../trees/tree_material_bias.js";
import { treeRingAcceptParams, treeRingLodParams } from "../trees/tree_ring_math.js";
import {
  TREE_RING_SHADOW_CASCADE_COUNT,
  TREE_RING_SHADOW_PLANE_COUNT,
  TREE_RING_SHADOW_PLANE_WORDS,
} from "../trees/tree_ring_shadow_casters.js";
import { DIG_EDIT_BYTES, FIELD_PARAM_WORDS, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import { hydrologyAtlasGpuParams, hydrologyAtlasGpuTexture } from "./hydrology_atlas_gpu.js";
import type { ResolvedDigEdit } from "./terrain_field_core.js";
import { createTreeHydrologyTexture } from "./tree_ring_compute_resources.js";
import { treeRingSpeciesGroupIndex, treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import { composeTreeRingShader } from "./wgsl_modules.js";
import { heightfieldTileGpuAtlasBindings } from "../world/heightfield_tiles/heightfield_tile_gpu_atlas.js";

const TREE_GPU_RING_LAYOUT = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);

export const TREE_GPU_RING_LOD_COUNT = TREE_LODS.length;
export const TREE_GPU_RING_GROUP_COUNT = TREE_GPU_RING_LAYOUT.groupCount;
export const TREE_GPU_RING_SHADOW_GROUP_COUNT = TREE_GPU_RING_LAYOUT.shadowGroupCount;
const TREE_GPU_RING_VISIBLE_PLANE_FLOATS = 6 * 4;
const TREE_GPU_RING_SHADOW_PLANE_FLOATS = TREE_RING_SHADOW_CASCADE_COUNT * TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS;
const PARAM_BYTES = TREE_GPU_RING_LAYOUT.paramBytes;
const COUNTER_BYTES = TREE_GPU_RING_GROUP_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const TREE_TERRAIN_VISIBILITY_COUNTER_COUNT = 2;
const TREE_TERRAIN_VISIBILITY_COUNTER_OFFSET = TREE_GPU_RING_SHADOW_GROUP_COUNT;
const SHADOW_COUNTER_BYTES = (TREE_GPU_RING_SHADOW_GROUP_COUNT + TREE_TERRAIN_VISIBILITY_COUNTER_COUNT) * Uint32Array.BYTES_PER_ELEMENT;
const READBACK_BYTES = COUNTER_BYTES + SHADOW_COUNTER_BYTES;
const READBACK_SLOTS = 2;
const READBACK_INTERVAL_FRAMES = 90;
const SHADOW_MAX_LOD_NONE = -1;
const TREE_GPU_RING_SENTINEL_SLOT = 0xffffffff;

export const TREE_GPU_RING_CELL = 3.4;
export const TREE_GPU_RING_STORAGE_BINDINGS = 9;

export type TreeGpuRingCounts = Record<TreeLod, number>;
export type TreeGpuRingIndexCounts = Record<TreeSpeciesId, Record<TreeLod, number>>;

export interface TreeGpuRingOutputBuffers {
  cell: GPUBuffer;
  indirectArgs: GPUBuffer;
  shadowCell?: GPUBuffer;
  shadowIndirectArgs?: GPUBuffer;
}

export interface TreeHydrologyData {
  res: number;
  worldCells: number;
  data: Float32Array;
}

let defaultTreeHydrologyData: TreeHydrologyData | null = null;

export function setTreeGpuRingHydrologyData(data: TreeHydrologyData | null): void {
  defaultTreeHydrologyData = data;
}

export interface TreeGpuRingStats {
  status: "initializing" | "idle" | "running" | "ready" | "failed" | "disabled";
  reason?: string;
  candidateCount: number;
  candidateCountBeforePrefilter: number;
  candidateCountAfterPrefilter: number;
  acceptedCandidates: number;
  counts: TreeGpuRingCounts;
  groupCounts: number[];
  shadowGroupCounts: number[];
  overflowed: boolean;
  shadowOverflowed: boolean;
  submitMs: number | null;
  readbackMs: number | null;
  skippedDispatches: number;
  terrainVisibilityCounts: TreeGpuTerrainVisibilityCounts | null;
}

export interface TreeGpuTerrainVisibilityCounts {
  terrainHiddenCandidates: number;
  terrainVisibleCandidates: number;
}

export interface TreeGpuRingDispatchParams {
  centerX: number;
  centerZ: number;
  cameraY: number;
  worldCells: number;
  unboundedWorld?: boolean;
  maxInstancesPerGroup: number;
  maxShadowCastersPerGroup?: number;
  indexCounts: TreeGpuRingIndexCounts;
  frustumPlanes?: ArrayLike<number>;
  shadowCascadePlanes?: ArrayLike<number>;
  /** Optional cluster mask used by the shader's visible-list gate for debug/parity with the active-slot list. */
  visibleClusterMaskWords?: Uint32Array;
  visibleClusterDimCells?: number;
  visibleClusterGrid?: number;
  /** Compact slot list produced by the CPU terrain prefilter. Hidden clusters never enter tree_cull. */
  activeSlotIndices?: Uint32Array;
  candidateCountBeforePrefilter?: number;
  candidateCountAfterPrefilter?: number;
  /** Streaming hydrology atlas uniform (originX, originZ, cellSize, enabled);
   *  filled from hydrologyAtlasGpuParams() at dispatch time when omitted. */
  hydroAtlas?: [number, number, number, number];
}

interface ReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
  destroyAfterMap: boolean;
  visibleCpu: Uint32Array;
  shadowCpu: Uint32Array;
  terrainVisibilityCpu: Uint32Array;
}

type PipelineName = "clear_counters" | "tree_cull" | "build_indirect_args";

export function emptyTreeGpuRingCounts(): TreeGpuRingCounts {
  return { near: 0, mid: 0, far: 0, impostor: 0 };
}

export function emptyTreeGpuTerrainVisibilityCounts(): TreeGpuTerrainVisibilityCounts {
  return {
    terrainHiddenCandidates: 0,
    terrainVisibleCandidates: 0,
  };
}

export function treeGpuRingGroupIndex(species: TreeSpeciesId, lod: TreeLod): number {
  return treeRingSpeciesGroupIndex(TREE_SPECIES.indexOf(species), TREE_LODS.indexOf(lod), TREE_SPECIES.length);
}

export function treeGpuRingShadowMaxLodIndex(settings: TreeSettings): number {
  const maxLod = settings.lod.shadowsMaxLod;
  return maxLod === "none" ? SHADOW_MAX_LOD_NONE : TREE_LODS.indexOf(maxLod);
}

export function treeGpuRingTerrainVisibilityEnabled(settings: TreeSettings): boolean {
  return settings.gpu.enabled && settings.gpu.terrainVisibility.enabled;
}

export function treeGpuRingGroupRegion(group: number, maxInstancesPerGroup: number): { start: number; end: number; firstInstance: number } {
  const start = Math.max(0, Math.floor(group)) * Math.max(0, Math.floor(maxInstancesPerGroup));
  return { start, end: start + Math.max(0, Math.floor(maxInstancesPerGroup)), firstInstance: start };
}

export function treeGpuRingGrid(settings: Pick<TreeSettings, "distanceM">): number {
  return Math.max(1, Math.ceil((settings.distanceM * 2) / TREE_GPU_RING_CELL));
}

export function treeGpuRingSlotCount(settings: Pick<TreeSettings, "distanceM">): number {
  const grid = treeGpuRingGrid(settings);
  return grid * grid;
}

export function treeGpuRingGroupCapacity(settings: TreeSettings): number {
  return Math.max(1, Math.floor(settings.gpu.maxVisible / TREE_GPU_RING_GROUP_COUNT));
}

export function treeGpuRingWorkgroupSize(settings: TreeSettings): number {
  return settings.gpu.workgroupSize;
}

export function treeGpuRingCullWorkgroups(settings: TreeSettings): number {
  return Math.ceil(treeGpuRingSlotCount(settings) / treeGpuRingWorkgroupSize(settings));
}

export function treeGpuRingActiveCullWorkgroups(settings: TreeSettings, activeSlotCount: number): number {
  return Math.max(1, Math.ceil(Math.max(1, Math.floor(activeSlotCount)) / treeGpuRingWorkgroupSize(settings)));
}

export function treeGpuRingCounterWorkgroups(settings: TreeSettings): number {
  const slots = Math.max(TREE_GPU_RING_GROUP_COUNT * 5, TREE_GPU_RING_SHADOW_GROUP_COUNT * 5);
  return Math.ceil(slots / treeGpuRingWorkgroupSize(settings));
}

export function treeGpuRingBuildIndirectWorkgroups(settings: TreeSettings): number {
  const groups = Math.max(TREE_GPU_RING_GROUP_COUNT, TREE_GPU_RING_SHADOW_GROUP_COUNT);
  return Math.ceil(groups / treeGpuRingWorkgroupSize(settings));
}

export function treeGpuRingRequestsDebugReadback(settings: TreeSettings, frame: number): boolean {
  return shouldRequestGpuReadback({
    kind: "tree_gpu_counts",
    frame,
    intervalFrames: READBACK_INTERVAL_FRAMES,
    requested: settings.gpu.readbackVisibleLists || settings.gpu.debugValidateAgainstCpu,
  });
}

export function resolveTreeGpuRingReadbackCounts(
  rawGroupCounts: ArrayLike<number>,
  maxInstancesPerGroup: number,
): { counts: TreeGpuRingCounts; groupCounts: number[]; overflowed: boolean } {
  const cap = Math.max(0, Math.floor(maxInstancesPerGroup));
  const rawCounts = Array.from({ length: TREE_GPU_RING_GROUP_COUNT }, (_, group) =>
    Math.max(0, Math.floor(rawGroupCounts[group] ?? 0)),
  );
  const groupCounts = rawCounts.map((count) => Math.min(count, cap));
  return { counts: aggregateLodCounts(groupCounts), groupCounts, overflowed: rawCounts.some((count) => count > cap) };
}

export function resolveTreeGpuRingShadowReadbackCounts(
  rawGroupCounts: ArrayLike<number>,
  maxCastersPerGroup: number,
): { groupCounts: number[]; overflowed: boolean } {
  const cap = Math.max(0, Math.floor(maxCastersPerGroup));
  const rawCounts = Array.from({ length: TREE_GPU_RING_SHADOW_GROUP_COUNT }, (_, group) =>
    Math.max(0, Math.floor(rawGroupCounts[group] ?? 0)),
  );
  return {
    groupCounts: rawCounts.map((count) => Math.min(count, cap)),
    overflowed: rawCounts.some((count) => count > cap),
  };
}

export function treeGpuRingKey(settings: TreeSettings, worldCells: number): string {
  const lod = treeRingLodParams(settings);
  const accept = treeRingAcceptParams(settings);
  return [
    worldCells, settings.seed, settings.distanceM, settings.gpu.maxVisible,
    lod.near, lod.mid, lod.far, lod.radius, lod.band,
    settings.lod.shadowsMaxLod,
    accept.minHeightM, accept.maxHeightM, accept.slopeMinY, accept.minGroundWeight,
    accept.parentCellM, accept.clumpStrength, accept.clumpThreshold,
    ...accept.materialDensity,
    ...TREE_SPECIES.flatMap((species) => treeSpeciesMaterialVector(settings, species)),
    ...TREE_SPECIES.map((species) => speciesWeight(settings, species)),
    treeGpuRingTerrainVisibilityEnabled(settings) ? 1 : 0,
    settings.gpu.terrainVisibility.minDistanceM,
    settings.gpu.terrainVisibility.sampleCount,
    settings.gpu.terrainVisibility.heightMarginM,
    settings.gpu.terrainVisibility.crownHeightM,
    treeGpuRingWorkgroupSize(settings),
  ].join("|");
}

export function treeGpuRingComputeUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= TREE_GPU_RING_STORAGE_BINDINGS) return null;
  return `tree ring compute requires ${TREE_GPU_RING_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export function packTreeGpuRingParams(settings: TreeSettings, params: TreeGpuRingDispatchParams, scratch: ArrayBuffer = new ArrayBuffer(PARAM_BYTES)): ArrayBuffer {
  const f32 = new Float32Array(scratch);
  const u32 = new Uint32Array(scratch);
  const lod = treeRingLodParams(settings);
  const accept = treeRingAcceptParams(settings);
  f32.fill(0);
  u32.fill(0);
  f32[0] = params.centerX;
  f32[1] = params.centerZ;
  f32[2] = Math.min(settings.distanceM, lod.radius);
  f32[3] = params.worldCells;
  f32[4] = lod.near;
  f32[5] = lod.mid;
  f32[6] = lod.far;
  f32[7] = lod.band;
  f32[8] = TREE_GPU_RING_CELL;
  f32[9] = accept.minHeightM;
  f32[10] = accept.maxHeightM;
  f32[11] = accept.slopeMinY;
  f32[12] = accept.minGroundWeight;
  f32[13] = accept.lowlandHeightM;
  f32[14] = accept.highlandHeightM;
  f32[15] = accept.heightFadeM;
  f32[16] = accept.slopeFadeStartY;
  f32[17] = accept.slopeFadeEndY;
  f32[18] = accept.materialWeightPower;
  f32[19] = accept.baseDensity;
  f32[20] = accept.parentCellM;
  f32[21] = accept.clumpStrength;
  f32[22] = accept.clumpThreshold;
  f32[23] = accept.waterClearanceM;
  f32[24] = accept.rockReject;
  f32[25] = accept.snowReject;
  f32[26] = treeGpuRingShadowMaxLodIndex(settings);
  f32[27] = Number.isFinite(params.cameraY) ? params.cameraY : 0;
  f32[TREE_GPU_RING_LAYOUT.terrainVisibilityOffset] = treeGpuRingTerrainVisibilityEnabled(settings) ? 1 : 0;
  f32[TREE_GPU_RING_LAYOUT.terrainVisibilityOffset + 1] = settings.gpu.terrainVisibility.minDistanceM;
  f32[TREE_GPU_RING_LAYOUT.terrainVisibilityOffset + 2] = settings.gpu.terrainVisibility.heightMarginM;
  f32[TREE_GPU_RING_LAYOUT.terrainVisibilityOffset + 3] = settings.gpu.terrainVisibility.crownHeightM;
  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset] = Math.max(1, Math.min(16, Math.floor(settings.gpu.terrainVisibility.sampleCount))) >>> 0;
  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 1] = params.unboundedWorld ? 2 : 0;
  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 2] = Math.max(1, Math.floor(params.visibleClusterDimCells ?? 0)) >>> 0;
  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 3] = Math.max(0, Math.floor(params.visibleClusterGrid ?? 0)) >>> 0;
  TREE_SPECIES.forEach((species, index) => {
    f32[TREE_GPU_RING_LAYOUT.speciesWeightsOffset + index] = speciesWeight(settings, species);
  });
  for (const species of TREE_SPECIES) {
    for (const treeLod of TREE_LODS) {
      u32[TREE_GPU_RING_LAYOUT.indexCountsOffset + treeGpuRingGroupIndex(species, treeLod)] = Math.max(0, Math.floor(params.indexCounts[species][treeLod])) >>> 0;
    }
  }
  u32[TREE_GPU_RING_LAYOUT.settingsOffset] = Math.max(0, Math.floor(params.maxInstancesPerGroup)) >>> 0;
  u32[TREE_GPU_RING_LAYOUT.settingsOffset + 1] = treeGpuRingGrid(settings) >>> 0;
  u32[TREE_GPU_RING_LAYOUT.settingsOffset + 2] = settings.seed >>> 0;
  u32[TREE_GPU_RING_LAYOUT.settingsOffset + 3] = Math.max(0, Math.floor(params.maxShadowCastersPerGroup ?? 0)) >>> 0;
  const density = treeMaterialDensityVector(settings);
  for (let i = 0; i < 4; i++) {
    f32[TREE_GPU_RING_LAYOUT.materialDensityOffset + i] = density[i] ?? 1;
  }
  TREE_SPECIES.forEach((species, speciesIndex) => {
    const material = treeSpeciesMaterialVector(settings, species);
    const offset = TREE_GPU_RING_LAYOUT.speciesMaterialOffset + speciesIndex * 4;
    for (let i = 0; i < 4; i++) f32[offset + i] = material[i] ?? 1;
  });
  if (params.frustumPlanes) {
    for (let i = 0; i < Math.min(TREE_GPU_RING_VISIBLE_PLANE_FLOATS, params.frustumPlanes.length); i++) {
      f32[TREE_GPU_RING_LAYOUT.visiblePlanesOffset + i] = params.frustumPlanes[i] ?? 0;
    }
  }
  if (params.shadowCascadePlanes) {
    for (let i = 0; i < Math.min(TREE_GPU_RING_SHADOW_PLANE_FLOATS, params.shadowCascadePlanes.length); i++) {
      f32[TREE_GPU_RING_LAYOUT.shadowPlanesOffset + i] = params.shadowCascadePlanes[i] ?? 0;
    }
  }
  const atlas = params.hydroAtlas ?? [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) f32[TREE_GPU_RING_LAYOUT.hydroAtlasOffset + i] = atlas[i] ?? 0;
  return scratch;
}

export class TreeGpuRingCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly shadowCounterBuffer: GPUBuffer;
  private readonly visibleClusterMaskBuffer: GPUBuffer;
  private readonly visibleClusterMaskWordCapacity: number;
  private readonly activeSlotBuffer: GPUBuffer;
  private readonly activeSlotBufferCapacity: number;
  private readonly fullSlotIndices: Uint32Array;
  private activeSlotScratch = new Uint32Array(0);
  private readonly fallbackShadowCellBuffer: GPUBuffer | null;
  private readonly fallbackShadowIndirectBuffer: GPUBuffer | null;
  private readonly shadowOutputsReady: boolean;
  private readonly counterReadbacks: ReadbackSlot[];
  private readonly fieldParams: GPUBuffer;
  private digEdits: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly hydroTexture: GPUTexture;
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private counts: TreeGpuRingCounts = emptyTreeGpuRingCounts();
  private groupCounts = new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0);
  private shadowGroupCounts = new Array<number>(TREE_GPU_RING_SHADOW_GROUP_COUNT).fill(0);
  private terrainVisibilityCounts: TreeGpuTerrainVisibilityCounts | null = null;
  private candidateCountBeforePrefilter = 0;
  private candidateCountAfterPrefilter = 0;
  private overflowed = false;
  private shadowOverflowed = false;
  private runningReadbacks = 0;
  private failedReason: string | null = null;
  private submitMs: number | null = null;
  private readbackMs: number | null = null;
  private skippedDispatches = 0;
  private generation = 0;
  private frame = 0;

  private constructor(
    private readonly device: GPUDevice,
    layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    edits: readonly ResolvedDigEdit[],
    outputBuffers: TreeGpuRingOutputBuffers,
    private readonly settings: TreeSettings,
    hydroData: TreeHydrologyData | null,
  ) {
    this.pipelines = pipelines;
    this.shadowOutputsReady = !!outputBuffers.shadowCell && !!outputBuffers.shadowIndirectArgs;
    const slotCount = treeGpuRingSlotCount(settings);
    const workgroupSize = treeGpuRingWorkgroupSize(settings);
    this.visibleClusterMaskWordCapacity = slotCount;
    this.activeSlotBufferCapacity = Math.max(workgroupSize, roundUp(slotCount, workgroupSize));
    this.fullSlotIndices = makeFullSlotIndices(slotCount);
    this.candidateCountBeforePrefilter = slotCount;
    this.candidateCountAfterPrefilter = slotCount;
    this.visibleClusterMaskBuffer = device.createBuffer({ label: "tree ring visible cluster mask", size: Math.max(1, this.visibleClusterMaskWordCapacity) * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.activeSlotBuffer = device.createBuffer({ label: "tree ring active slot indices", size: Math.max(1, this.activeSlotBufferCapacity) * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.paramBuffer = device.createBuffer({ label: "tree ring params", size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.counterBuffer = device.createBuffer({ label: "tree ring counters", size: COUNTER_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.shadowCounterBuffer = device.createBuffer({ label: "tree ring shadow counters", size: SHADOW_COUNTER_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.fallbackShadowCellBuffer = outputBuffers.shadowCell ? null : device.createBuffer({ label: "tree ring fallback shadow cells", size: 16, usage: GPUBufferUsage.STORAGE });
    this.fallbackShadowIndirectBuffer = outputBuffers.shadowIndirectArgs ? null : device.createBuffer({ label: "tree ring fallback shadow indirect", size: TREE_GPU_RING_SHADOW_GROUP_COUNT * 5 * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE });
    this.fieldParams = device.createBuffer({ label: "tree ring field params", size: FIELD_PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.digEdits = device.createBuffer({ label: "tree ring dig edits", size: Math.max(1, edits.length) * DIG_EDIT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.digEdits, 0, packDigEdits(edits));
    const packedFieldParams = packFieldParams(edits.length);
    device.queue.writeBuffer(this.fieldParams, 0, packedFieldParams.buffer as ArrayBuffer, packedFieldParams.byteOffset, packedFieldParams.byteLength);
    this.counterReadbacks = Array.from({ length: READBACK_SLOTS }, (_, index) => ({
    buffer: device.createBuffer({ label: `tree ring counter readback ${index}`, size: READBACK_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    busy: false,
    destroyAfterMap: false,
    visibleCpu: new Uint32Array(TREE_GPU_RING_GROUP_COUNT),
    shadowCpu: new Uint32Array(TREE_GPU_RING_SHADOW_GROUP_COUNT),
    terrainVisibilityCpu: new Uint32Array(TREE_TERRAIN_VISIBILITY_COUNTER_COUNT),
    }));
    this.hydroTexture = createTreeHydrologyTexture(device, hydroData);
    const hydroSampler = device.createSampler({ label: "tree ring hydro sampler", magFilter: "nearest", minFilter: "nearest" });
    const canonicalHeight = heightfieldTileGpuAtlasBindings(device);
    this.bindGroup = device.createBindGroup({
      label: "tree ring bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
        { binding: 2, resource: { buffer: outputBuffers.indirectArgs } },
        { binding: 3, resource: { buffer: outputBuffers.cell } },
        { binding: 4, resource: { buffer: this.shadowCounterBuffer } },
        { binding: 5, resource: { buffer: outputBuffers.shadowIndirectArgs ?? this.fallbackShadowIndirectBuffer! } },
        { binding: 6, resource: { buffer: outputBuffers.shadowCell ?? this.fallbackShadowCellBuffer! } },
        { binding: 7, resource: { buffer: this.digEdits } },
        { binding: 8, resource: { buffer: this.fieldParams } },
        { binding: 9, resource: this.hydroTexture.createView() },
        { binding: 10, resource: hydroSampler },
        { binding: 11, resource: { buffer: this.visibleClusterMaskBuffer } },
        { binding: 12, resource: { buffer: this.activeSlotBuffer } },
        { binding: 13, resource: hydrologyAtlasGpuTexture(device).createView() },
        { binding: 14, resource: canonicalHeight.heightView },
        { binding: 15, resource: canonicalHeight.residencyView },
        { binding: 16, resource: { buffer: canonicalHeight.params } },
      ],
    });
  }

  static async create(device: GPUDevice, edits: readonly ResolvedDigEdit[], outputBuffers: TreeGpuRingOutputBuffers, settings: TreeSettings, hydroData: TreeHydrologyData | null = null): Promise<TreeGpuRingCompute> {
    const module = device.createShaderModule({ label: "tree ring compute shader", code: composeTreeRingShader(treeGpuRingWorkgroupSize(settings)) });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    const layout = device.createBindGroupLayout({
    label: "tree ring compute layout",
    entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    storage(1), storage(2), storage(3), storage(4), storage(5), storage(6), storage(7, "read-only-storage"),
    { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
    { binding: 10, visibility: GPUShaderStage.COMPUTE, sampler: { type: "non-filtering" } },
    storage(11, "read-only-storage"),
    storage(12, "read-only-storage"),
    { binding: 13, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
    { binding: 14, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
    { binding: 15, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "sint" } },
    { binding: 16, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) => device.createComputePipelineAsync({ label: `tree ring ${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
    const [clearCounters, cull, buildIndirectArgs] = await Promise.all([makePipeline("clear_counters"), makePipeline("tree_cull"), makePipeline("build_indirect_args")]);
    return new TreeGpuRingCompute(device, layout, { clear_counters: clearCounters, tree_cull: cull, build_indirect_args: buildIndirectArgs }, edits, outputBuffers, { ...settings }, hydroData ?? defaultTreeHydrologyData);
  }

  dispatch(params: TreeGpuRingDispatchParams): boolean {
    if (this.failedReason) return false;
    const frame = this.frame++;
    const requestReadback = treeGpuRingRequestsDebugReadback(this.settings, frame);
    const readbackSlot = requestReadback ? this.counterReadbacks.find((candidate) => !candidate.busy) ?? null : null;
    if (requestReadback && !readbackSlot) this.skippedDispatches++;
    const effectiveParams = this.shadowOutputsReady ? params : {
      ...params,
      maxShadowCastersPerGroup: 0,
      shadowCascadePlanes: undefined,
    };
    const activeSlots = this.prepareActiveSlotIndices(effectiveParams.activeSlotIndices);
    this.candidateCountBeforePrefilter = Math.max(0, Math.floor(effectiveParams.candidateCountBeforePrefilter ?? treeGpuRingSlotCount(this.settings)));
    this.candidateCountAfterPrefilter = Math.max(0, Math.floor(effectiveParams.candidateCountAfterPrefilter ?? activeSlots.count));
    packTreeGpuRingParams(
      this.settings,
      effectiveParams.hydroAtlas ? effectiveParams : { ...effectiveParams, hydroAtlas: hydrologyAtlasGpuParams() },
      this.paramScratch,
    );
    const u32 = new Uint32Array(this.paramScratch);
    if (readbackSlot) u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 1] |= 1;
    if (effectiveParams.visibleClusterMaskWords && effectiveParams.visibleClusterMaskWords.length > 0) {
      const wordCount = Math.min(effectiveParams.visibleClusterMaskWords.length, this.visibleClusterMaskWordCapacity);
      this.device.queue.writeBuffer(
        this.visibleClusterMaskBuffer,
        0,
        effectiveParams.visibleClusterMaskWords.buffer,
        effectiveParams.visibleClusterMaskWords.byteOffset,
        wordCount * Uint32Array.BYTES_PER_ELEMENT,
      );
    } else {
      u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 3] = 0;
    }
    this.device.queue.writeBuffer(
      this.activeSlotBuffer,
      0,
      activeSlots.data.buffer,
      activeSlots.data.byteOffset,
      activeSlots.data.byteLength,
    );
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);
    const encoder = this.device.createCommandEncoder({ label: "tree ring compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, treeGpuRingCounterWorkgroups(this.settings));
    this.dispatchPipeline(encoder, this.pipelines.tree_cull, treeGpuRingActiveCullWorkgroups(this.settings, activeSlots.paddedCount));
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, treeGpuRingBuildIndirectWorkgroups(this.settings));
    if (readbackSlot) {
      encoder.copyBufferToBuffer(this.counterBuffer, 0, readbackSlot.buffer, 0, COUNTER_BYTES);
      encoder.copyBufferToBuffer(this.shadowCounterBuffer, 0, readbackSlot.buffer, COUNTER_BYTES, SHADOW_COUNTER_BYTES);
    }
    const submittedGeneration = this.generation;
    const submitStart = performance.now();
    if (readbackSlot) { readbackSlot.busy = true; readbackSlot.destroyAfterMap = false; this.runningReadbacks++; }
    this.device.queue.submit([encoder.finish()]);
    this.submitMs = performance.now() - submitStart;
    if (readbackSlot) {
      const slot = readbackSlot;
      const readbackStart = performance.now();
      void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
        if (submittedGeneration !== this.generation) {
          slot.busy = false; slot.destroyAfterMap = false; this.runningReadbacks = Math.max(0, this.runningReadbacks - 1); slot.buffer.unmap(); slot.buffer.destroy(); return;
        }
        const mapped = slot.buffer.getMappedRange(0, READBACK_BYTES);
        slot.visibleCpu.set(new Uint32Array(mapped, 0, TREE_GPU_RING_GROUP_COUNT));
        slot.shadowCpu.set(new Uint32Array(mapped, COUNTER_BYTES, TREE_GPU_RING_SHADOW_GROUP_COUNT));
        slot.terrainVisibilityCpu.set(new Uint32Array(mapped, COUNTER_BYTES + TREE_TERRAIN_VISIBILITY_COUNTER_OFFSET * Uint32Array.BYTES_PER_ELEMENT, TREE_TERRAIN_VISIBILITY_COUNTER_COUNT));
        slot.buffer.unmap();
        slot.busy = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        this.readbackMs = performance.now() - readbackStart;
        const resolved = resolveTreeGpuRingReadbackCounts(slot.visibleCpu, effectiveParams.maxInstancesPerGroup);
        const resolvedShadow = resolveTreeGpuRingShadowReadbackCounts(slot.shadowCpu, effectiveParams.maxShadowCastersPerGroup ?? 0);
        this.groupCounts = resolved.groupCounts;
        this.shadowGroupCounts = resolvedShadow.groupCounts;
        this.counts = resolved.counts;
        this.overflowed = resolved.overflowed;
        this.shadowOverflowed = resolvedShadow.overflowed;
        this.terrainVisibilityCounts = {
          terrainHiddenCandidates: slot.terrainVisibilityCpu[0] ?? 0,
          terrainVisibleCandidates: slot.terrainVisibilityCpu[1] ?? 0,
        };
        if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); }
      }).catch((error) => {
        if (submittedGeneration !== this.generation) {
          slot.busy = false; slot.destroyAfterMap = false; this.runningReadbacks = Math.max(0, this.runningReadbacks - 1); slot.buffer.destroy(); return;
        }
        slot.busy = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); return; }
        this.failedReason = error instanceof Error ? error.message : String(error);
      });
    }
    return true;
  }

  stats(enabled: boolean): TreeGpuRingStats {
    const acceptedCandidates = this.counts.near + this.counts.mid + this.counts.far + this.counts.impostor;
    return {
      status: !enabled ? "disabled" : this.failedReason ? "failed" : this.runningReadbacks > 0 ? "running" : "ready",
      reason: this.failedReason ?? undefined,
      candidateCount: this.candidateCountAfterPrefilter,
      candidateCountBeforePrefilter: this.candidateCountBeforePrefilter,
      candidateCountAfterPrefilter: this.candidateCountAfterPrefilter,
      acceptedCandidates,
      counts: { ...this.counts },
      groupCounts: [...this.groupCounts],
      shadowGroupCounts: [...this.shadowGroupCounts],
      overflowed: this.overflowed,
      shadowOverflowed: this.shadowOverflowed,
      submitMs: this.submitMs,
      readbackMs: this.readbackMs,
      skippedDispatches: this.skippedDispatches,
      terrainVisibilityCounts: this.terrainVisibilityCounts ? { ...this.terrainVisibilityCounts } : null,
    };
  }

  destroy(): void {
    this.generation++;
    this.runningReadbacks = 0;
    this.paramBuffer.destroy();
    this.counterBuffer.destroy();
    this.shadowCounterBuffer.destroy();
    this.visibleClusterMaskBuffer.destroy();
    this.activeSlotBuffer.destroy();
    this.fallbackShadowCellBuffer?.destroy();
    this.fallbackShadowIndirectBuffer?.destroy();
    this.digEdits.destroy();
    this.fieldParams.destroy();
    this.hydroTexture.destroy();
    for (const slot of this.counterReadbacks) {
      if (slot.busy) slot.destroyAfterMap = true;
      else slot.buffer.destroy();
    }
  }

  private prepareActiveSlotIndices(source: Uint32Array | undefined): { data: Uint32Array; count: number; paddedCount: number } {
    const slotCount = treeGpuRingSlotCount(this.settings);
    const input = source === undefined ? this.fullSlotIndices : source;
    const count = Math.min(input.length, slotCount);
    const workgroupSize = treeGpuRingWorkgroupSize(this.settings);
    const paddedCount = source !== undefined && count === 0
      ? workgroupSize
      : Math.max(workgroupSize, roundUp(Math.max(1, count), workgroupSize));
    if (paddedCount > this.activeSlotBufferCapacity) {
      throw new Error(`tree active slot list exceeds buffer capacity: ${paddedCount} > ${this.activeSlotBufferCapacity}`);
    }
    if (this.activeSlotScratch.length < paddedCount) this.activeSlotScratch = new Uint32Array(paddedCount);
    this.activeSlotScratch.fill(TREE_GPU_RING_SENTINEL_SLOT, 0, paddedCount);
    if (count > 0) this.activeSlotScratch.set(input.subarray(0, count), 0);
    return { data: this.activeSlotScratch.subarray(0, paddedCount), count, paddedCount };
  }

  private dispatchPipeline(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, workgroups: number): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.max(1, workgroups));
    pass.end();
  }
}

function speciesWeight(settings: TreeSettings, species: TreeSpeciesId): number {
  const config = settings.species[species];
  return config.enabled ? Math.max(0, config.weight) : 0;
}

function aggregateLodCounts(groupCounts: readonly number[]): TreeGpuRingCounts {
  const counts = emptyTreeGpuRingCounts();
  for (const species of TREE_SPECIES) {
    for (const treeLod of TREE_LODS) counts[treeLod] += groupCounts[treeGpuRingGroupIndex(species, treeLod)] ?? 0;
  }
  return counts;
}

function roundUp(value: number, step: number): number {
  const safeStep = Math.max(1, Math.floor(step));
  return Math.ceil(Math.max(0, Math.floor(value)) / safeStep) * safeStep;
}

function makeFullSlotIndices(slotCount: number): Uint32Array {
  const result = new Uint32Array(Math.max(0, Math.floor(slotCount)));
  for (let i = 0; i < result.length; i++) result[i] = i;
  return result;
}
