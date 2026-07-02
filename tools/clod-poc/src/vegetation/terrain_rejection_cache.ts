import { DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG, type VegetationTerrainRejectionDecision } from "./terrain_rejection_config.js";

export interface VegetationTerrainRejectionCacheStats {
  hits: number;
  misses: number;
  entries: number;
  evictions: number;
}

interface CacheEntry {
  decision: VegetationTerrainRejectionDecision;
  lastUsed: number;
}

export class VegetationTerrainRejectionCache {
  private readonly entries = new Map<string, CacheEntry>();
  private clock = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly maxEntries = DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheMaxEntries) {}

  get(key: string): VegetationTerrainRejectionDecision | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    this.hits++;
    entry.lastUsed = ++this.clock;
    return entry.decision;
  }

  set(key: string, decision: VegetationTerrainRejectionDecision): void {
    if (this.maxEntries <= 0) return;
    this.entries.set(key, { decision, lastUsed: ++this.clock });
    this.prune();
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): VegetationTerrainRejectionCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      evictions: this.evictions,
    };
  }

  private prune(): void {
    while (this.entries.size > this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestUsed = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
        if (entry.lastUsed < oldestUsed) {
          oldestUsed = entry.lastUsed;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      this.entries.delete(oldestKey);
      this.evictions++;
    }
  }
}

export function quantizeTerrainRejectionBucket(value: number, cellSize: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value / Math.max(0.001, cellSize));
}
