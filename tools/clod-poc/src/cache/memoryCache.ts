import type { ClodCacheStoredRecord } from "./cacheTypes.js";

interface MemoryEntry {
  record: ClodCacheStoredRecord;
  lastAccessedMs: number;
}

export class MemoryCache {
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private readonly entries = new Map<string, MemoryEntry>();
  private totalBytes = 0;

  constructor(maxItems: number, maxBytes: number) {
    this.maxItems = maxItems;
    this.maxBytes = maxBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get(key: string): ClodCacheStoredRecord | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.lastAccessedMs = performance.now();
    return entry.record;
  }

  put(key: string, record: ClodCacheStoredRecord): string[] {
    const storedBytes = record.header.storedBytes;
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.record.header.storedBytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { record, lastAccessedMs: performance.now() });
    this.totalBytes += storedBytes;
    return this.evictIfNeeded();
  }

  delete(key: string): void {
    const existing = this.entries.get(key);
    if (!existing) return;
    this.totalBytes -= existing.record.header.storedBytes;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private evictIfNeeded(): string[] {
    const evicted: string[] = [];
    while (this.entries.size > this.maxItems || this.totalBytes > this.maxBytes) {
      let oldestKey: string | null = null;
      let oldestMs = Infinity;
      for (const [key, entry] of this.entries) {
        if (entry.lastAccessedMs < oldestMs) {
          oldestMs = entry.lastAccessedMs;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      const removed = this.entries.get(oldestKey)!;
      this.totalBytes -= removed.record.header.storedBytes;
      this.entries.delete(oldestKey);
      evicted.push(oldestKey);
    }
    return evicted;
  }
}
