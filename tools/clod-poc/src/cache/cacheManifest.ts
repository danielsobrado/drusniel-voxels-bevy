import type { ClodCacheManifestEntry } from "./cacheTypes.js";

export class ClodCacheManifest {
  private readonly entries = new Map<string, ClodCacheManifestEntry>();

  get size(): number {
    return this.entries.size;
  }

  get totalStoredBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.storedBytes;
    return total;
  }

  getEntry(key: string): ClodCacheManifestEntry | undefined {
    return this.entries.get(key);
  }

  listEntries(): ClodCacheManifestEntry[] {
    return [...this.entries.values()];
  }

  upsert(entry: ClodCacheManifestEntry): void {
    this.entries.set(entry.key, entry);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  touchHit(key: string, nowMs: number): void {
    const existing = this.entries.get(key);
    if (!existing) return;
    existing.lastAccessedUnixMs = nowMs;
    existing.hitCount++;
  }

  evictOldest(maxItems: number, maxBytes: number): string[] {
    const evicted: string[] = [];
    while (this.entries.size > maxItems || this.totalStoredBytes > maxBytes) {
      let oldest: ClodCacheManifestEntry | null = null;
      for (const entry of this.entries.values()) {
        if (!oldest || entry.lastAccessedUnixMs < oldest.lastAccessedUnixMs) oldest = entry;
      }
      if (!oldest) break;
      this.entries.delete(oldest.key);
      evicted.push(oldest.key);
      if (this.entries.size === 0) break;
    }
    return evicted;
  }
}
