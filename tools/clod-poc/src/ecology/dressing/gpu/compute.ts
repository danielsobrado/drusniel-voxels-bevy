import { activeForestLightingGpuTexture, type ForestLightingGpuTextureSource } from "../../../forest_lighting/forest_lighting_texture.js";
import { DIG_EDIT_BYTES, FIELD_PARAM_WORDS, packDigEdits, packFieldParams } from "../../../gpu/gpu_mesh_buffers.js";
import { hydrologyAtlasGpuParams, hydrologyAtlasGpuTexture } from "../../../gpu/hydrology_atlas_gpu.js";
import { composeDressingGpuShader } from "../../../gpu/wgsl_modules.js";
import { createTreeHydrologyTexture } from "../../../gpu/tree_ring_compute_resources.js";
import { getDigEditsSnapshot, getDigEditRevision } from "../../../terrain/terrain.js";
import { resolveDigEdits, type ResolvedDigEdit } from "../../../gpu/terrain_field_core.js";
import { heightfieldTileGpuAtlasBindings } from "../../../world/heightfield_tiles/heightfield_tile_gpu_atlas.js";
import type { DressingConfig, DressingQuality } from "../config.js";
import type { DressingPersistenceBridge } from "../persistence_bridge.js";
import {
  DRESSING_GPU_ACTIVE_RADIUS_M,
  DRESSING_GPU_CLASS_PARAM_WORDS,
  DRESSING_GPU_GROUP_COUNT,
  DRESSING_GPU_INDIRECT_WORDS,
  DRESSING_GPU_LOD_COUNT,
  DRESSING_GPU_WORKGROUP_SIZE,
  buildDressingGpuLayout,
  type DressingGpuLayout,
} from "./layouts.js";
import {
  buildDressingPersistentExclusionTable,
  type DressingPersistentExclusionTable,
} from "./persistent_exclusion_table.js";
import type { DressingGpuOutputBuffers } from "./render_resources.js";

const PARAM_WORDS = 24;
const PARAM_BYTES = PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT;
const COUNTER_BYTES = DRESSING_GPU_GROUP_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const CLASS_PARAM_BYTES = (DRESSING_GPU_GROUP_COUNT / DRESSING_GPU_LOD_COUNT)
  * DRESSING_GPU_CLASS_PARAM_WORDS
  * Uint32Array.BYTES_PER_ELEMENT;
const EXCLUSION_ENTRY_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;

type PipelineName = "clear_counters" | "generate_persistent" | "generate_terrain" | "build_indirect_args";

export interface DressingGpuHydrologyData {
  readonly res: number;
  readonly worldCells: number;
  readonly data: Float32Array;
}

export interface DressingGpuDispatchParams {
  readonly centerX: number;
  readonly centerZ: number;
  readonly worldCells: number;
  readonly unboundedWorld: boolean;
}

export interface DressingGpuComputeStats {
  readonly candidateCount: number;
  readonly submitMs: number;
  readonly dispatches: number;
  readonly canopyAuthorityActive: boolean;
  readonly canonicalHeightAuthorityActive: boolean;
  readonly persistentExclusionCount: number;
  readonly persistentExclusionRevision: number;
  readonly persistentExclusionOverflow: boolean;
}

interface ExclusionGpuState {
  readonly table: DressingPersistentExclusionTable;
  readonly sourceCount: number;
  readonly overflow: boolean;
}

export class DressingGpuCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly classParamsBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly fieldParams: GPUBuffer;
  private digEdits: GPUBuffer;
  private persistentExclusions: GPUBuffer;
  private persistentExclusionCapacityMask: number;
  private persistentExclusionTableCount: number;
  private persistentExclusionCount: number;
  private persistentExclusionOverflow: boolean;
  private lastPersistentExclusionRevision: number;
  private readonly hydroTexture: GPUTexture;
  private readonly hydroSampler: GPUSampler;
  private canopyAuxTexture: GPUTexture;
  private canopyDetailTexture: GPUTexture;
  private canopySource: ForestLightingGpuTextureSource | null;
  private ownsCanopyTextures: boolean;
  private bindGroup: GPUBindGroup;
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private readonly paramsScratch = new ArrayBuffer(PARAM_BYTES);
  private lastDigEditRevision = -1;
  private submitMs = 0;
  private dispatches = 0;

  private constructor(
    private readonly device: GPUDevice,
    private readonly layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    private readonly gpuLayout: DressingGpuLayout,
    private readonly capacityPerGroup: number,
    private readonly worldSeed: number,
    private readonly outputBuffers: DressingGpuOutputBuffers,
    private readonly persistenceBridge: DressingPersistenceBridge,
    edits: readonly ResolvedDigEdit[],
    hydrologyData: DressingGpuHydrologyData | null,
  ) {
    this.pipelines = pipelines;
    this.paramBuffer = device.createBuffer({ label: "dressing GPU params", size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.classParamsBuffer = device.createBuffer({ label: "dressing GPU class params", size: CLASS_PARAM_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.counterBuffer = device.createBuffer({ label: "dressing GPU counters", size: COUNTER_BYTES, usage: GPUBufferUsage.STORAGE });
    this.fieldParams = device.createBuffer({ label: "dressing GPU field params", size: FIELD_PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.digEdits = this.createDigEditsBuffer(edits);
    this.writeFieldParams(edits.length);
    this.lastDigEditRevision = getDigEditRevision();
    const exclusions = this.resolvePersistentExclusions();
    this.persistentExclusions = this.createPersistentExclusionsBuffer(exclusions.table);
    this.persistentExclusionCapacityMask = exclusions.table.capacityMask;
    this.persistentExclusionTableCount = exclusions.table.count;
    this.persistentExclusionCount = exclusions.sourceCount;
    this.persistentExclusionOverflow = exclusions.overflow;
    this.lastPersistentExclusionRevision = persistenceBridge.revision;
    device.queue.writeBuffer(this.classParamsBuffer, 0, gpuLayout.packed);
    this.hydroTexture = createTreeHydrologyTexture(device, hydrologyData);
    this.hydroSampler = device.createSampler({ label: "dressing GPU hydro sampler", magFilter: "nearest", minFilter: "nearest" });
    this.canopySource = activeForestLightingGpuTexture();
    this.ownsCanopyTextures = !this.canopySource;
    const fallback = this.canopySource ? null : createCanopyFallbackTextures(device);
    this.canopyAuxTexture = this.canopySource?.auxTexture ?? fallback!.aux;
    this.canopyDetailTexture = this.canopySource?.detailTexture ?? fallback!.detail;
    this.bindGroup = this.createBindGroup();
  }

  static async create(
    device: GPUDevice,
    outputBuffers: DressingGpuOutputBuffers,
    config: DressingConfig,
    quality: DressingQuality,
    indexCounts: ArrayLike<number>,
    capacityPerGroup: number,
    worldSeed: number,
    hydrologyData: DressingGpuHydrologyData | null,
    persistenceBridge: DressingPersistenceBridge,
  ): Promise<DressingGpuCompute> {
    const gpuLayout = buildDressingGpuLayout(config, quality, indexCounts);
    const module = device.createShaderModule({ label: "dressing GPU authority shader", code: composeDressingGpuShader(DRESSING_GPU_WORKGROUP_SIZE) });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    const layout = device.createBindGroupLayout({ label: "dressing GPU authority layout", entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      storage(1, "read-only-storage"), storage(2), storage(3), storage(4),
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, sampler: { type: "non-filtering" } },
      storage(7, "read-only-storage"),
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
      { binding: 11, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "sint" } },
      { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 13, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
      { binding: 14, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
      storage(15, "read-only-storage"),
    ] });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) => device.createComputePipelineAsync({
      label: `dressing GPU ${entryPoint}`,
      layout: pipelineLayout,
      compute: { module, entryPoint },
    });
    const [clearCounters, persistent, terrain, indirect] = await Promise.all([
      makePipeline("clear_counters"),
      makePipeline("generate_persistent"),
      makePipeline("generate_terrain"),
      makePipeline("build_indirect_args"),
    ]);
    return new DressingGpuCompute(
      device,
      layout,
      { clear_counters: clearCounters, generate_persistent: persistent, generate_terrain: terrain, build_indirect_args: indirect },
      gpuLayout,
      Math.max(1, Math.floor(capacityPerGroup)),
      worldSeed,
      outputBuffers,
      persistenceBridge,
      resolveDigEdits(getDigEditsSnapshot()),
      hydrologyData,
    );
  }

  dispatch(input: DressingGpuDispatchParams): void {
    this.syncDigEdits();
    this.syncCanopyTextures();
    this.syncPersistentExclusions();
    const f32 = new Float32Array(this.paramsScratch);
    const u32 = new Uint32Array(this.paramsScratch);
    f32.fill(0);
    u32.fill(0);
    f32[0] = input.centerX;
    f32[1] = input.centerZ;
    f32[2] = DRESSING_GPU_ACTIVE_RADIUS_M;
    f32[3] = input.worldCells;
    u32[4] = this.worldSeed >>> 0;
    u32[5] = this.gpuLayout.totalCandidateSlots >>> 0;
    u32[6] = this.capacityPerGroup >>> 0;
    u32[7] = 1;
    const hydro = hydrologyAtlasGpuParams();
    for (let index = 0; index < 4; index++) f32[8 + index] = hydro[index] ?? 0;
    f32[12] = this.canopySource?.worldCells ?? input.worldCells;
    f32[13] = this.canopySource?.canopyHeightScaleM ?? 1;
    f32[14] = this.canopySource ? 1 : 0;
    f32[15] = input.unboundedWorld ? 1 : 0;
    u32[16] = this.gpuLayout.persistentCandidateStart >>> 0;
    u32[17] = (
      this.persistentExclusionOverflow
        ? this.gpuLayout.persistentCandidateStart
        : this.gpuLayout.persistentCandidateEnd
    ) >>> 0;
    u32[18] = this.gpuLayout.terrainCandidateStart >>> 0;
    u32[19] = this.gpuLayout.terrainCandidateEnd >>> 0;
    u32[20] = this.persistentExclusionCapacityMask >>> 0;
    u32[21] = this.persistentExclusionTableCount >>> 0;
    u32[22] = this.persistentExclusionOverflow ? 1 : 0;
    u32[23] = this.lastPersistentExclusionRevision >>> 0;
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramsScratch);

    const encoder = this.device.createCommandEncoder({ label: "dressing GPU authority encoder" });
    dispatchPipeline(encoder, this.pipelines.clear_counters, this.bindGroup, Math.ceil(DRESSING_GPU_GROUP_COUNT * DRESSING_GPU_INDIRECT_WORDS / DRESSING_GPU_WORKGROUP_SIZE));
    dispatchPipeline(
      encoder,
      this.pipelines.generate_persistent,
      this.bindGroup,
      Math.ceil(Math.max(1, this.gpuLayout.persistentCandidateEnd - this.gpuLayout.persistentCandidateStart) / DRESSING_GPU_WORKGROUP_SIZE),
    );
    dispatchPipeline(
      encoder,
      this.pipelines.generate_terrain,
      this.bindGroup,
      Math.ceil(Math.max(1, this.gpuLayout.terrainCandidateEnd - this.gpuLayout.terrainCandidateStart) / DRESSING_GPU_WORKGROUP_SIZE),
    );
    dispatchPipeline(encoder, this.pipelines.build_indirect_args, this.bindGroup, Math.ceil(DRESSING_GPU_GROUP_COUNT / DRESSING_GPU_WORKGROUP_SIZE));
    const started = performance.now();
    this.device.queue.submit([encoder.finish()]);
    this.submitMs = performance.now() - started;
    this.dispatches++;
  }

  stats(): DressingGpuComputeStats {
    return {
      candidateCount: this.gpuLayout.totalCandidateSlots,
      submitMs: this.submitMs,
      dispatches: this.dispatches,
      canopyAuthorityActive: this.canopySource !== null,
      canonicalHeightAuthorityActive: true,
      persistentExclusionCount: this.persistentExclusionCount,
      persistentExclusionRevision: this.lastPersistentExclusionRevision,
      persistentExclusionOverflow: this.persistentExclusionOverflow,
    };
  }

  destroy(): void {
    this.paramBuffer.destroy();
    this.classParamsBuffer.destroy();
    this.counterBuffer.destroy();
    this.fieldParams.destroy();
    this.digEdits.destroy();
    this.persistentExclusions.destroy();
    this.hydroTexture.destroy();
    if (this.ownsCanopyTextures) {
      this.canopyAuxTexture.destroy();
      this.canopyDetailTexture.destroy();
    }
  }

  private syncDigEdits(): void {
    const revision = getDigEditRevision();
    if (revision === this.lastDigEditRevision) return;
    const edits = resolveDigEdits(getDigEditsSnapshot());
    const previous = this.digEdits;
    this.digEdits = this.createDigEditsBuffer(edits);
    this.writeFieldParams(edits.length);
    this.bindGroup = this.createBindGroup();
    previous.destroy();
    this.lastDigEditRevision = revision;
  }

  private syncCanopyTextures(): void {
    const source = activeForestLightingGpuTexture();
    if (source?.auxTexture === this.canopyAuxTexture && source.detailTexture === this.canopyDetailTexture) {
      this.canopySource = source;
      return;
    }
    if (!source && this.ownsCanopyTextures) {
      this.canopySource = null;
      return;
    }
    if (this.ownsCanopyTextures) {
      this.canopyAuxTexture.destroy();
      this.canopyDetailTexture.destroy();
    }
    const fallback = source ? null : createCanopyFallbackTextures(this.device);
    this.canopySource = source;
    this.ownsCanopyTextures = !source;
    this.canopyAuxTexture = source?.auxTexture ?? fallback!.aux;
    this.canopyDetailTexture = source?.detailTexture ?? fallback!.detail;
    this.bindGroup = this.createBindGroup();
  }

  private syncPersistentExclusions(): void {
    if (this.persistenceBridge.revision === this.lastPersistentExclusionRevision) return;
    const next = this.resolvePersistentExclusions();
    const previous = this.persistentExclusions;
    this.persistentExclusions = this.createPersistentExclusionsBuffer(next.table);
    this.persistentExclusionCapacityMask = next.table.capacityMask;
    this.persistentExclusionTableCount = next.table.count;
    this.persistentExclusionCount = next.sourceCount;
    this.persistentExclusionOverflow = next.overflow;
    this.lastPersistentExclusionRevision = this.persistenceBridge.revision;
    this.bindGroup = this.createBindGroup();
    previous.destroy();
  }

  private resolvePersistentExclusions(): ExclusionGpuState {
    const identities = this.persistenceBridge.exclusionSnapshot();
    const requiredCapacity = nextPowerOfTwo(Math.max(2, identities.length * 2));
    const maximumBytes = Number(this.device.limits.maxStorageBufferBindingSize);
    if (requiredCapacity * EXCLUSION_ENTRY_BYTES > maximumBytes) {
      return {
        table: buildDressingPersistentExclusionTable([]),
        sourceCount: identities.length,
        overflow: true,
      };
    }
    return {
      table: buildDressingPersistentExclusionTable(identities),
      sourceCount: identities.length,
      overflow: false,
    };
  }

  private createBindGroup(): GPUBindGroup {
    const canonical = heightfieldTileGpuAtlasBindings(this.device);
    return this.device.createBindGroup({ label: "dressing GPU authority bind group", layout: this.layout, entries: [
      { binding: 0, resource: { buffer: this.paramBuffer } },
      { binding: 1, resource: { buffer: this.classParamsBuffer } },
      { binding: 2, resource: { buffer: this.counterBuffer } },
      { binding: 3, resource: { buffer: this.outputBuffers.indirectArgs } },
      { binding: 4, resource: { buffer: this.outputBuffers.records } },
      { binding: 5, resource: this.hydroTexture.createView() },
      { binding: 6, resource: this.hydroSampler },
      { binding: 7, resource: { buffer: this.digEdits } },
      { binding: 8, resource: { buffer: this.fieldParams } },
      { binding: 9, resource: hydrologyAtlasGpuTexture(this.device).createView() },
      { binding: 10, resource: canonical.heightView },
      { binding: 11, resource: canonical.residencyView },
      { binding: 12, resource: { buffer: canonical.params } },
      { binding: 13, resource: this.canopyAuxTexture.createView() },
      { binding: 14, resource: this.canopyDetailTexture.createView() },
      { binding: 15, resource: { buffer: this.persistentExclusions } },
    ] });
  }

  private createDigEditsBuffer(edits: readonly ResolvedDigEdit[]): GPUBuffer {
    const buffer = this.device.createBuffer({ label: "dressing GPU dig edits", size: Math.max(1, edits.length) * DIG_EDIT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, packDigEdits(edits));
    return buffer;
  }

  private createPersistentExclusionsBuffer(table: DressingPersistentExclusionTable): GPUBuffer {
    const size = Math.max(EXCLUSION_ENTRY_BYTES, table.words.byteLength);
    const buffer = this.device.createBuffer({
      label: "dressing GPU persistent exclusions",
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, table.words);
    return buffer;
  }

  private writeFieldParams(editCount: number): void {
    const packed = packFieldParams(editCount);
    this.device.queue.writeBuffer(this.fieldParams, 0, packed.buffer as ArrayBuffer, packed.byteOffset, packed.byteLength);
  }
}

function dispatchPipeline(
  encoder: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  workgroups: number,
): void {
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.max(1, workgroups));
  pass.end();
}

function createCanopyFallbackTextures(device: GPUDevice): { aux: GPUTexture; detail: GPUTexture } {
  const create = (label: string) => device.createTexture({
    label,
    size: { width: 1, height: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  return { aux: create("dressing GPU canopy fallback aux"), detail: create("dressing GPU canopy fallback detail") };
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, value)));
}

export function dressingGpuComputeUnsupportedReason(device: GPUDevice): string | null {
  const requiredStorageBuffers = 6;
  return device.limits.maxStorageBuffersPerShaderStage >= requiredStorageBuffers
    ? null
    : `dressing GPU authority requires ${requiredStorageBuffers} storage buffers per shader stage`;
}
