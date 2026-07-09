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
  type FarSummaryGpuDirtyTile,
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
  onFallbackRequests?: (requests: readonly FarSummaryRingRequest[], reason: FarSummaryGpuDispatchOrFallbackResult["fallbackReason"]) => void;
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
  totalCommittedTiles: number;
  lastCpuBuildSuppressed: number;
  totalCpuBuildsSuppressed: number;
  authoritative: number;
  totalBatchesDispatched: number;
  totalTilesDispatched: number;
  deviceReady: number;
  lastFallbackReason: FarSummaryGpuDispatchOrFallbackResult["fallbackReason"] | null;
  lastError: string | null;
}

export class FarSummaryGpuRuntime {
  private builderPromise: Promise<FarSummaryGpuBuilder | null> | null = null;
  private builder: FarSummaryGpuBuilder | null = null;
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
    totalCommittedTiles: 0,
    lastCpuBuildSuppressed: 0,
    totalCpuBuildsSuppressed: 0,
    authoritative: 0,
    totalBatchesDispatched: 0,
    totalTilesDispatched: 0,
    deviceReady: 0,
    lastFallbackReason: null,
    lastError: null,
  };

  constructor(private readonly options: FarSummaryGpuRuntimeOptions) {
    this.statsState.authoritative = options.gpuConfig.authoritative ? 1 : 0;
    this.publishIdleCounters();
  }

  update(
    center: StreamCenter,
    frameIndex: number,
    reason: FarSummaryGpuDirtyReason = "camera_ring_shift",
    dirtyRequests?: readonly FarSummaryRingRequest[],
    cpuBuildSuppressed = false,
  ): void {
    if (this.disposed) return;
    this.statsState.lastCpuBuildSuppressed = cpuBuildSuppressed ? 1 : 0;
    if (cpuBuildSuppressed) this.statsState.totalCpuBuildsSuppressed++;
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
        if (this.disposed) return;
        this.statsState.lastError = error instanceof Error ? error.message : String(error);
        this.publishErrorCounters();
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
    this.builder?.dispose();
    this.builder = null;
    if (this.builderPromise) {
      void this.builderPromise.then((builder) => builder?.dispose()).catch(() => undefined);
    }
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
    if (this.disposed) return;
    this.statsState.lastFallbackTiles = result.fallbackTiles;
    this.statsState.lastFallbackReason = result.fallbackReason;
    this.statsState.lastError = result.error?.message ?? null;
    if (result.fallbackTiles > 0 && result.fallbackReason !== null) {
      this.options.onFallbackRequests?.(dirtyTilesToRequests(plan.dirtyTiles), result.fallbackReason);
    }
    const committed = this.commitGpuReadbacks(plan, result, frameIndex, nowMs);
    this.statsState.lastCommittedTiles = committed;
    this.statsState.totalCommittedTiles += committed;
    if (result.ok && result.counters.deviceReady === 1) {
      this.statsState.deviceReady = 1;
    }
    this.statsState.totalBatchesDispatched += result.counters.batchesDispatched;
    this.statsState.totalTilesDispatched += result.counters.tilesDispatched;
    result.counters.authoritative = this.options.gpuConfig.authoritative ? 1 : 0;
    result.counters.lastCommittedTiles = this.statsState.lastCommittedTiles;
    result.counters.totalCommittedTiles = this.statsState.totalCommittedTiles;
    result.counters.committedTiles = this.statsState.totalCommittedTiles;
    result.counters.cpuBuildsSuppressed = this.statsState.lastCpuBuildSuppressed;
    result.counters.runtimeError = this.statsState.lastError ? 1 : 0;
    result.counters.deviceReady = this.statsState.deviceReady;
    result.counters.batchesDispatched = this.statsState.totalBatchesDispatched;
    result.counters.tilesDispatched = this.statsState.totalTilesDispatched;
    publishFarSummaryGpuCounters(undefined, result.counters);
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
      this.builderPromise = (this.options.builderFactory
        ? this.options.builderFactory()
        : createFarSummaryGpuBuilder({
            config: this.options.gpuConfig,
            terrainFieldConfig: this.options.terrainFieldConfig,
          }))
        .then((builder) => {
          if (this.disposed) {
            builder?.dispose();
            return null;
          }
          if (builder) {
            this.statsState.deviceReady = 1;
          }
          this.builder = builder;
          return builder;
        });
    }
    return this.builderPromise;
  }

  private publishIdleCounters(): void {
    const counters = createFarSummaryGpuCounters();
    counters.enabled = this.options.gpuConfig.enabled ? 1 : 0;
    counters.authoritative = this.options.gpuConfig.authoritative ? 1 : 0;
    counters.deviceReady = this.statsState.deviceReady;
    counters.lastCommittedTiles = this.statsState.lastCommittedTiles;
    counters.totalCommittedTiles = this.statsState.totalCommittedTiles;
    counters.committedTiles = this.statsState.totalCommittedTiles;
    counters.cpuBuildsSuppressed = this.statsState.lastCpuBuildSuppressed;
    counters.batchesDispatched = this.statsState.totalBatchesDispatched;
    counters.tilesDispatched = this.statsState.totalTilesDispatched;
    counters.runtimeError = this.statsState.lastError ? 1 : 0;
    publishFarSummaryGpuCounters(undefined, counters);
  }

  private publishErrorCounters(): void {
    const counters = createFarSummaryGpuCounters();
    counters.enabled = this.options.gpuConfig.enabled ? 1 : 0;
    counters.authoritative = this.options.gpuConfig.authoritative ? 1 : 0;
    counters.deviceReady = this.statsState.deviceReady;
    counters.dirtyTiles = this.statsState.lastDirtyTiles;
    counters.fallbackTiles = this.statsState.lastDirtyTiles;
    counters.lastCommittedTiles = 0;
    counters.totalCommittedTiles = this.statsState.totalCommittedTiles;
    counters.committedTiles = this.statsState.totalCommittedTiles;
    counters.cpuBuildsSuppressed = this.statsState.lastCpuBuildSuppressed;
    counters.batchesDispatched = this.statsState.totalBatchesDispatched;
    counters.tilesDispatched = this.statsState.totalTilesDispatched;
    counters.runtimeError = 1;
    publishFarSummaryGpuCounters(undefined, counters);
  }

  private webGpuAvailable(): boolean {
    return this.options.webGpuAvailable?.() ?? (typeof navigator !== "undefined" && !!navigator.gpu);
  }

  private nowMs(): number {
    return this.options.nowMs?.() ?? performance.now();
  }
}

function dirtyTilesToRequests(tiles: readonly FarSummaryGpuDirtyTile[]): FarSummaryRingRequest[] {
  return tiles.map((tile) => ({
    ring: tile.ring,
    key: tile.key,
    priority: tile.priority,
    distanceToCamera: tile.distanceToCamera,
    distanceToPredictedCenter: tile.distanceToPredictedCenter,
  }));
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
