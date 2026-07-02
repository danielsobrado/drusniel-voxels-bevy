import type { TerrainMaterialCacheFormat } from "./terrainMaterialCacheConfig.js";

export type TerrainMaterialCacheSourceKind = "page" | "chunk" | "far_tile";
export type TerrainMaterialBakeMode = "near_page" | "mid_page" | "far_summary_tile";
export type TerrainMaterialCacheStatus = "missing" | "queued" | "baking" | "ready" | "stale" | "failed";
export type TerrainMaterialFallbackReason =
  | "cache_disabled"
  | "missing"
  | "queued"
  | "baking"
  | "failed"
  | "channel_unavailable";

export interface TerrainMaterialCacheKey {
  sourceKind: TerrainMaterialCacheSourceKind;
  sourceId: string;
  sourceRevision: number;
  materialRevision: number;
  waterRevision: number;
  vegetationCoverageRevision: number;
  bakeMode: TerrainMaterialBakeMode;
  resolution: number;
  formatProfile: string;
}

export interface TerrainMaterialChannel<T extends Uint8Array | Uint16Array | Float32Array = Uint8Array | Uint16Array | Float32Array> {
  readonly data: T;
  readonly width: number;
  readonly height: number;
  readonly format: TerrainMaterialCacheFormat;
  readonly available: boolean;
}

export interface TerrainMaterialBakePayload {
  readonly macroTint?: TerrainMaterialChannel<Uint8Array>;
  readonly slopeCurvature?: TerrainMaterialChannel<Uint8Array>;
  readonly materialWeights?: TerrainMaterialChannel<Uint8Array>;
  readonly wetnessShoreline?: TerrainMaterialChannel<Uint8Array>;
  readonly farColor?: TerrainMaterialChannel<Uint8Array>;
  readonly farNormal?: TerrainMaterialChannel<Uint16Array | Float32Array>;
  readonly coverage?: TerrainMaterialChannel<Uint8Array>;
  readonly debug: {
    unavailableChannels: string[];
    sourceSampleCount: number;
    bakeMs: number;
    uploadMs: number;
    usedHeightDerivedNormal: boolean;
  };
}

export interface TerrainMaterialCacheEntry {
  key: TerrainMaterialCacheKey;
  status: TerrainMaterialCacheStatus;
  payload: TerrainMaterialBakePayload | null;
  lastUsedFrame: number;
  byteSizeEstimate: number;
  errorMessage: string | null;
  queuedFrame: number;
  readyFrame: number;
}

export interface TerrainMaterialCacheCounters {
  terrainMaterialCacheHits: number;
  terrainMaterialCacheMisses: number;
  terrainMaterialCacheQueued: number;
  terrainMaterialCacheBaking: number;
  terrainMaterialCacheReady: number;
  terrainMaterialCacheStale: number;
  terrainMaterialCacheFailed: number;
  terrainMaterialCacheEvictions: number;
  terrainMaterialCacheBytes: number;
  terrainMaterialBakeMs: number;
  terrainMaterialUploadMs: number;
}

export interface TerrainMaterialCacheFallback {
  kind: "fallback";
  reason: TerrainMaterialFallbackReason;
  staleEntry?: TerrainMaterialCacheEntry;
}

export interface TerrainMaterialCacheReady {
  kind: "ready";
  entry: TerrainMaterialCacheEntry;
}

export type TerrainMaterialCacheLookup = TerrainMaterialCacheReady | TerrainMaterialCacheFallback;

export type TerrainMaterialSourceProvider = () => TerrainMaterialBakePayload;

export function terrainMaterialCacheKeyString(key: TerrainMaterialCacheKey): string {
  return [
    key.sourceKind,
    key.sourceId,
    key.sourceRevision,
    key.materialRevision,
    key.waterRevision,
    key.vegetationCoverageRevision,
    key.bakeMode,
    key.resolution,
    key.formatProfile,
  ].join("|");
}

export function terrainMaterialCacheStableSourceKey(key: TerrainMaterialCacheKey): string {
  return [
    key.sourceKind,
    key.sourceId,
    key.bakeMode,
    key.resolution,
    key.formatProfile,
  ].join("|");
}

export function emptyTerrainMaterialCacheCounters(): TerrainMaterialCacheCounters {
  return {
    terrainMaterialCacheHits: 0,
    terrainMaterialCacheMisses: 0,
    terrainMaterialCacheQueued: 0,
    terrainMaterialCacheBaking: 0,
    terrainMaterialCacheReady: 0,
    terrainMaterialCacheStale: 0,
    terrainMaterialCacheFailed: 0,
    terrainMaterialCacheEvictions: 0,
    terrainMaterialCacheBytes: 0,
    terrainMaterialBakeMs: 0,
    terrainMaterialUploadMs: 0,
  };
}
