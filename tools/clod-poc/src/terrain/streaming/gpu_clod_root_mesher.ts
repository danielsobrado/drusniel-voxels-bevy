import { requestWebGpuDevice } from "../../gpu/webgpu_device.js";
import {
  createGpuClodRootMesher as createSingleGpuClodRootMesher,
  disabledGpuStats,
  publishGpuClodRootMesherCounters,
  type CreateGpuClodRootMesherOptions,
  type GpuClodRootBuildRequest,
  type GpuClodRootBuildResult,
  type GpuClodRootMesher,
  type GpuClodRootMesherStats,
} from "./gpu_clod_root_mesher_single.js";

export {
  disabledGpuStats,
  publishGpuClodRootMesherCounters,
  terrainFieldShaderWithTileAtlas,
} from "./gpu_clod_root_mesher_single.js";
export type {
  CreateGpuClodRootMesherOptions,
  GpuClodRootBuildRequest,
  GpuClodRootBuildResult,
  GpuClodRootMesher,
  GpuClodRootMesherStats,
} from "./gpu_clod_root_mesher_single.js";

const DEFAULT_TOTAL_CHUNK_SLOTS = 64;
const DEFAULT_TOTAL_SLOT_BYTES = 512 * 1024 * 1024;
const DEFAULT_TOTAL_READBACK_BYTES = 256 * 1024 * 1024;
const MAX_GPU_POOL_COUNT = 3;

type PoolWaiter = {
  resolve: (index: number) => void;
  reject: (error: Error) => void;
};

export interface GpuClodRootPoolStats {
  poolCount: number;
  active: number;
  maxActive: number;
  waiters: number;
}

export class PooledGpuClodRootMesher implements GpuClodRootMesher {
  private readonly available: number[];
  private readonly waiters: PoolWaiter[] = [];
  private active = 0;
  private maxActive = 0;
  private fallbackPages = 0;
  private workerFallbackPages = 0;
  private disposed = false;

  constructor(private readonly meshers: readonly GpuClodRootMesher[]) {
    if (meshers.length === 0) throw new Error("GPU CLOD root pool requires at least one mesher");
    this.available = meshers.map((_mesher, index) => index);
    this.publishCounters();
  }

  async buildPages(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult> {
    const index = await this.acquire();
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.publishCounters();
    try {
      return await this.meshers[index]!.buildPages(batch);
    } finally {
      this.active--;
      this.release(index);
      this.publishCounters();
    }
  }

  stats(): GpuClodRootMesherStats {
    const stats = this.meshers.map((mesher) => mesher.stats());
    return {
      enabled: stats.every((value) => value.enabled === 1) ? 1 : 0,
      batchesDispatched: sum(stats, "batchesDispatched"),
      pagesDispatched: sum(stats, "pagesDispatched"),
      batchPagesP95: max(stats, "batchPagesP95"),
      chunkSlotsDispatched: sum(stats, "chunkSlotsDispatched"),
      encodeSubmitMsP50: max(stats, "encodeSubmitMsP50"),
      encodeSubmitMsP95: max(stats, "encodeSubmitMsP95"),
      countReadbackMsP95: max(stats, "countReadbackMsP95"),
      geometryReadbackMsP95: max(stats, "geometryReadbackMsP95"),
      buildMsP50: max(stats, "buildMsP50"),
      buildMsP95: max(stats, "buildMsP95"),
      buildMsMax: max(stats, "buildMsMax"),
      readbackMsP95: max(stats, "readbackMsP95"),
      fallbackPages: sum(stats, "fallbackPages") + this.fallbackPages,
      failedBatches: sum(stats, "failedBatches"),
      workerFallbackPages: sum(stats, "workerFallbackPages") + this.workerFallbackPages,
    };
  }

  poolStats(): GpuClodRootPoolStats {
    return {
      poolCount: this.meshers.length,
      active: this.active,
      maxActive: this.maxActive,
      waiters: this.waiters.length,
    };
  }

  recordFallbackPages(count: number): void {
    this.fallbackPages += normalizedCount(count);
    this.publishCounters();
  }

  recordWorkerFallbackPages(count: number): void {
    this.workerFallbackPages += normalizedCount(count);
    this.publishCounters();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error("GPU CLOD root pool disposed");
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    for (const mesher of this.meshers) mesher.dispose();
    this.available.length = 0;
    this.publishCounters();
  }

  private acquire(): Promise<number> {
    if (this.disposed) return Promise.reject(new Error("GPU CLOD root pool disposed"));
    const index = this.available.shift();
    if (index !== undefined) return Promise.resolve(index);
    return new Promise<number>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private release(index: number): void {
    if (this.disposed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(index);
    else this.available.push(index);
  }

  private publishCounters(): void {
    publishGpuClodRootMesherCounters(this.stats());
    const counters = (globalThis as typeof globalThis & {
      window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
    }).window?.__drusnielClod?.stats?.counters;
    if (!counters) return;
    const pool = this.poolStats();
    counters["live_clod_stream_gpu_pool_count"] = pool.poolCount;
    counters["live_clod_stream_gpu_pool_active"] = pool.active;
    counters["live_clod_stream_gpu_pool_max_active"] = pool.maxActive;
    counters["live_clod_stream_gpu_pool_waiters"] = pool.waiters;
  }
}

export async function createGpuClodRootMesher(
  opts: CreateGpuClodRootMesherOptions,
): Promise<GpuClodRootMesher | null> {
  const poolCount = resolvePoolCount(opts.config.maxInflightBatches);
  if (poolCount === 1) return createSingleGpuClodRootMesher(opts);

  let device = opts.sharedDevice ?? null;
  if (!device) {
    const requested = await requestWebGpuDevice();
    if (!requested.ok) {
      console.warn("[clod-stream-gpu] shared WebGPU device unavailable; using CPU worker fallback", requested.message ?? requested.reason);
      publishGpuClodRootMesherCounters(disabledGpuStats());
      return null;
    }
    device = requested.device;
  }

  const childConfig = {
    ...opts.config,
    maxInflightBatches: 1,
    maxChunkSlots: splitBudget(opts.config.maxChunkSlots, DEFAULT_TOTAL_CHUNK_SLOTS, poolCount),
    maxTotalSlotBytes: splitBudget(opts.config.maxTotalSlotBytes, DEFAULT_TOTAL_SLOT_BYTES, poolCount),
    maxReadbackBufferBytes: splitBudget(opts.config.maxReadbackBufferBytes, DEFAULT_TOTAL_READBACK_BYTES, poolCount),
  };
  const meshers: GpuClodRootMesher[] = [];
  for (let index = 0; index < poolCount; index++) {
    const mesher = await createSingleGpuClodRootMesher({ ...opts, sharedDevice: device, config: childConfig });
    if (!mesher) {
      for (const created of meshers) created.dispose();
      publishGpuClodRootMesherCounters(disabledGpuStats());
      return null;
    }
    meshers.push(mesher);
  }
  return new PooledGpuClodRootMesher(meshers);
}

function resolvePoolCount(requested: number): number {
  if (!Number.isFinite(requested)) return 1;
  return Math.max(1, Math.min(MAX_GPU_POOL_COUNT, Math.floor(requested)));
}

function splitBudget(configured: number | undefined, fallback: number, poolCount: number): number {
  const total = configured !== undefined && Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : fallback;
  return Math.max(1, Math.floor(total / poolCount));
}

function normalizedCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function sum(stats: readonly GpuClodRootMesherStats[], key: keyof GpuClodRootMesherStats): number {
  return stats.reduce((total, value) => total + value[key], 0);
}

function max(stats: readonly GpuClodRootMesherStats[], key: keyof GpuClodRootMesherStats): number {
  return stats.reduce((highest, value) => Math.max(highest, value[key]), 0);
}
