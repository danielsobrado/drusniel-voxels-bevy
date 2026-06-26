import type * as THREE from "three";

export interface CanopyWorldKey {
  tileX: number;
  tileZ: number;
  ring: number;
}

export interface CanopySummaryCell {
  groundHeight: number;
  canopyHeight: number;
  coverage: number;
  crownRoughness: number;
  slope: number;
  moisture: number;
  speciesPine: number;
  speciesBroadleaf: number;
  speciesDeadwood: number;
}

export interface CanopySummaryTile {
  key: CanopyWorldKey;
  originX: number;
  originZ: number;
  cellSizeM: number;
  resolution: number;
  cells: CanopySummaryCell[];
  revision: number;
}

export interface CanopyTextureSet {
  heightTexture: THREE.DataTexture;
  coverageTexture: THREE.DataTexture;
  speciesTexture: THREE.DataTexture;
  roughnessTexture: THREE.DataTexture;
  originX: number;
  originZ: number;
  extentM: number;
  resolution: number;
  syntheticFallback: boolean;
  revision: number;
}

export interface CanopyMetrics {
  requestedTiles: number;
  builtTiles: number;
  visibleTiles: number;
  evictedTiles: number;
  fallbackSyntheticTiles: number;
  textureUploads: number;
  shellTriangles: number;
  maxCoverage: number;
  averageCoverage: number;
  buildMs: number;
  uploadMs: number;
  queuedTiles: number;
  builtThisFrame: number;
}

export function createEmptyCanopyMetrics(): CanopyMetrics {
  return {
    requestedTiles: 0,
    builtTiles: 0,
    visibleTiles: 0,
    evictedTiles: 0,
    fallbackSyntheticTiles: 0,
    textureUploads: 0,
    shellTriangles: 0,
    maxCoverage: 0,
    averageCoverage: 0,
    buildMs: 0,
    uploadMs: 0,
    queuedTiles: 0,
    builtThisFrame: 0,
  };
}

export function canopyMetricsToCounters(metrics: CanopyMetrics, enabled: boolean): Record<string, number> {
  return {
    canopy_enabled: enabled ? 1 : 0,
    canopy_visible_tiles: metrics.visibleTiles,
    canopy_queued_tiles: metrics.queuedTiles,
    canopy_built_tiles: metrics.builtTiles,
    canopy_evicted_tiles: metrics.evictedTiles,
    canopy_texture_uploads: metrics.textureUploads,
    canopy_shell_tris: metrics.shellTriangles,
    canopy_build_ms: Math.round(metrics.buildMs * 100) / 100,
    canopy_upload_ms: Math.round(metrics.uploadMs * 100) / 100,
    canopy_fallback_synthetic_tiles: metrics.fallbackSyntheticTiles,
    canopy_average_coverage: Math.round(metrics.averageCoverage * 1000) / 1000,
    canopy_max_coverage: Math.round(metrics.maxCoverage * 1000) / 1000,
    canopy_built_this_frame: metrics.builtThisFrame,
  };
}

export function tileKeyString(key: CanopyWorldKey): string {
  return `${key.ring}:${key.tileX}:${key.tileZ}`;
}

export function emptyCanopySummaryCell(): CanopySummaryCell {
  return {
    groundHeight: 0,
    canopyHeight: 0,
    coverage: 0,
    crownRoughness: 0,
    slope: 0,
    moisture: 0,
    speciesPine: 0,
    speciesBroadleaf: 0,
    speciesDeadwood: 0,
  };
}
