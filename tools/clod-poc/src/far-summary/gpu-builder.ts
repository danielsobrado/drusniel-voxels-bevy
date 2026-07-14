import { requestWebGpuDevice } from "../gpu/webgpu_device.js";
import type { TerrainFieldConfig } from "../terrain/terrain.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { FarSummaryGpuBatch, FarSummaryGpuPlan } from "./gpu-planner.js";
import { FAR_SUMMARY_GPU_RECORD_BYTES, type FarSummaryGpuConfig, type FarSummaryGpuFallbackReason } from "./gpu-config.js";
import { farSummaryGpuFallbackDecision } from "./gpu-config.js";
import { createFarSummaryGpuBatchBuffers } from "./gpu-buffers.js";
import { createFarSummaryGpuCounters, publishFarSummaryGpuCounters, type FarSummaryGpuCounters } from "./gpu-counters.js";
import { decodeFarSummaryGpuRecords, type FarSummaryGpuRecord } from "./gpu-records.js";
import { composeFarSummaryGpuBuildShader } from "./gpu-shader.js";
import {
  applyFarSummaryGpuParityEvaluationToCounters,
  evaluateFarSummaryGpuDebugReadbackParity,
  type FarSummaryGpuParityEvaluation,
} from "./gpu-parity.js";

const WORKGROUP_SIZE = 64;

type NonReadyFallbackReason = Exclude<FarSummaryGpuFallbackReason, "ready">;
type DispatchFallbackReason = NonReadyFallbackReason | "builder_unavailable" | "dispatch_failed" | null;

export interface FarSummaryGpuDebugReadback {
  batchIndex: number;
  records: FarSummaryGpuRecord[];
}

export interface FarSummaryGpuCellReadback {
  batchIndex: number;
  records: FarSummaryGpuRecord[];
}

interface FarSummaryGpuBatchReadback {
  debugRecords: FarSummaryGpuRecord[];
  cellRecords: FarSummaryGpuRecord[];
}

export interface FarSummaryGpuBuilder {
  dispatch(plan: FarSummaryGpuPlan): Promise<FarSummaryGpuDispatchResult>;
  dispose(): void;
}

export interface FarSummaryGpuDispatchResult {
  ok: boolean;
  counters: FarSummaryGpuCounters;
  debugReadbacks?: FarSummaryGpuDebugReadback[];
  cellReadbacks?: FarSummaryGpuCellReadback[];
  parity?: FarSummaryGpuParityEvaluation;
  error?: Error;
}

export interface CreateFarSummaryGpuBuilderOptions {
  config: FarSummaryGpuConfig;
  sharedDevice?: GPUDevice;
  terrainFieldConfig?: TerrainFieldConfig;
  terrainSampler?: FarTerrainSampler;
}

export interface FarSummaryGpuDispatchOrFallbackInput {
  plan: FarSummaryGpuPlan;
  config: FarSummaryGpuConfig;
  webGpuAvailable: boolean;
  builderFactory: () => Promise<FarSummaryGpuBuilder | null>;
  terrainSampler?: FarTerrainSampler;
  frameIndex?: number;
  nowMs?: number;
}

export interface FarSummaryGpuDispatchOrFallbackResult extends FarSummaryGpuDispatchResult {
  fallbackTiles: number;
  fallbackReason: DispatchFallbackReason;
}

export async function createFarSummaryGpuBuilder(
  options: CreateFarSummaryGpuBuilderOptions,
): Promise<FarSummaryGpuBuilder | null> {
  let device = options.sharedDevice ?? null;
  try {
    if (!device) {
      const result = await requestWebGpuDevice();
      if (!result.ok) {
        publishFarSummaryGpuCounters(undefined, disabledFarSummaryGpuCounters(options.config));
        return null;
      }
      device = result.device;
    }
    const module = device.createShaderModule({ label: "far summary gpu build shader", code: composeFarSummaryGpuBuildShader() });
    const layout = device.createBindGroupLayout({
      label: "far summary gpu build layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    const pipeline = await device.createComputePipelineAsync({
      label: "far summary gpu build pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: "build_far_summary" },
    });
    return new WebGpuFarSummaryBuilder(device, layout, pipeline, options.config, options.terrainFieldConfig, options.terrainSampler);
  } catch (error) {
    console.warn("[far-summary-gpu] builder unavailable; CPU far-summary remains authoritative", error);
    publishFarSummaryGpuCounters(undefined, disabledFarSummaryGpuCounters(options.config));
    return null;
  }
}

export async function dispatchFarSummaryGpuPlanOrFallback(
  input: FarSummaryGpuDispatchOrFallbackInput,
): Promise<FarSummaryGpuDispatchOrFallbackResult> {
  const decision = farSummaryGpuFallbackDecision(input.config, input.webGpuAvailable, input.plan.dirtyTiles.length);
  if (!decision.useGpu) {
    const counters = disabledFarSummaryGpuCounters(input.config);
    counters.dirtyTiles = input.plan.dirtyTiles.length;
    counters.fallbackTiles = input.plan.dirtyTiles.length;
    counters.bufferBytes = input.plan.estimatedBufferBytes;
    return {
      ok: true,
      counters,
      fallbackTiles: input.plan.dirtyTiles.length,
      fallbackReason: nonReadyFallbackReason(decision.reason),
    };
  }

  const builder = await input.builderFactory();
  if (!builder) {
    const counters = disabledFarSummaryGpuCounters(input.config);
    counters.dirtyTiles = input.plan.dirtyTiles.length;
    counters.fallbackTiles = input.plan.dirtyTiles.length;
    counters.bufferBytes = input.plan.estimatedBufferBytes;
    return { ok: true, counters, fallbackTiles: input.plan.dirtyTiles.length, fallbackReason: "builder_unavailable" };
  }

  const result = await builder.dispatch(input.plan);
  const resultWithParity = applyStrictParityIfRequested(result, input);
  if (!resultWithParity.ok) {
    resultWithParity.counters.authoritative = input.config.authoritative ? 1 : 0;
    resultWithParity.counters.fallbackTiles = input.plan.dirtyTiles.length;
    publishFarSummaryGpuCounters(undefined, resultWithParity.counters);
    return {
      ...resultWithParity,
      fallbackTiles: input.plan.dirtyTiles.length,
      fallbackReason: "dispatch_failed",
    };
  }

  resultWithParity.counters.authoritative = input.config.authoritative ? 1 : 0;
  publishFarSummaryGpuCounters(undefined, resultWithParity.counters);
  return { ...resultWithParity, fallbackTiles: 0, fallbackReason: null };
}

export function disabledFarSummaryGpuCounters(config: FarSummaryGpuConfig): FarSummaryGpuCounters {
  const counters = createFarSummaryGpuCounters();
  counters.enabled = config.enabled ? 1 : 0;
  counters.authoritative = config.authoritative ? 1 : 0;
  return counters;
}

function applyStrictParityIfRequested(
  result: FarSummaryGpuDispatchResult,
  input: FarSummaryGpuDispatchOrFallbackInput,
): FarSummaryGpuDispatchResult {
  if (!result.ok || !input.terrainSampler) return result;
  const parity = evaluateFarSummaryGpuDebugReadbackParity({
    config: input.config,
    plan: input.plan,
    debugReadbacks: result.debugReadbacks ?? [],
    terrainSampler: input.terrainSampler,
    frameIndex: input.frameIndex ?? 0,
    nowMs: input.nowMs ?? performance.now(),
  });
  applyFarSummaryGpuParityEvaluationToCounters(result.counters, parity);
  if (parity.enabled && parity.failedTiles > 0) {
    return { ...result, ok: false, parity, error: new Error(`far-summary GPU strict parity failed for ${parity.failedTiles} tile(s)`) };
  }
  return { ...result, parity };
}

function nonReadyFallbackReason(reason: FarSummaryGpuFallbackReason): NonReadyFallbackReason {
  switch (reason) {
    case "disabled":
    case "webgpu_unavailable":
    case "no_dirty_tiles":
      return reason;
    case "ready":
      throw new Error("ready GPU far-summary decision cannot be returned as a fallback reason");
  }
}

class WebGpuFarSummaryBuilder implements FarSummaryGpuBuilder {
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly layout: GPUBindGroupLayout,
    private readonly pipeline: GPUComputePipeline,
    private readonly config: FarSummaryGpuConfig,
    private readonly terrainFieldConfig?: TerrainFieldConfig,
    private readonly terrainSampler?: FarTerrainSampler,
  ) {}

  async dispatch(plan: FarSummaryGpuPlan): Promise<FarSummaryGpuDispatchResult> {
    const counters = createFarSummaryGpuCounters();
    counters.enabled = this.config.enabled ? 1 : 0;
    counters.authoritative = this.config.authoritative ? 1 : 0;
    counters.deviceReady = 1;
    counters.dirtyTiles = plan.dirtyTiles.length;
    counters.bufferBytes = plan.estimatedBufferBytes;
    counters.summaryRecordsLive = this.config.commitToCache
      ? plan.batches.reduce((sum, batch) => sum + batch.cellRecordCount, 0)
      : plan.dirtyTiles.length;

    if (this.disposed) {
      counters.failedBatches = plan.batches.length;
      return { ok: false, counters, error: new Error("far-summary GPU builder has been disposed") };
    }

    const timings: number[] = [];
    const readbackTimings: number[] = [];
    const debugReadbacks: FarSummaryGpuDebugReadback[] = [];
    const cellReadbacks: FarSummaryGpuCellReadback[] = [];
    try {
      for (let batchIndex = 0; batchIndex < plan.batches.length; batchIndex++) {
        const batch = plan.batches[batchIndex]!;
        const startedAt = performance.now();
        const readback = await this.dispatchBatch(batch, readbackTimings);
        if (readback.debugRecords.length > 0) debugReadbacks.push({ batchIndex, records: readback.debugRecords });
        if (readback.cellRecords.length > 0) cellReadbacks.push({ batchIndex, records: readback.cellRecords });
        timings.push(performance.now() - startedAt);
        counters.batchesDispatched++;
        counters.tilesDispatched += batch.tiles.length;
      }
      counters.computeMsP50 = percentile(timings, 0.5);
      counters.computeMsP95 = percentile(timings, 0.95);
      counters.readbackMsP95 = percentile(readbackTimings, 0.95);
      return {
        ok: true,
        counters,
        ...(debugReadbacks.length > 0 ? { debugReadbacks } : {}),
        ...(cellReadbacks.length > 0 ? { cellReadbacks } : {}),
      };
    } catch (error) {
      counters.failedBatches++;
      return { ok: false, counters, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  private async dispatchBatch(batch: FarSummaryGpuBatch, readbackTimings: number[]): Promise<FarSummaryGpuBatchReadback> {
    const buffers = createFarSummaryGpuBatchBuffers(
      this.device,
      batch,
      this.config,
      this.terrainFieldConfig,
      this.terrainSampler,
    );
    try {
      const bindGroup = this.device.createBindGroup({
        label: "far summary gpu build bind group",
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: buffers.descriptorBuffer } },
          { binding: 1, resource: { buffer: buffers.outputBuffer } },
          { binding: 2, resource: { buffer: buffers.digEditsBuffer } },
          { binding: 3, resource: { buffer: buffers.fieldParamsBuffer } },
          { binding: 4, resource: { buffer: buffers.cellOutputBuffer } },
          { binding: 5, resource: { buffer: buffers.canonicalSampleBuffer } },
        ],
      });
      const encoder = this.device.createCommandEncoder({ label: "far summary gpu build encoder" });
      const pass = encoder.beginComputePass({ label: "far summary gpu build pass" });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.max(1, Math.ceil(batch.tiles.length / WORKGROUP_SIZE)));
      pass.end();
      if (buffers.readbackBuffer && buffers.readbackBytes > 0) {
        encoder.copyBufferToBuffer(buffers.outputBuffer, 0, buffers.readbackBuffer, 0, buffers.readbackBytes);
      }
      if (buffers.cellReadbackBuffer && buffers.cellReadbackBytes > 0) {
        encoder.copyBufferToBuffer(buffers.cellOutputBuffer, 0, buffers.cellReadbackBuffer, 0, buffers.cellReadbackBytes);
      }
      this.device.queue.submit([encoder.finish()]);

      const debugRecords = buffers.readbackBuffer && buffers.readbackBytes > 0
        ? await this.mapRecords(buffers.readbackBuffer, buffers.readbackBytes, readbackTimings)
        : [];
      const cellRecords = buffers.cellReadbackBuffer && buffers.cellReadbackBytes > 0
        ? await this.mapRecords(buffers.cellReadbackBuffer, buffers.cellReadbackBytes, readbackTimings)
        : [];
      return { debugRecords, cellRecords };
    } finally {
      buffers.destroy();
    }
  }

  private async mapRecords(buffer: GPUBuffer, bytes: number, readbackTimings: number[]): Promise<FarSummaryGpuRecord[]> {
    const readbackStartedAt = performance.now();
    await buffer.mapAsync(GPUMapMode.READ, 0, bytes);
    const mapped = buffer.getMappedRange(0, bytes);
    const copy = mapped.slice(0);
    buffer.unmap();
    readbackTimings.push(performance.now() - readbackStartedAt);
    return decodeFarSummaryGpuRecords(copy, Math.floor(bytes / FAR_SUMMARY_GPU_RECORD_BYTES));
  }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? 0;
}
