import { requestWebGpuDevice } from "../gpu/webgpu_device.js";
import type { WebGpuUnavailable } from "../gpu/webgpu_device.js";
import shaderCode from "./shaders/far_summary_build.wgsl?raw";
import type { FarSummaryGpuBatch, FarSummaryGpuPlan } from "./gpu-planner.js";
import type { FarSummaryGpuConfig } from "./gpu-config.js";
import { farSummaryGpuFallbackDecision } from "./gpu-config.js";
import { createFarSummaryGpuBatchBuffers } from "./gpu-buffers.js";
import { createFarSummaryGpuCounters, publishFarSummaryGpuCounters, type FarSummaryGpuCounters } from "./gpu-counters.js";

const WORKGROUP_SIZE = 64;

export interface FarSummaryGpuBuilder {
  dispatch(plan: FarSummaryGpuPlan): Promise<FarSummaryGpuDispatchResult>;
  dispose(): void;
}

export interface FarSummaryGpuDispatchResult {
  ok: boolean;
  counters: FarSummaryGpuCounters;
  error?: Error;
}

export interface CreateFarSummaryGpuBuilderOptions {
  config: FarSummaryGpuConfig;
  sharedDevice?: GPUDevice;
}

export interface FarSummaryGpuDispatchOrFallbackInput {
  plan: FarSummaryGpuPlan;
  config: FarSummaryGpuConfig;
  webGpuAvailable: boolean;
  builderFactory: () => Promise<FarSummaryGpuBuilder | null>;
}

export interface FarSummaryGpuDispatchOrFallbackResult extends FarSummaryGpuDispatchResult {
  fallbackTiles: number;
  fallbackReason: "disabled" | "webgpu_unavailable" | "no_dirty_tiles" | "builder_unavailable" | "dispatch_failed" | null;
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
    const module = device.createShaderModule({ label: "far summary gpu build shader", code: shaderCode });
    const layout = device.createBindGroupLayout({
      label: "far summary gpu build layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const pipeline = await device.createComputePipelineAsync({
      label: "far summary gpu build pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: "build_far_summary" },
    });
    return new WebGpuFarSummaryBuilder(device, layout, pipeline, options.config);
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
    return { ok: true, counters, fallbackTiles: input.plan.dirtyTiles.length, fallbackReason: decision.reason };
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
  if (!result.ok) {
    result.counters.fallbackTiles = input.plan.dirtyTiles.length;
    return {
      ...result,
      fallbackTiles: input.plan.dirtyTiles.length,
      fallbackReason: "dispatch_failed",
    };
  }

  return { ...result, fallbackTiles: 0, fallbackReason: null };
}

export function disabledFarSummaryGpuCounters(config: FarSummaryGpuConfig): FarSummaryGpuCounters {
  const counters = createFarSummaryGpuCounters();
  counters.enabled = config.enabled ? 1 : 0;
  return counters;
}

function unavailableFromError(error: unknown): WebGpuUnavailable {
  return {
    ok: false,
    reason: "device-request-failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

class WebGpuFarSummaryBuilder implements FarSummaryGpuBuilder {
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly layout: GPUBindGroupLayout,
    private readonly pipeline: GPUComputePipeline,
    private readonly config: FarSummaryGpuConfig,
  ) {}

  async dispatch(plan: FarSummaryGpuPlan): Promise<FarSummaryGpuDispatchResult> {
    const counters = createFarSummaryGpuCounters();
    counters.enabled = this.config.enabled ? 1 : 0;
    counters.deviceReady = 1;
    counters.dirtyTiles = plan.dirtyTiles.length;
    counters.bufferBytes = plan.estimatedBufferBytes;
    counters.summaryRecordsLive = plan.dirtyTiles.length;

    if (this.disposed) {
      counters.failedBatches = plan.batches.length;
      return { ok: false, counters, error: new Error("far-summary GPU builder has been disposed") };
    }

    const timings: number[] = [];
    const readbackTimings: number[] = [];
    try {
      for (const batch of plan.batches) {
        const startedAt = performance.now();
        await this.dispatchBatch(batch, readbackTimings);
        timings.push(performance.now() - startedAt);
        counters.batchesDispatched++;
        counters.tilesDispatched += batch.tiles.length;
      }
      counters.computeMsP50 = percentile(timings, 0.5);
      counters.computeMsP95 = percentile(timings, 0.95);
      counters.readbackMsP95 = percentile(readbackTimings, 0.95);
      publishFarSummaryGpuCounters(undefined, counters);
      return { ok: true, counters };
    } catch (error) {
      counters.failedBatches++;
      publishFarSummaryGpuCounters(undefined, counters);
      return { ok: false, counters, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  private async dispatchBatch(batch: FarSummaryGpuBatch, readbackTimings: number[]): Promise<void> {
    const buffers = createFarSummaryGpuBatchBuffers(this.device, batch, this.config);
    try {
      const bindGroup = this.device.createBindGroup({
        label: "far summary gpu build bind group",
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: buffers.descriptorBuffer } },
          { binding: 1, resource: { buffer: buffers.outputBuffer } },
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
      this.device.queue.submit([encoder.finish()]);
      if (buffers.readbackBuffer && buffers.readbackBytes > 0) {
        const readbackStartedAt = performance.now();
        await buffers.readbackBuffer.mapAsync(GPUMapMode.READ, 0, buffers.readbackBytes);
        buffers.readbackBuffer.unmap();
        readbackTimings.push(performance.now() - readbackStartedAt);
      }
    } finally {
      buffers.destroy();
    }
  }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? 0;
}

void unavailableFromError;
