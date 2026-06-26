import type { ClodCacheMetrics, WorkerCacheBuildStats } from "./cacheMetrics.js";

let workerBuildStats: WorkerCacheBuildStats | null = null;
let workerServiceMetrics: ClodCacheMetrics | null = null;

export function setWorkerCacheSnapshot(
  buildStats: WorkerCacheBuildStats | null,
  serviceMetrics: ClodCacheMetrics | null,
): void {
  workerBuildStats = buildStats;
  workerServiceMetrics = serviceMetrics;
}

export function getWorkerCacheBuildStats(): WorkerCacheBuildStats | null {
  return workerBuildStats;
}

export function getWorkerCacheServiceMetrics(): ClodCacheMetrics | null {
  return workerServiceMetrics;
}

export function clearWorkerCacheSnapshot(): void {
  workerBuildStats = null;
  workerServiceMetrics = null;
}
