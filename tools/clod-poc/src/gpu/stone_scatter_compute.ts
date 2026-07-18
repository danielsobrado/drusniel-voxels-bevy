import { DIG_EDIT_BYTES, FIELD_PARAM_WORDS, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import type { ResolvedDigEdit } from "./terrain_field_core.js";
import type { StoneSettings, StoneTerrainClassWeights } from "../stones/stone_config.js";
import { composeStoneScatterShader } from "./wgsl_modules.js";
import type { GrassHydrologyData } from "./grass_ring_compute.js";
import {
  hydrologyAtlasGpuFieldsTexture,
  hydrologyAtlasGpuParams,
  hydrologyAtlasGpuTexture,
} from "./hydrology_atlas_gpu.js";
import { shouldRequestGpuReadback } from "../diagnostics/gpu_readback_policy.js";
import { GpuTimestampRecorder, type GpuTimestampSnapshot } from "../diagnostics/gpu_timestamp_recorder.js";
import { heightfieldTileGpuAtlasBindings } from "../world/heightfield_tiles/heightfield_tile_gpu_atlas.js";

const WORKGROUP_SIZE = 64;
const CLASS_COUNT = 3;
const SCATTER_COUNTER_COUNT = 12;
const MAX_VIEW_GROUPS = 32;
const COUNTER_TOTAL_COUNT = SCATTER_COUNTER_COUNT + MAX_VIEW_GROUPS;
// 21 scatter vec4s + view_counts + camera + 6 frustum + 3 class_view + variants + 8 index-count lanes.
const PARAM_BYTES = 16 * 41;
const COUNTER_BYTES = SCATTER_COUNTER_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const INDIRECT_ARGS_PER_GROUP = 5;
const READBACK_INTERVAL_FRAMES = 30;
const READBACK_SLOTS = 2;
const TIMING_LABELS = ["clear", "world", "view", "indirect"] as const;

export const STONE_GPU_RING_MAX_SAFE_GRID = 512;
export const STONE_GPU_SCATTER_STORAGE_BINDINGS = 7;

const COUNTER_ACCEPTED_TOTAL = 0;
const COUNTER_CLASS_LARGE = 1;
const COUNTER_CLASS_MEDIUM = 2;
const COUNTER_CLASS_SMALL = 3;
const COUNTER_CANDIDATES_TOTAL = 4;
const COUNTER_REJECT_OUTSIDE_WORLD = 5;
const COUNTER_REJECT_TOO_FAR = 6;
const COUNTER_REJECT_BELOW_WATER = 7;
const COUNTER_REJECT_TOO_STEEP = 8;
const COUNTER_REJECT_DENSITY_MASK = 9;
const COUNTER_REJECT_TILE_BUDGET = 10;
const COUNTER_REJECT_CLASS_BUDGET = 11;

export type StoneGpuClassIndex = 0 | 1 | 2;

export interface StoneHydrologyData { res: number; worldCells: number; data: Float32Array }
export interface StoneGpuScatterBuffers { instanceA: GPUBuffer; instanceB: GPUBuffer; indirectArgs: GPUBuffer }

/** Static per-rebuild view configuration: group layout, LOD boundaries, draw budgets. */
export interface StoneGpuViewConfig {
  /** Per-class source-buffer capacity (stones surviving scatter). */
  sourceClassCap: number;
  /** Per-group draw-instance capacity (uniform across groups). */
  groupCap: number;
  /** Total (class x variant x lod) draw group count. */
  groupCount: number;
  /** Per class: [maxDistanceM, lodNearM, lodCount, groupBase]. */
  classView: readonly (readonly [number, number, number, number])[];
  /** Per class variant count. */
  classVariants: readonly [number, number, number];
  /** Index count of each group's geometry, group-ordered. */
  groupIndexCounts: readonly number[];
}

export interface StoneGpuScatterParams {
  worldCells: number;
  centerX: number;
  centerZ: number;
  unboundedWorld?: boolean;
  riverCobblesEnabled?: boolean;
  settings: StoneSettings;
}

export interface StoneGpuViewParams {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  frustumPlanes: ArrayLike<number>;
}

export interface StoneGpuScatterCounts {
  large: number;
  medium: number;
  small: number;
  totalAccepted: number;
  candidatesTotal: number;
  rejectedTotal: number;
  rejectedOutsideWorld: number;
  rejectedTooFar: number;
  rejectedBelowWater: number;
  rejectedTooSteep: number;
  rejectedDensityMask: number;
  rejectedTileBudget: number;
  rejectedClassBudget: number;
}
export interface StoneGpuClassRegion { start: number; end: number; firstInstance: number }

interface CounterReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
  destroyAfterMap: boolean;
}

type PipelineName =
  | "clear_counters"
  | "scatter_stones"
  | "clear_view_counters"
  | "cull_stones"
  | "build_indirect_args";
type StoneTelemetryCallback = (counts: StoneGpuScatterCounts) => void;

export function stoneGpuScatterUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= STONE_GPU_SCATTER_STORAGE_BINDINGS) return null;
  return `stone GPU scatter requires ${STONE_GPU_SCATTER_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export function stoneGpuClassRegion(classIndex: number, maxInstances: number): StoneGpuClassRegion {
  const start = Math.max(0, Math.floor(classIndex)) * Math.max(0, Math.floor(maxInstances));
  return { start, end: start + Math.max(0, Math.floor(maxInstances)), firstInstance: start };
}

export function stoneGpuOutputIndex(classIndex: number, slot: number, maxInstances: number): number {
  return stoneGpuClassRegion(classIndex, maxInstances).start + Math.max(0, Math.floor(slot));
}

export function stoneGpuScatterGrid(settings: StoneSettings): number {
  const cellSize = Math.max(0.1, settings.cellSizeM);
  const ringRadius = Math.max(cellSize, settings.ringRadiusM);
  return Math.min(STONE_GPU_RING_MAX_SAFE_GRID, Math.max(1, Math.ceil((ringRadius * 2) / cellSize)));
}

/** Source capacity is bounded by the candidate grid: at most one stone per cell. */
export function stoneGpuSourceClassCap(settings: StoneSettings): number {
  const grid = stoneGpuScatterGrid(settings);
  return Math.max(1, Math.min(Math.max(0, Math.floor(settings.maxInstances)), grid * grid));
}

export class StoneGpuScatterCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly counterReadbacks: CounterReadbackSlot[];
  private readonly fieldParams: GPUBuffer;
  private readonly digEdits: GPUBuffer;
  private readonly hydroTexture: GPUTexture;
  private readonly hydroFieldsTexture: GPUTexture;
  private readonly sourceA: GPUBuffer;
  private readonly sourceB: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly paramF32 = new Float32Array(this.paramScratch);
  private readonly paramU32 = new Uint32Array(this.paramScratch);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private readonly timestamps: GpuTimestampRecorder;
  private readonly viewConfig: StoneGpuViewConfig;
  private telemetryCallback: StoneTelemetryCallback | null = null;
  private effectiveMaxInstances = 0;
  private frame = 0;
  private generation = 0;
  private skippedCounterReadbacks = 0;

  private constructor(
    private readonly device: GPUDevice,
    layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    edits: readonly ResolvedDigEdit[],
    private readonly buffers: StoneGpuScatterBuffers,
    hydroData: GrassHydrologyData | null,
    hydroFieldsData: GrassHydrologyData | null,
    viewConfig: StoneGpuViewConfig,
  ) {
    this.pipelines = pipelines;
    this.viewConfig = viewConfig;
    this.timestamps = new GpuTimestampRecorder(device, "stones", TIMING_LABELS);
    this.paramBuffer = device.createBuffer({ label: "stone scatter params", size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.counterBuffer = device.createBuffer({ label: "stone scatter counters", size: COUNTER_TOTAL_COUNT * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const sourceBytes = Math.max(1, viewConfig.sourceClassCap) * CLASS_COUNT * 16;
    this.sourceA = device.createBuffer({ label: "stone scatter source a", size: sourceBytes, usage: GPUBufferUsage.STORAGE });
    this.sourceB = device.createBuffer({ label: "stone scatter source b", size: sourceBytes, usage: GPUBufferUsage.STORAGE });
    this.counterReadbacks = Array.from({ length: READBACK_SLOTS }, (_, index) => ({
      buffer: device.createBuffer({ label: `stone scatter counter readback ${index}`, size: COUNTER_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      busy: false,
      destroyAfterMap: false,
    }));
    this.fieldParams = device.createBuffer({ label: "stone scatter field params", size: FIELD_PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.digEdits = device.createBuffer({ label: "stone scatter dig edits", size: Math.max(1, edits.length) * DIG_EDIT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.digEdits, 0, packDigEdits(edits));
    const packedFieldParams = packFieldParams(edits.length);
    device.queue.writeBuffer(this.fieldParams, 0, packedFieldParams.buffer as ArrayBuffer, packedFieldParams.byteOffset, packedFieldParams.byteLength);
    this.hydroTexture = this.createHydrologyTexture("stone scatter hydrology layout a", hydroData);
    this.hydroFieldsTexture = this.createHydrologyTexture("stone scatter hydrology layout b", hydroFieldsData);
    const hydroSampler = device.createSampler({ label: "stone scatter hydro sampler", magFilter: "nearest", minFilter: "nearest" });
    const canonicalHeight = heightfieldTileGpuAtlasBindings(device);
    this.bindGroup = device.createBindGroup({
      label: "stone scatter bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
        { binding: 2, resource: { buffer: this.buffers.indirectArgs } },
        { binding: 3, resource: { buffer: this.buffers.instanceA } },
        { binding: 4, resource: { buffer: this.buffers.instanceB } },
        { binding: 5, resource: { buffer: this.digEdits } },
        { binding: 6, resource: { buffer: this.fieldParams } },
        { binding: 7, resource: this.hydroTexture.createView() },
        { binding: 8, resource: hydroSampler },
        { binding: 9, resource: hydrologyAtlasGpuTexture(device).createView() },
        { binding: 10, resource: canonicalHeight.heightView },
        { binding: 11, resource: canonicalHeight.residencyView },
        { binding: 12, resource: { buffer: canonicalHeight.params } },
        { binding: 13, resource: { buffer: this.sourceA } },
        { binding: 14, resource: { buffer: this.sourceB } },
        { binding: 15, resource: this.hydroFieldsTexture.createView() },
        { binding: 16, resource: hydrologyAtlasGpuFieldsTexture(device).createView() },
      ],
    });
    this.packStaticViewConfig();
  }

  static async create(
    device: GPUDevice,
    edits: readonly ResolvedDigEdit[],
    buffers: StoneGpuScatterBuffers,
    hydroData: GrassHydrologyData | null,
    hydroFieldsData: GrassHydrologyData | null,
    viewConfig: StoneGpuViewConfig,
  ): Promise<StoneGpuScatterCompute> {
    const module = device.createShaderModule({ label: "stone scatter compute shader", code: composeStoneScatterShader() });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    const texture = (binding: number, sampleType: GPUTextureSampleType = "unfilterable-float"): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      texture: { sampleType },
    });
    const layout = device.createBindGroupLayout({
      label: "stone scatter compute layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(1), storage(2), storage(3), storage(4),
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        texture(7),
        { binding: 8, visibility: GPUShaderStage.COMPUTE, sampler: { type: "non-filtering" } },
        texture(9),
        texture(10),
        texture(11, "sint"),
        { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(13), storage(14),
        texture(15), texture(16),
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) => device.createComputePipelineAsync({ label: `stone scatter ${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
    const [clearCounters, scatterStones, clearViewCounters, cullStones, buildIndirectArgs] = await Promise.all([
      makePipeline("clear_counters"),
      makePipeline("scatter_stones"),
      makePipeline("clear_view_counters"),
      makePipeline("cull_stones"),
      makePipeline("build_indirect_args"),
    ]);
    return new StoneGpuScatterCompute(
      device,
      layout,
      {
        clear_counters: clearCounters,
        scatter_stones: scatterStones,
        clear_view_counters: clearViewCounters,
        cull_stones: cullStones,
        build_indirect_args: buildIndirectArgs,
      },
      edits,
      buffers,
      hydroData,
      hydroFieldsData,
      viewConfig,
    );
  }

  /** Movement-triggered world scatter into the persistent source buffers. */
  run(params: StoneGpuScatterParams, onTelemetry?: StoneTelemetryCallback): boolean {
    const settings = params.settings;
    if (onTelemetry) this.telemetryCallback = onTelemetry;
    const cellSize = Math.max(0.1, settings.cellSizeM);
    const ringRadius = Math.max(cellSize, settings.ringRadiusM);
    const grid = stoneGpuScatterGrid(settings);
    this.effectiveMaxInstances = Math.min(stoneGpuSourceClassCap(settings), this.viewConfig.sourceClassCap);

    this.packScatterParams(params, this.effectiveMaxInstances, cellSize, ringRadius, grid);
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);

    const encoder = this.device.createCommandEncoder({ label: "stone scatter compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, 1, "clear");
    this.dispatchPipeline(encoder, this.pipelines.scatter_stones, Math.ceil((grid * grid) / WORKGROUP_SIZE), "world");
    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  /** Per-frame view pass: frustum + distance cull into compacted per-group indirect draws. */
  view(params: StoneGpuViewParams): boolean {
    if (this.effectiveMaxInstances <= 0) return false;
    this.packViewParams(params);
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);

    const frame = this.frame++;
    const requestReadback = shouldRequestGpuReadback({ kind: "stone_gpu_counts", frame, intervalFrames: READBACK_INTERVAL_FRAMES });
    const readbackSlot = requestReadback
      ? this.counterReadbacks.find((candidate) => !candidate.busy) ?? null
      : null;
    if (requestReadback && !readbackSlot) this.skippedCounterReadbacks++;

    const encoder = this.device.createCommandEncoder({ label: "stone view compute encoder" });
    const groupWorkgroups = Math.ceil(this.viewConfig.groupCount / WORKGROUP_SIZE);
    const cullWorkgroups = Math.ceil((this.effectiveMaxInstances * CLASS_COUNT) / WORKGROUP_SIZE);
    this.dispatchPipeline(encoder, this.pipelines.clear_view_counters, groupWorkgroups, "clear");
    this.dispatchPipeline(encoder, this.pipelines.cull_stones, cullWorkgroups, "view");
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, groupWorkgroups, "indirect");
    if (readbackSlot) {
      readbackSlot.busy = true;
      readbackSlot.destroyAfterMap = false;
      encoder.copyBufferToBuffer(this.counterBuffer, 0, readbackSlot.buffer, 0, COUNTER_BYTES);
    }
    const timingSlot = this.timestamps.encodeReadback(encoder, frame);
    this.device.queue.submit([encoder.finish()]);
    this.timestamps.submitReadback(timingSlot);
    if (readbackSlot) this.readbackCounts(readbackSlot, this.effectiveMaxInstances, this.telemetryCallback ?? undefined);
    publishStoneTimingShape(this.timestamps.snapshot(), this.skippedCounterReadbacks);
    return true;
  }

  timingSnapshot(): GpuTimestampSnapshot {
    return this.timestamps.snapshot();
  }

  destroy(): void {
    this.generation++;
    this.paramBuffer.destroy();
    this.counterBuffer.destroy();
    for (const slot of this.counterReadbacks) {
      if (slot.busy) slot.destroyAfterMap = true;
      else slot.buffer.destroy();
    }
    this.digEdits.destroy();
    this.fieldParams.destroy();
    this.hydroTexture.destroy();
    this.hydroFieldsTexture.destroy();
    this.sourceA.destroy();
    this.sourceB.destroy();
    this.timestamps.destroy();
  }

  private packScatterParams(
    params: StoneGpuScatterParams,
    maxInstances: number,
    cellSize: number,
    ringRadius: number,
    grid: number,
  ): void {
    const settings = params.settings;
    this.paramF32[0] = params.worldCells;
    this.paramF32[1] = cellSize;
    this.paramF32[2] = Math.max(0, settings.density);
    this.paramF32[3] = 0;
    this.paramF32[4] = settings.slopeReposeStart;
    this.paramF32[5] = settings.slopeRepose;
    this.paramF32[6] = settings.waterMarginM + settings.standingWaterCutoffM;
    this.paramF32[7] = settings.streamLargeBias;
    this.paramF32[8] = settings.cliffProbeNearM;
    this.paramF32[9] = settings.cliffProbeFarM;
    this.paramF32[10] = settings.cliffRiseStart;
    this.paramF32[11] = settings.cliffRiseEnd;
    this.paramF32[12] = settings.streambedSandStart;
    this.paramF32[13] = settings.streambedSandEnd;
    this.paramF32[14] = settings.snowFade;
    this.paramF32[15] = settings.normalLean;
    this.paramF32[16] = settings.rockExposureWeight;
    this.paramF32[17] = settings.screeWeight;
    this.paramF32[18] = settings.cliffAboveWeight;
    this.paramF32[19] = settings.streamWeight;
    this.paramF32[20] = settings.baseSoilWeight;
    this.paramF32[21] = settings.patchClumpMin;
    this.paramF32[22] = settings.patchClumpCellMult;
    this.paramF32[23] = settings.sinkSlopeMultiplier;
    this.writeClassConfig(24, settings.classes.large);
    this.writeClassConfig(28, settings.classes.medium);
    this.writeClassConfig(32, settings.classes.small);
    this.paramU32[36] = maxInstances;
    this.paramU32[37] = grid;
    this.paramU32[38] = settings.seedSalt >>> 0;
    this.paramU32[39] = params.riverCobblesEnabled ? 1 : 0;
    this.paramU32[40] = 0;
    this.paramU32[41] = 0;
    this.paramU32[42] = params.unboundedWorld ? 1 : 0;
    this.paramU32[43] = 0;
    this.paramF32[44] = clampFinite(params.centerX, 0, params.worldCells, params.unboundedWorld === true);
    this.paramF32[45] = clampFinite(params.centerZ, 0, params.worldCells, params.unboundedWorld === true);
    this.paramF32[46] = ringRadius;
    this.paramF32[47] = Math.max(0, settings.ringEdgeFadeM);
    this.writeTerrainConfig(48, settings.terrain.grass);
    this.writeTerrainConfig(52, settings.terrain.rock);
    this.writeTerrainConfig(56, settings.terrain.sand);
    this.writeTerrainConfig(60, settings.terrain.snow);
    this.writeTerrainConfig(64, settings.terrain.low);
    this.writeTerrainConfig(68, settings.terrain.mid);
    this.writeTerrainConfig(72, settings.terrain.high);
    this.paramF32[76] = settings.terrain.lowHeightM;
    this.paramF32[77] = settings.terrain.highHeightM;
    this.paramF32[78] = Math.max(0.001, settings.terrain.heightBlendM);
    this.paramF32[79] = 0;
    const hydroAtlas = hydrologyAtlasGpuParams();
    for (let i = 0; i < 4; i++) this.paramF32[80 + i] = hydroAtlas[i] ?? 0;
    // view_counts.z tracks the source stride the cull pass must walk.
    this.paramU32[86] = this.effectiveMaxInstances;
  }

  private packViewParams(params: StoneGpuViewParams): void {
    this.paramU32[86] = this.effectiveMaxInstances;
    this.paramF32[88] = params.cameraX;
    this.paramF32[89] = params.cameraY;
    this.paramF32[90] = params.cameraZ;
    this.paramF32[91] = 0;
    const fp = params.frustumPlanes;
    for (let i = 0; i < 24; i++) this.paramF32[92 + i] = fp[i] ?? 0;
  }

  private packStaticViewConfig(): void {
    const config = this.viewConfig;
    this.paramU32[84] = Math.max(0, Math.floor(config.groupCap));
    this.paramU32[85] = Math.max(0, Math.min(MAX_VIEW_GROUPS, Math.floor(config.groupCount)));
    this.paramU32[86] = 0;
    this.paramU32[87] = 0;
    for (let cls = 0; cls < CLASS_COUNT; cls++) {
      const view = config.classView[cls] ?? [0, 0, 1, 0];
      const base = 116 + cls * 4;
      this.paramF32[base] = view[0];
      this.paramF32[base + 1] = view[1];
      this.paramF32[base + 2] = view[2];
      this.paramF32[base + 3] = view[3];
    }
    this.paramF32[128] = config.classVariants[0];
    this.paramF32[129] = config.classVariants[1];
    this.paramF32[130] = config.classVariants[2];
    this.paramF32[131] = 0;
    for (let group = 0; group < MAX_VIEW_GROUPS; group++) {
      this.paramU32[132 + group] = Math.max(0, Math.floor(config.groupIndexCounts[group] ?? 0));
    }
  }

  private readbackCounts(
    slot: CounterReadbackSlot,
    maxInstances: number,
    onTelemetry: StoneTelemetryCallback | undefined,
  ): void {
    const generation = this.generation;
    void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (generation !== this.generation) {
        slot.buffer.unmap();
        slot.busy = false;
        if (slot.destroyAfterMap) slot.buffer.destroy();
        return;
      }
      const raw = new Uint32Array(slot.buffer.getMappedRange(0, COUNTER_BYTES).slice(0));
      slot.buffer.unmap();
      slot.busy = false;
      onTelemetry?.(resolveCounts(raw, maxInstances));
      if (slot.destroyAfterMap) {
        slot.destroyAfterMap = false;
        slot.buffer.destroy();
      }
    }).catch((error) => {
      slot.busy = false;
      if (slot.destroyAfterMap) {
        slot.destroyAfterMap = false;
        slot.buffer.destroy();
        return;
      }
      console.warn("stone GPU counter readback failed", error);
    });
  }

  private writeClassConfig(offset: number, cls: StoneSettings["classes"]["large"]): void {
    this.paramF32[offset] = cls.radiusMin;
    this.paramF32[offset + 1] = cls.radiusMax;
    this.paramF32[offset + 2] = cls.sink;
    this.paramF32[offset + 3] = cls.maxDistance;
  }

  private writeTerrainConfig(offset: number, terrain: StoneTerrainClassWeights): void {
    this.paramF32[offset] = terrain.density;
    this.paramF32[offset + 1] = terrain.large;
    this.paramF32[offset + 2] = terrain.medium;
    this.paramF32[offset + 3] = terrain.small;
  }

  private dispatchPipeline(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    workgroups: number,
    timingLabel: typeof TIMING_LABELS[number],
  ): void {
    const pass = encoder.beginComputePass(this.timestamps.passDescriptor(timingLabel));
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.max(1, workgroups));
    pass.end();
  }

  private createHydrologyTexture(label: string, hydroData: GrassHydrologyData | null): GPUTexture {
    if (hydroData && hydroData.data.length > 0) {
      const texture = this.device.createTexture({
        label,
        size: { width: hydroData.res, height: hydroData.res },
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const bytes = new Uint8Array(hydroData.data.byteLength);
      bytes.set(new Uint8Array(hydroData.data.buffer, hydroData.data.byteOffset, hydroData.data.byteLength));
      this.device.queue.writeTexture(
        { texture },
        bytes,
        { bytesPerRow: hydroData.res * 16 },
        { width: hydroData.res, height: hydroData.res },
      );
      return texture;
    }
    return this.device.createTexture({
      label: `${label} fallback`,
      size: { width: 1, height: 1 },
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
  }
}

function resolveCounts(raw: Uint32Array, maxInstances: number): StoneGpuScatterCounts {
  const large = Math.min(raw[COUNTER_CLASS_LARGE] ?? 0, maxInstances);
  const medium = Math.min(raw[COUNTER_CLASS_MEDIUM] ?? 0, maxInstances);
  const small = Math.min(raw[COUNTER_CLASS_SMALL] ?? 0, maxInstances);
  const accepted = Math.min(raw[COUNTER_ACCEPTED_TOTAL] ?? 0, maxInstances);
  const rejectedTileBudget = raw[COUNTER_REJECT_TILE_BUDGET] ?? 0;
  const rejectedClassBudget = raw[COUNTER_REJECT_CLASS_BUDGET] ?? 0;
  return {
    large,
    medium,
    small,
    totalAccepted: accepted,
    candidatesTotal: raw[COUNTER_CANDIDATES_TOTAL] ?? 0,
    rejectedTotal:
      (raw[COUNTER_REJECT_OUTSIDE_WORLD] ?? 0) +
      (raw[COUNTER_REJECT_TOO_FAR] ?? 0) +
      (raw[COUNTER_REJECT_BELOW_WATER] ?? 0) +
      (raw[COUNTER_REJECT_TOO_STEEP] ?? 0) +
      (raw[COUNTER_REJECT_DENSITY_MASK] ?? 0) +
      rejectedTileBudget +
      rejectedClassBudget,
    rejectedOutsideWorld: raw[COUNTER_REJECT_OUTSIDE_WORLD] ?? 0,
    rejectedTooFar: raw[COUNTER_REJECT_TOO_FAR] ?? 0,
    rejectedBelowWater: raw[COUNTER_REJECT_BELOW_WATER] ?? 0,
    rejectedTooSteep: raw[COUNTER_REJECT_TOO_STEEP] ?? 0,
    rejectedDensityMask: raw[COUNTER_REJECT_DENSITY_MASK] ?? 0,
    rejectedTileBudget,
    rejectedClassBudget,
  };
}

function publishStoneTimingShape(snapshot: GpuTimestampSnapshot, skippedCounterReadbacks: number): void {
  const counters = globalCounters();
  if (!counters) return;
  counters["stones.gpuTiming.worldViewFused"] = 0;
  counters["stones.gpuTiming.hasSeparateViewPass"] = 1;
  counters["stones.gpuTiming.counterReadbacksSkipped"] = skippedCounterReadbacks;
  counters["stones.gpuTiming.pending"] = snapshot.pending ? 1 : 0;
}

function globalCounters(): Record<string, number> | null {
  return (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters ?? null;
}

function clampFinite(value: number, min: number, max: number, unbounded = false): number {
  if (!Number.isFinite(value)) return min;
  return unbounded ? value : Math.min(max, Math.max(min, value));
}

export const STONE_GPU_CLASS_COUNT = CLASS_COUNT;
export const STONE_GPU_INDIRECT_BYTES = CLASS_COUNT * INDIRECT_ARGS_PER_GROUP * Uint32Array.BYTES_PER_ELEMENT;
