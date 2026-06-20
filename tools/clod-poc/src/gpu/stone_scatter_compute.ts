import { DIG_EDIT_BYTES, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import type { ResolvedDigEdit } from "./terrain_field_core.js";
import type { StoneSettings } from "../stones/stone_config.js";
import { composeStoneScatterShader } from "./wgsl_modules.js";

const WORKGROUP_SIZE = 64;
const CLASS_COUNT = 3;
const COUNTER_COUNT = 4;
const PARAM_BYTES = 16 * 11;
const COUNTER_BYTES = COUNTER_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const INDIRECT_ARGS_PER_CLASS = 5;
const INDIRECT_BYTES = CLASS_COUNT * INDIRECT_ARGS_PER_CLASS * Uint32Array.BYTES_PER_ELEMENT;
// Storage buffers in the bind group: counters, indirect_args, instance_a, instance_b, digEdits.
// (bindings 0 and 6 are uniforms and don't count against this limit.)
export const STONE_GPU_SCATTER_STORAGE_BINDINGS = 5;

export type StoneGpuClassIndex = 0 | 1 | 2;

export interface StoneGpuScatterBuffers {
  instanceA: GPUBuffer;
  instanceB: GPUBuffer;
  indirectArgs: GPUBuffer;
}

export interface StoneGpuScatterParams {
  worldCells: number;
  settings: StoneSettings;
  indexCounts: [number, number, number];
}

export interface StoneGpuScatterCounts {
  large: number;
  medium: number;
  small: number;
}

export interface StoneGpuClassRegion {
  start: number;
  end: number;
  firstInstance: number;
}

type PipelineName = "clear_counters" | "scatter_stones" | "build_indirect_args";

export function stoneGpuScatterUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= STONE_GPU_SCATTER_STORAGE_BINDINGS) return null;
  return `stone GPU scatter requires ${STONE_GPU_SCATTER_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export function stoneGpuClassRegion(classIndex: number, maxInstances: number): StoneGpuClassRegion {
  const start = Math.max(0, Math.floor(classIndex)) * Math.max(0, Math.floor(maxInstances));
  return {
    start,
    end: start + Math.max(0, Math.floor(maxInstances)),
    firstInstance: start,
  };
}

export function stoneGpuOutputIndex(classIndex: number, slot: number, maxInstances: number): number {
  return stoneGpuClassRegion(classIndex, maxInstances).start + Math.max(0, Math.floor(slot));
}

export class StoneGpuScatterCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly counterReadback: GPUBuffer;
  private readonly fieldParams: GPUBuffer;
  private readonly digEdits: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly paramF32 = new Float32Array(this.paramScratch);
  private readonly paramU32 = new Uint32Array(this.paramScratch);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;

  private constructor(
    private readonly device: GPUDevice,
    layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    edits: readonly ResolvedDigEdit[],
    private readonly buffers: StoneGpuScatterBuffers,
  ) {
    this.pipelines = pipelines;
    this.paramBuffer = device.createBuffer({
      label: "stone scatter params",
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.counterBuffer = device.createBuffer({
      label: "stone scatter counters",
      size: COUNTER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.counterReadback = device.createBuffer({
      label: "stone scatter counter readback",
      size: COUNTER_BYTES,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.fieldParams = device.createBuffer({
      label: "stone scatter field params",
      size: 4 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.digEdits = device.createBuffer({
      label: "stone scatter dig edits",
      size: Math.max(1, edits.length) * DIG_EDIT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.digEdits, 0, packDigEdits(edits));
    const packedFieldParams = packFieldParams(edits.length);
    device.queue.writeBuffer(
      this.fieldParams,
      0,
      packedFieldParams.buffer as ArrayBuffer,
      packedFieldParams.byteOffset,
      packedFieldParams.byteLength,
    );
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
      ],
    });
  }

  static async create(
    device: GPUDevice,
    edits: readonly ResolvedDigEdit[],
    buffers: StoneGpuScatterBuffers,
  ): Promise<StoneGpuScatterCompute> {
    const module = device.createShaderModule({
      label: "stone scatter compute shader",
      code: composeStoneScatterShader(),
    });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    });
    const layout = device.createBindGroupLayout({
      label: "stone scatter compute layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(1),
        storage(2),
        storage(3),
        storage(4),
        storage(5, "read-only-storage"),
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) =>
      device.createComputePipelineAsync({
        label: `stone scatter ${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      });
    const [clearCounters, scatterStones, buildIndirectArgs] = await Promise.all([
      makePipeline("clear_counters"),
      makePipeline("scatter_stones"),
      makePipeline("build_indirect_args"),
    ]);
    return new StoneGpuScatterCompute(device, layout, {
      clear_counters: clearCounters,
      scatter_stones: scatterStones,
      build_indirect_args: buildIndirectArgs,
    }, edits, buffers);
  }

  async run(params: StoneGpuScatterParams): Promise<StoneGpuScatterCounts> {
    const settings = params.settings;
    const maxInstances = Math.max(0, Math.floor(settings.maxInstances));
    const grid = Math.max(1, Math.ceil(params.worldCells / Math.max(0.1, settings.cellSizeM)));

    this.paramF32.fill(0);
    this.paramU32.fill(0);
    this.paramF32[0] = params.worldCells;
    this.paramF32[1] = Math.max(0.1, settings.cellSizeM);
    this.paramF32[2] = Math.max(0, settings.density);
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
    this.paramU32[39] = Math.max(0, Math.floor(params.indexCounts[0] ?? 0));
    this.paramU32[40] = Math.max(0, Math.floor(params.indexCounts[1] ?? 0));
    this.paramU32[41] = Math.max(0, Math.floor(params.indexCounts[2] ?? 0));
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);

    const encoder = this.device.createCommandEncoder({ label: "stone scatter compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, 1);
    this.dispatchPipeline(encoder, this.pipelines.scatter_stones, Math.ceil((grid * grid) / WORKGROUP_SIZE));
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, 1);
    encoder.copyBufferToBuffer(this.counterBuffer, 0, this.counterReadback, 0, COUNTER_BYTES);
    this.device.queue.submit([encoder.finish()]);

    await this.counterReadback.mapAsync(GPUMapMode.READ);
    const raw = new Uint32Array(this.counterReadback.getMappedRange(0, COUNTER_BYTES));
    const counts = {
      large: Math.min(raw[1] ?? 0, maxInstances),
      medium: Math.min(raw[2] ?? 0, maxInstances),
      small: Math.min(raw[3] ?? 0, maxInstances),
    };
    this.counterReadback.unmap();
    return counts;
  }

  destroy(): void {
    this.paramBuffer.destroy();
    this.counterBuffer.destroy();
    this.counterReadback.destroy();
    this.digEdits.destroy();
    this.fieldParams.destroy();
  }

  private writeClassConfig(offset: number, cls: StoneSettings["classes"]["large"]): void {
    this.paramF32[offset] = cls.radiusMin;
    this.paramF32[offset + 1] = cls.radiusMax;
    this.paramF32[offset + 2] = cls.sink;
    this.paramF32[offset + 3] = cls.maxDistance;
  }

  private dispatchPipeline(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, workgroups: number): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.max(1, workgroups));
    pass.end();
  }
}

export const STONE_GPU_CLASS_COUNT = CLASS_COUNT;
export const STONE_GPU_INDIRECT_BYTES = INDIRECT_BYTES;
