import type { TerrainFieldConfig } from "../terrain/terrain.js";
import type { FarSummaryTile } from "./types.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryRingRequest } from "./clipmap-rings.js";
import type { StreamCenter } from "./stream-center.js";
import {
  buildFarSummaryGpuPlan,
  buildFarSummaryGpuPlanFromRequests,
  type FarSummaryGpuPlan,
  type FarSummaryGpuDirtyReason,
} from "./gpu-planner.js";
import {
  DEFAULT_FAR_SUMMARY_GPU_CONFIG,
  farSummaryGpuConfigFromParams,
  type FarSummaryGpuConfig,
} from "./gpu-config.js";
import {
  createFarSummaryGpuBuilder,
  dispatchFarSummaryGpuPlanOrFallback,
  type FarSummaryGpuBuilder,
  type FarSummaryGpuDispatchOrFallbackResult,
} from "./gpu-builder.js";
import { farSummaryGpuCellRecordsToTile } from "./gpu-cache.js";
import { createFarSummaryGpuCounters, publishFarSummaryGpuCounters } from "./gpu-counters.js";

export interface FarSummaryGpuRuntimeOptions {
  gpuConfig: FarSummaryGpuConfig;
  farSummaryConfig: FarSummaryConfig;
  terrainSampler: FarTerrainSampler;
  terrainFieldConfig?: TerrainFieldConfig;
  commitTile?: (tile: FarSummaryTile) => void;
  webGpuAvailable?: () => boolean;
  nowMs?: () => number;
  builderFactory?: () => Promise<FarSummaryGpuBuilder | null>;
  dispatch?: (input: FarSummaryGpuRuntimeDispatchInput) => Promise<FarSummaryGpuDispatchOrFallbackResult>;
}

export interface FarSummaryGpuRuntimeDispatchInput {
  plan: FarSummaryGpuPlan;
  config: FarSummaryGpuConfig;
  webGpuAvailable: boolean;
  builderFactory: () => Promise<FarSummaryGpuBuilder | null>;
  terrainSampler: FarTerrainSampler;
  frameIndex: number;
  nowMs: number;
}

export interface FarSummaryGpuRuntimeStats {
  scheduledFrames: number;
  skippedInflightFrames: number;
  lastDirtyTiles: number;
  lastBatches: number;
  lastFallbackTiles: number;
  lastCommittedTiles: number;
  lastFallbackReason: FarSummaryGpuDispatchOrFallbackResult["fallbackReason"] | null;
  lastError: string | null;
}

export class FarSummaryGpuRuntime {
  private builderPromise: Promise<FarSummaryGpuBuilder | null> | null = null;
  private inFlight = false;
  private disposed = false;
  private revision = 0;
  private readonly statsState: FarSummaryGpuRuntimeStats = {
    scheduledFrames: 0,
    skippedInflightFrames: 0,
    lastDirtyTiles: 0,
    lastBatches: 0,
    lastFallbackTiles: 0,
    lastCommittedTiles: 0,
    lastFallbackReason: null,
    lastError: null,
  };

  constructor(private readonly options: FarSummaryGpuRuntimeOptions) {
    this.publishIdleCounters();
  }

  update(
    center: StreamCenter,
    frameIndex: number,
    reason: FarSummaryGpuDirtyReason = "camera_ring_shift",
    dirtyRequests?: readonly FarSummaryRingRequest[],
  ): void {
    if (this.disposed) return;
    if (!this.options.gpuConfig.enabled) {
      this.publishIdleCounters();
      return;
    }
    if (this.inFlight) {
      this.statsState.skippedInflightFrames++;
      return;
    }

    const revision = ++this.revision;
    const plan = dirtyRequests
      ? buildFarSummaryGpuPlanFromRequests(
        dirtyRequests,
        this.options.farSummaryConfig,
        this.options.gpuConfig,
        reason,
        revision,
      )
      : buildFarSummaryGpuPlan(
        center,
        this.options.farSummaryConfig,
        this.options.gpuConfig,
        reason,
        revision,
      );
    this.statsState.lastDirtyTiles = plan.dirtyTiles.length;
    this.statsState.lastBatches = plan.batches.length;
    this.statsState.scheduledFrames++;
    this.inFlight = true;

    void this.dispatchPlan(plan, frameIndex)
      .catch((error) => {
        this.statsState.lastError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.inFlight = false;
      });
  }

  stats(): FarSummaryGpuRuntimeStats {
    return { ...this.statsState };
  }

  dispose(): void {
    this.disposed = true;
  }

  private async dispatchPlan(plan: FarSummaryGpuPlan, frameIndex: number): Promise<void> {
    const nowMs = this.nowMs();
    const dispatch = this.options.dispatch ?? dispatchFarSummaryGpuPlanOrFallback;
    const result = await dispatch({
      plan,
      config: this.options.gpuConfig,
      webGpuAvailable: this.webGpuAvailable(),
      builderFactory: () => this.getBuilder(),
      terrainSampler: this.options.terrainSampler,
      frameIndex,
      nowMs,
    });
    this.statsState.lastFallbackTiles = result.fallbackTiles;
    this.statsState.lastFallbackReason = result.fallbackReason;
    this.statsState.lastError = result.error?.message ?? null;
    this.statsState.lastCommittedTiles = this.commitGpuReadbacks(plan, result, frameIndex, nowMs);
  }

  private commitGpuReadbacks(
    plan: FarSummaryGpuPlan,
    result: FarSummaryGpuDispatchOrFallbackResult,
    frameIndex: number,
    nowMs: number,
  ): number {
    if (!this.options.gpuConfig.commitToCache || !result.ok || !this.options.commitTile) return 0;
    let committed = 0;
    for (const readback of result.cellReadbacks ?? []) {
      const batch = plan.batches[readback.batchIndex];
      if (!batch) continue;
      for (const descriptor of batch.tiles) {
        const offset = descriptor.cellRecordOffset ?? 0;
        const count = descriptor.tileCells * descriptor.tileCells;
        const records = readback.records.slice(offset, offset + count);
        if (records.length < count) continue;
        this.options.commitTile(farSummaryGpuCellRecordsToTile({ descriptor, records, frameIndex, nowMs }));
        committed++;
      }
    }
    return committed;
  }

  private getBuilder(): Promise<FarSummaryGpuBuilder | null> {
    if (!this.builderPromise) {
      this.builderPromise = this.options.builderFactory
        ? this.options.builderFactory()
        : createFarSummaryGpuBuilder({
            config: this.options.gpuConfig,
            terrainFieldConfig: this.options.terrainFieldConfig,
          });
    }
    return this.builderPromise;
  }

  private publishIdleCounters(): void {
    const counters = createFarSummaryGpuCounters();
    counters.enabled = this.options.gpuConfig.enabled ? 1 : 0;
    publishFarSummaryGpuCounters(undefined, counters);
  }

  private webGpuAvailable(): boolean {
    return this.options.webGpuAvailable?.() ?? (typeof navigator !== "undefined" && !!navigator.gpu);
  }

  private nowMs(): number {
    return this.options.nowMs?.() ?? performance.now();
  }
}

export function createFarSummaryGpuRuntimeFromParams(
  params: URLSearchParams,
  farSummaryConfig: FarSummaryConfig,
  terrainSampler: FarTerrainSampler,
  terrainFieldConfig?: TerrainFieldConfig,
  commitTile?: (tile: FarSummaryTile) => void,
): FarSummaryGpuRuntime {
  return new FarSummaryGpuRuntime({
    gpuConfig: farSummaryGpuConfigFromParams(params, DEFAULT_FAR_SUMMARY_GPU_CONFIG),
    farSummaryConfig,
    terrainSampler,
    terrainFieldConfig,
    commitTile,
  });
}
