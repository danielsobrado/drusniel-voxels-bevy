import type { CacheMissReason } from "./cacheTypes.js";

export interface ClodCacheMetrics {
  enabled: boolean;
  memoryEntries: number;
  persistentEntries: number;
  pendingReads: number;
  pendingWrites: number;
  hits: number;
  misses: number;
  evictions: number;
  bytesRead: number;
  bytesWritten: number;
  decodeMsTotal: number;
  encodeMsTotal: number;
  decodeCount: number;
  encodeCount: number;
  lastMissReason: CacheMissReason | null;
  lastError: string | null;
  nodesLoadedFromCache: number;
  coldBuildMsAvoided: number;
  cacheDecodeMs: number;
  netSavedMs: number;
  coldBuildMs: number;
}

export interface WorkerCacheBuildStats {
  nodesFromCache: number;
  nodesBuilt: number;
  cacheHits: number;
  cacheMisses: number;
  coldBuildMsAvoided: number;
  cacheDecodeMs: number;
  netSavedMs: number;
  coldBuildMs: number;
}

export function createEmptyCacheMetrics(enabled: boolean): ClodCacheMetrics {
  return {
    enabled,
    memoryEntries: 0,
    persistentEntries: 0,
    pendingReads: 0,
    pendingWrites: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    bytesRead: 0,
    bytesWritten: 0,
    decodeMsTotal: 0,
    encodeMsTotal: 0,
    decodeCount: 0,
    encodeCount: 0,
    lastMissReason: null,
    lastError: null,
    nodesLoadedFromCache: 0,
    coldBuildMsAvoided: 0,
    cacheDecodeMs: 0,
    netSavedMs: 0,
    coldBuildMs: 0,
  };
}

export function hitRate(metrics: ClodCacheMetrics): number {
  const total = metrics.hits + metrics.misses;
  return total > 0 ? metrics.hits / total : 0;
}

export function averageDecodeMs(metrics: ClodCacheMetrics): number {
  return metrics.decodeCount > 0 ? metrics.decodeMsTotal / metrics.decodeCount : 0;
}

export function averageEncodeMs(metrics: ClodCacheMetrics): number {
  return metrics.encodeCount > 0 ? metrics.encodeMsTotal / metrics.encodeCount : 0;
}

export class CacheMetricsTracker {
  readonly metrics: ClodCacheMetrics;

  constructor(enabled: boolean) {
    this.metrics = createEmptyCacheMetrics(enabled);
  }

  recordHit(bytesRead: number, decodeMs: number): void {
    this.metrics.hits++;
    this.metrics.bytesRead += bytesRead;
    this.metrics.decodeMsTotal += decodeMs;
    this.metrics.decodeCount++;
  }

  recordMiss(reason: CacheMissReason): void {
    this.metrics.misses++;
    this.metrics.lastMissReason = reason;
  }

  recordEviction(count: number): void {
    this.metrics.evictions += count;
  }

  recordWrite(bytesWritten: number, encodeMs: number): void {
    this.metrics.bytesWritten += bytesWritten;
    this.metrics.encodeMsTotal += encodeMs;
    this.metrics.encodeCount++;
  }

  recordError(message: string): void {
    this.metrics.lastError = message;
  }

  setPending(reads: number, writes: number): void {
    this.metrics.pendingReads = reads;
    this.metrics.pendingWrites = writes;
  }

  setEntryCounts(memory: number, persistent: number): void {
    this.metrics.memoryEntries = memory;
    this.metrics.persistentEntries = persistent;
  }
}
