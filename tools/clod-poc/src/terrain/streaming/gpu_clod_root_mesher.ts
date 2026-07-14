import { requestWebGpuDevice } from "../../gpu/webgpu_device.js";
import { getCurrentRendererGpuDevice } from "../../rendering/webgpu_device_bridge.js";
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
import { gpuClodHierarchyConfigFromWindow, type GpuClodHierarchyConfig } from "./gpu_clod_hierarchy_config.js";
import { GpuClodResidentPageCache } from "./gpu_clod_resident_page_cache.js";
import { createBufferedResidentAdoption } from "./gpu_clod_resident_adoption.js";

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
  overlapEventsTotal: number;
  waiters: number;
}

export class PooledGpuClodRootMesher implements GpuClodRootMesher {
  private readonly available: number[];
  private readonly waiters: PoolWaiter[] = [];
  private active = 0;
  private maxActive = 0;
  private overlapEventsTotal = 0;
  private fallbackPages = 0;
  private workerFallbackPages = 0;
  private residentHierarchyFailures = 0;
  private residentHierarchyDisabled = false;
  private disposed = false;
  private resourcesDisposed = false;

  constructor(
    private readonly meshers: readonly GpuClodRootMesher[],
    private readonly residentPages: GpuClodResidentPageCache | null = null,
  ) {
    if (meshers.length === 0) throw new Error("GPU CLOD root pool requires at least one mesher");
    this.available = meshers.map((_mesher, index) => index);
    this.publishCounters();
  }

  async buildPages(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult> {
    const index = await this.acquire();
    try {
      return await this.meshers[index]!.buildPages(batch);
    } catch (error) {
      if (this.residentPages && !this.residentHierarchyDisabled) {
        this.residentHierarchyFailures++;
      }
      throw error;
    } finally {
      this.active = Math.max(0, this.active - 1);
      this.release(index);
      this.disposeResourcesWhenIdle();
      this.publishCounters();
    }
  }

  stats(): GpuClodRootMesherStats {
    const stats = this.meshers.map((mesher) => mesher.stats());
    return {
      enabled: !this.disposed && stats.every((value) => value.enabled === 1) ? 1 : 0,
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
      overlapEventsTotal: this.overlapEventsTotal,
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
    this.residentHierarchyDisabled = true;
    const error = new Error("GPU CLOD root pool disposed");
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    this.available.length = 0;
    this.disposeResourcesWhenIdle();
    this.publishCounters();
  }

  private acquire(): Promise<number> {
    if (this.disposed) return Promise.reject(new Error("GPU CLOD root pool disposed"));
    const index = this.available.shift();
    if (index !== undefined) {
      this.beginBuild();
      return Promise.resolve(index);
    }
    return new Promise<number>((resolve, reject) => {
      this.waiters.push({
        resolve: (releasedIndex) => {
          this.beginBuild();
          resolve(releasedIndex);
        },
        reject,
      });
      this.publishCounters();
    });
  }

  private beginBuild(): void {
    this.active++;
    if (this.active > 1) this.overlapEventsTotal++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.publishCounters();
  }

  private release(index: number): void {
    if (this.disposed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(index);
    else this.available.push(index);
  }

  private disposeResourcesWhenIdle(): void {
    if (!this.disposed || this.active > 0 || this.resourcesDisposed) return;
    this.resourcesDisposed = true;
    for (const mesher of this.meshers) mesher.dispose();
    this.residentPages?.dispose();
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
    counters["live_clod_stream_gpu_pool_overlap_events_total"] = pool.overlapEventsTotal;
    counters["live_clod_stream_gpu_pool_waiters"] = pool.waiters;
    counters["live_clod_gpu_hierarchy_failures_total"] = this.residentHierarchyFailures;
    counters["live_clod_gpu_hierarchy_runtime_disabled"] = this.residentHierarchyDisabled ? 1 : 0;
  }
}

export async function createGpuClodRootMesher(
  opts: CreateGpuClodRootMesherOptions,
): Promise<GpuClodRootMesher | null> {
  const poolCount = resolvePoolCount(opts.config.maxInflightBatches);
  const hierarchyConfig = gpuClodHierarchyConfigFromWindow();
  const rendererDevice = getCurrentRendererGpuDevice();
  let device = opts.sharedDevice ?? rendererDevice;

  if (!device && poolCount > 1) {
    const requested = await requestWebGpuDevice();
    if (!requested.ok) {
      console.warn("[clod-stream-gpu] shared WebGPU device unavailable; using CPU worker fallback", requested.message ?? requested.reason);
      publishGpuClodRootMesherCounters(disabledGpuStats());
      return null;
    }
    device = requested.device;
  }

  const residentDeviceCompatible = Boolean(
    device
    && hierarchyConfig.enabled
    && (!hierarchyConfig.renderResidentPages || opts.sharedDevice === device || rendererDevice === device),
  );
  let residentPages = residentDeviceCompatible && device
    ? new GpuClodResidentPageCache(device, hierarchyConfig)
    : null;
  const childConfig = poolCount === 1 ? opts.config : splitPoolConfig(opts.config, poolCount);

  if (hierarchyConfig.enabled && !residentDeviceCompatible) {
    console.warn("[clod-stream-gpu] resident rendering requires the Three WebGPU device; using validated readback path");
  }
  if (residentPages && device) {
    const residentMeshers = await createResidentPool(
      opts,
      childConfig,
      hierarchyConfig,
      device,
      residentPages,
      poolCount,
    );
    if (residentMeshers) return new PooledGpuClodRootMesher(residentMeshers, residentPages);
    residentPages.dispose();
    residentPages = null;
    console.warn("[clod-stream-gpu] resident CLOD path failed to initialize; reverting to validated GPU readback path");
  }

  const standardMeshers = await createStandardPool(opts, childConfig, device, poolCount);
  if (!standardMeshers) {
    publishGpuClodRootMesherCounters(disabledGpuStats());
    return null;
  }
  return new PooledGpuClodRootMesher(standardMeshers);
}

async function createResidentPool(
  opts: CreateGpuClodRootMesherOptions,
  childConfig: CreateGpuClodRootMesherOptions["config"],
  hierarchyConfig: GpuClodHierarchyConfig,
  device: GPUDevice,
  residentPages: GpuClodResidentPageCache,
  poolCount: number,
): Promise<GpuClodRootMesher[] | null> {
  const { createResidentGpuClodRootMesher } = await import("./gpu_clod_root_resident_mesher.js");
  const meshers: GpuClodRootMesher[] = [];
  for (let index = 0; index < poolCount; index++) {
    const adoption = createBufferedResidentAdoption(residentPages);
    const mesher = await createResidentGpuClodRootMesher({
      ...opts,
      sharedDevice: device,
      config: childConfig,
      hierarchyConfig,
      onResidentPage: adoption.onPage,
    });
    if (!mesher) {
      for (const created of meshers) created.dispose();
      return null;
    }
    meshers.push(adoption.wrap(mesher));
  }
  return meshers;
}

async function createStandardPool(
  opts: CreateGpuClodRootMesherOptions,
  childConfig: CreateGpuClodRootMesherOptions["config"],
  device: GPUDevice | null,
  poolCount: number,
): Promise<GpuClodRootMesher[] | null> {
  const meshers: GpuClodRootMesher[] = [];
  for (let index = 0; index < poolCount; index++) {
    const mesher = await createSingleGpuClodRootMesher({
      ...opts,
      sharedDevice: device ?? opts.sharedDevice,
      config: childConfig,
    });
    if (!mesher) {
      for (const created of meshers) created.dispose();
      return null;
    }
    meshers.push(mesher);
  }
  return meshers;
}

function splitPoolConfig(
  config: CreateGpuClodRootMesherOptions["config"],
  poolCount: number,
): CreateGpuClodRootMesherOptions["config"] {
  return {
    ...config,
    maxInflightBatches: 1,
    maxChunkSlots: splitBudget(config.maxChunkSlots, DEFAULT_TOTAL_CHUNK_SLOTS, poolCount),
    maxTotalSlotBytes: splitBudget(config.maxTotalSlotBytes, DEFAULT_TOTAL_SLOT_BYTES, poolCount),
    maxReadbackBufferBytes: splitBudget(config.maxReadbackBufferBytes, DEFAULT_TOTAL_READBACK_BYTES, poolCount),
  };
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
