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

  evictionCandidates(maxItems: number, maxBytes: number): ClodCacheManifestEntry[] {
    const ordered = [...this.entries.values()].sort(
      (left, right) => left.lastAccessedUnixMs - right.lastAccessedUnixMs,
    );
    const selected: ClodCacheManifestEntry[] = [];
    let remainingItems = ordered.length;
    let remainingBytes = this.totalStoredBytes;
    for (const entry of ordered) {
      if (remainingItems <= maxItems && remainingBytes <= maxBytes) break;
      selected.push(entry);
      remainingItems--;
      remainingBytes -= entry.storedBytes;
    }
    return selected;
  }
}
