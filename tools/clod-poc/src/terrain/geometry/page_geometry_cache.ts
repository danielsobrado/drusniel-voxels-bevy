import * as THREE from "three";
import type { ClodPageNode, PageMesh } from "../../types.js";

export type PageGeometryNormalMode = "source" | "recomputed";

export interface PageGeometryCacheConfig {
  maxEntries: number;
  warnAtEntries: number;
  enabled: boolean;
}

export interface PageGeometryCacheStats {
  enabled: boolean;
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
  disposals: number;
  estimatedBytes: number;
}

export interface PageGeometryResult {
  geometry: THREE.BufferGeometry;
  cacheHit: boolean;
}

export interface PageGeometryRequest {
  node: ClodPageNode;
  normalMode: PageGeometryNormalMode;
  createGeometry: () => THREE.BufferGeometry;
}

export interface PageGeometryInvalidationOptions {
  includeActive?: boolean;
  exceptGeometry?: THREE.BufferGeometry;
}

interface CacheEntry {
  key: string;
  nodeId: string;
  geometry: THREE.BufferGeometry;
  estimatedBytes: number;
  lastAccessedMs: number;
  active: boolean;
  retired: boolean;
}

export const DEFAULT_PAGE_GEOMETRY_CACHE_CONFIG: PageGeometryCacheConfig = {
  enabled: true,
  maxEntries: 8192,
  warnAtEntries: 6144,
};

const meshObjectIds = new WeakMap<PageMesh, number>();
let nextMeshObjectId = 1;

function meshObjectId(mesh: PageMesh): number {
  const existing = meshObjectIds.get(mesh);
  if (existing !== undefined) return existing;
  const id = nextMeshObjectId++;
  meshObjectIds.set(mesh, id);
  return id;
}

function finiteRevision(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function sourceRevisionSignature(node: ClodPageNode): string {
  if (!node.sourceRevisions || node.sourceRevisions.length === 0) return "";
  return node.sourceRevisions
    .map((entry) => `${entry.chunkX},${entry.chunkZ}:${entry.revision}`)
    .join(";");
}

function meshSignature(node: ClodPageNode): string {
  const nodeRevision = finiteRevision(node.revision);
  if (nodeRevision) return `node:${nodeRevision}`;

  const meshRevision = finiteRevision((node.mesh as unknown as { revision?: unknown }).revision);
  if (meshRevision) return `mesh:${meshRevision}`;

  const sourceRevisions = sourceRevisionSignature(node);
  if (sourceRevisions) return `source:${sourceRevisions}`;

  return `mesh-object:${meshObjectId(node.mesh)}`;
}

function requestKey(request: PageGeometryRequest): string {
  return `${request.node.id}|${meshSignature(request.node)}|normal:${request.normalMode}`;
}

function estimatedGeometryBytes(geometry: THREE.BufferGeometry): number {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
  if (geometry.index) bytes += geometry.index.array.byteLength;
  return bytes;
}

export class PageGeometryCache {
  private readonly config: PageGeometryCacheConfig;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly geometryKeys = new WeakMap<THREE.BufferGeometry, string>();
  private statHits = 0;
  private statMisses = 0;
  private statEvictions = 0;
  private statInvalidations = 0;
  private statDisposals = 0;
  private estimatedBytes = 0;
  private warnedAtEntries = false;

  constructor(config: PageGeometryCacheConfig) {
    this.config = {
      enabled: config.enabled,
      maxEntries: Math.max(1, Math.floor(config.maxEntries)),
      warnAtEntries: Math.max(1, Math.floor(config.warnAtEntries)),
    };
  }

  get size(): number {
    return this.entries.size;
  }

  has(nodeId: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.nodeId === nodeId) return true;
    }
    return false;
  }

  getOrCreate(request: PageGeometryRequest): THREE.BufferGeometry {
    return this.getOrCreateWithResult(request).geometry;
  }

  getOrCreateWithResult(request: PageGeometryRequest): PageGeometryResult {
    if (!this.config.enabled) {
      this.statMisses++;
      return { geometry: request.createGeometry(), cacheHit: false };
    }

    const key = requestKey(request);
    const existing = this.entries.get(key);
    if (existing && !existing.retired) {
      existing.lastAccessedMs = performance.now();
      this.statHits++;
      return { geometry: existing.geometry, cacheHit: true };
    }

    if (existing?.retired && existing.active) {
      throw new Error(
        `[clod] active retired geometry requested with unchanged key ${key}; bump node.revision before rebuilding`,
      );
    }

    if (existing && !existing.active) this.disposeEntry(existing, false);

    const geometry = request.createGeometry();
    const entry: CacheEntry = {
      key,
      nodeId: request.node.id,
      geometry,
      estimatedBytes: estimatedGeometryBytes(geometry),
      lastAccessedMs: performance.now(),
      active: false,
      retired: false,
    };
    this.entries.set(key, entry);
    this.geometryKeys.set(geometry, key);
    this.estimatedBytes += entry.estimatedBytes;
    this.statMisses++;
    this.warnIfNeeded();
    this.evictIfNeeded(key);
    return { geometry, cacheHit: false };
  }

  owns(geometry: THREE.BufferGeometry): boolean {
    return this.geometryKeys.has(geometry);
  }

  setGeometryActive(geometry: THREE.BufferGeometry, active: boolean): void {
    const key = this.geometryKeys.get(geometry);
    if (!key) return;
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.active = active;
    if (!active && entry.retired) this.disposeEntry(entry, false);
  }

  invalidateNode(nodeId: string, options: PageGeometryInvalidationOptions = {}): void {
    const exceptKey = options.exceptGeometry ? this.geometryKeys.get(options.exceptGeometry) : undefined;
    let changed = false;
    for (const entry of [...this.entries.values()]) {
      if (entry.nodeId !== nodeId || entry.key === exceptKey) continue;
      changed = this.disposeOrRetireEntry(entry, false, Boolean(options.includeActive)) || changed;
    }
    if (changed) this.statInvalidations++;
  }

  invalidateMany(nodeIds: Iterable<string>, options: PageGeometryInvalidationOptions = {}): void {
    for (const nodeId of nodeIds) this.invalidateNode(nodeId, options);
  }

  invalidateAll(): void {
    const hadEntries = this.entries.size > 0;
    for (const entry of [...this.entries.values()]) this.disposeEntry(entry, false);
    if (hadEntries) this.statInvalidations++;
  }

  pruneToActiveNodes(activeNodeIds: ReadonlySet<string>): void {
    let removed = false;
    for (const entry of [...this.entries.values()]) {
      if (entry.active || activeNodeIds.has(entry.nodeId)) continue;
      this.disposeEntry(entry, false);
      removed = true;
    }
    if (removed) this.statInvalidations++;
  }

  stats(): PageGeometryCacheStats {
    return {
      enabled: this.config.enabled,
      entries: this.entries.size,
      hits: this.statHits,
      misses: this.statMisses,
      evictions: this.statEvictions,
      invalidations: this.statInvalidations,
      disposals: this.statDisposals,
      estimatedBytes: this.estimatedBytes,
    };
  }

  dispose(): void {
    for (const entry of [...this.entries.values()]) this.disposeEntry(entry, false);
  }

  private evictIfNeeded(protectedKey: string): void {
    while (this.entries.size > this.config.maxEntries) {
      let oldest: CacheEntry | null = null;
      for (const entry of this.entries.values()) {
        if (entry.key === protectedKey || entry.active) continue;
        if (!oldest || entry.lastAccessedMs < oldest.lastAccessedMs) oldest = entry;
      }
      if (!oldest) return;
      this.disposeEntry(oldest, true);
    }
  }

  private disposeOrRetireEntry(entry: CacheEntry, evicted: boolean, includeActive: boolean): boolean {
    if (entry.active && !includeActive) {
      entry.retired = true;
      return true;
    }
    this.disposeEntry(entry, evicted);
    return true;
  }

  private disposeEntry(entry: CacheEntry, evicted: boolean): void {
    if (!this.entries.delete(entry.key)) return;
    this.geometryKeys.delete(entry.geometry);
    this.estimatedBytes -= entry.estimatedBytes;
    entry.geometry.dispose();
    this.statDisposals++;
    if (evicted) this.statEvictions++;
  }

  private warnIfNeeded(): void {
    if (this.warnedAtEntries || this.entries.size < this.config.warnAtEntries) return;
    this.warnedAtEntries = true;
    console.warn(`[clod] page geometry cache has ${this.entries.size} entries; active geometries make max_entries a soft cap`);
  }
}
