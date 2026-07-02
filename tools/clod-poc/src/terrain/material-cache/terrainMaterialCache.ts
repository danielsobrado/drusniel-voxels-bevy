import type { TerrainMaterialCacheConfig } from "./terrainMaterialCacheConfig.js";
import {
  emptyTerrainMaterialCacheCounters,
  terrainMaterialCacheKeyString,
  terrainMaterialCacheStableSourceKey,
  type TerrainMaterialCacheCounters,
  type TerrainMaterialCacheEntry,
  type TerrainMaterialCacheKey,
  type TerrainMaterialCacheLookup,
  type TerrainMaterialSourceProvider,
} from "./terrainMaterialCacheTypes.js";
import { estimatePayloadBytes } from "./terrainMaterialPacking.js";

type BakeJob = {
  cacheKey: string;
  entry: TerrainMaterialCacheEntry;
  provider: TerrainMaterialSourceProvider;
};

export class TerrainMaterialCache {
  private readonly entries = new Map<string, TerrainMaterialCacheEntry>();
  private readonly queue: BakeJob[] = [];
  private readonly queuedKeys = new Set<string>();
  private readonly countersState = emptyTerrainMaterialCacheCounters();
  private lastLogMs = 0;

  constructor(
    private readonly config: TerrainMaterialCacheConfig,
    private readonly logger: Pick<Console, "warn" | "info"> = console,
  ) {}

  getOrQueue(key: TerrainMaterialCacheKey, sourceProvider: TerrainMaterialSourceProvider, frame: number): TerrainMaterialCacheLookup {
    if (!this.config.enabled || this.config.debug.disableCache) {
      return { kind: "fallback", reason: "cache_disabled" };
    }
    const cacheKey = terrainMaterialCacheKeyString(key);
    const existing = this.entries.get(cacheKey);
    if (existing?.status === "ready") {
      existing.lastUsedFrame = frame;
      this.countersState.terrainMaterialCacheHits++;
      return { kind: "ready", entry: existing };
    }
    if (existing?.status === "queued" || existing?.status === "baking") {
      existing.lastUsedFrame = frame;
      this.countersState.terrainMaterialCacheMisses++;
      return { kind: "fallback", reason: existing.status };
    }
    if (existing?.status === "failed") {
      existing.lastUsedFrame = frame;
      this.countersState.terrainMaterialCacheMisses++;
      return { kind: "fallback", reason: "failed" };
    }

    const stale = this.findStaleEntry(key, frame);
    const entry: TerrainMaterialCacheEntry = existing ?? {
      key,
      status: "queued",
      payload: null,
      lastUsedFrame: frame,
      byteSizeEstimate: 0,
      errorMessage: null,
      queuedFrame: frame,
      readyFrame: -1,
    };
    entry.status = "queued";
    entry.errorMessage = null;
    entry.queuedFrame = frame;
    entry.lastUsedFrame = frame;
    this.entries.set(cacheKey, entry);
    this.enqueue(cacheKey, entry, sourceProvider);
    this.countersState.terrainMaterialCacheMisses++;
    this.countersState.terrainMaterialCacheQueued++;

    if (stale && this.config.bake.keepStaleUntilReady) {
      stale.status = "stale";
      return { kind: "fallback", reason: "queued", staleEntry: stale };
    }
    return { kind: "fallback", reason: "queued" };
  }

  processFrame(frame: number, now: () => number = () => performance.now()): void {
    const start = now();
    let baked = 0;
    while (this.queue.length > 0 && baked < this.config.bake.maxTilesBakedPerFrame) {
      if (now() - start >= this.config.bake.maxCpuMsPerFrame) break;
      const job = this.queue.shift()!;
      this.queuedKeys.delete(job.cacheKey);
      if (!this.entries.has(job.cacheKey)) continue;
      job.entry.status = "baking";
      this.countersState.terrainMaterialCacheBaking++;
      const bakeStart = now();
      try {
        const payload = job.provider();
        payload.debug.bakeMs = payload.debug.bakeMs || now() - bakeStart;
        job.entry.payload = payload;
        job.entry.status = "ready";
        job.entry.readyFrame = frame;
        job.entry.lastUsedFrame = frame;
        job.entry.byteSizeEstimate = estimatePayloadBytes(payload);
        this.countersState.terrainMaterialBakeMs += payload.debug.bakeMs;
        this.countersState.terrainMaterialUploadMs += payload.debug.uploadMs;
        baked++;
      } catch (error) {
        job.entry.status = "failed";
        job.entry.errorMessage = error instanceof Error ? error.message : String(error);
        this.throttledWarn(`[terrain-material-cache] bake failed for ${job.cacheKey}: ${job.entry.errorMessage}`, now());
      }
    }
    this.pruneLru();
    this.refreshCounters();
  }

  invalidateWhere(predicate: (entry: TerrainMaterialCacheEntry) => boolean, reason = "manual"): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (!predicate(entry)) continue;
      if (entry.status === "ready" && this.config.bake.keepStaleUntilReady) {
        entry.status = "stale";
      } else {
        this.entries.delete(terrainMaterialCacheKeyString(entry.key));
      }
      count++;
    }
    if (count > 0 && this.config.debug.showInvalidations) {
      this.throttledInfo(`[terrain-material-cache] invalidated ${count} entries (${reason})`, performance.now());
    }
    this.refreshCounters();
    return count;
  }

  invalidateSource(sourceKind: TerrainMaterialCacheKey["sourceKind"], sourceId: string): number {
    return this.invalidateWhere((entry) => entry.key.sourceKind === sourceKind && entry.key.sourceId === sourceId, "source");
  }

  invalidateMaterialRevision(materialRevision: number): number {
    return this.invalidateWhere((entry) => entry.key.materialRevision < materialRevision, "material_revision");
  }

  forceRebakeVisible(keys: readonly TerrainMaterialCacheKey[], frame: number, providerFor: (key: TerrainMaterialCacheKey) => TerrainMaterialSourceProvider | null): number {
    let queued = 0;
    for (const key of keys) {
      const provider = providerFor(key);
      if (!provider) continue;
      const cacheKey = terrainMaterialCacheKeyString(key);
      const entry = this.entries.get(cacheKey);
      if (entry) {
        entry.status = entry.payload && this.config.bake.keepStaleUntilReady ? "stale" : "queued";
        entry.lastUsedFrame = frame;
        this.enqueue(cacheKey, entry, provider);
        queued++;
      } else {
        this.getOrQueue(key, provider, frame);
        queued++;
      }
    }
    return queued;
  }

  counters(): TerrainMaterialCacheCounters {
    this.refreshCounters();
    return { ...this.countersState };
  }

  entriesSnapshot(): TerrainMaterialCacheEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

  private enqueue(cacheKey: string, entry: TerrainMaterialCacheEntry, provider: TerrainMaterialSourceProvider): void {
    if (this.queuedKeys.has(cacheKey)) return;
    this.queue.push({ cacheKey, entry, provider });
    this.queuedKeys.add(cacheKey);
  }

  private findStaleEntry(key: TerrainMaterialCacheKey, frame: number): TerrainMaterialCacheEntry | null {
    const stable = terrainMaterialCacheStableSourceKey(key);
    let best: TerrainMaterialCacheEntry | null = null;
    for (const entry of this.entries.values()) {
      if (terrainMaterialCacheStableSourceKey(entry.key) !== stable) continue;
      if (!entry.payload || (entry.status !== "ready" && entry.status !== "stale")) continue;
      if (!best || entry.readyFrame > best.readyFrame) best = entry;
    }
    if (best) best.lastUsedFrame = frame;
    return best;
  }

  private pruneLru(): void {
    this.refreshCounters();
    while (this.countersState.terrainMaterialCacheBytes > this.config.budget.maxBytes) {
      const candidates = [...this.entries.entries()]
        .filter(([, entry]) => entry.status !== "queued" && entry.status !== "baking")
        .sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);
      const victim = candidates[0];
      if (!victim) break;
      this.entries.delete(victim[0]);
      this.countersState.terrainMaterialCacheEvictions++;
      this.refreshCounters();
    }
  }

  private refreshCounters(): void {
    let ready = 0;
    let stale = 0;
    let failed = 0;
    let bytes = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === "ready") ready++;
      if (entry.status === "stale") stale++;
      if (entry.status === "failed") failed++;
      bytes += entry.byteSizeEstimate;
    }
    this.countersState.terrainMaterialCacheReady = ready;
    this.countersState.terrainMaterialCacheStale = stale;
    this.countersState.terrainMaterialCacheFailed = failed;
    this.countersState.terrainMaterialCacheBytes = bytes;
  }

  private throttledWarn(message: string, nowMs: number): void {
    if (nowMs - this.lastLogMs < 1000) return;
    this.lastLogMs = nowMs;
    this.logger.warn(message);
  }

  private throttledInfo(message: string, nowMs: number): void {
    if (nowMs - this.lastLogMs < 1000) return;
    this.lastLogMs = nowMs;
    this.logger.info(message);
  }
}
