export type FarSummaryTileState =
  | 'missing'
  | 'requested'
  | 'building'
  | 'ready'
  | 'stale'
  | 'cooling'
  | 'evicted';

/**
 * Versioned CPU/GPU sample layout. Consumers must tolerate newer additive fields
 * so a saved world-summary tile remains readable during a staged rollout.
 */
export const FAR_SUMMARY_LAYOUT_VERSION = 2;

export interface FarSummarySample {
  heightMin: number;
  heightMax: number;
  heightAvg: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  dominantMaterial: number;
  materialVariance: number;
  canopyCoverage: number;
  waterCoverage: number;
  waterLevel: number;
  bodyKind: number;
  shoreDistance: number;
  flowX: number;
  flowZ: number;
  canopyHeightAvg: number;
  speciesPine: number;
  speciesBroadleaf: number;
  speciesDeadwood: number;
  structureCoverage: number;
  caveEntranceCoverage: number;
  occluderHeight: number;
  slope: number;
  roughness: number;
}

export interface FarSummaryTileKey {
  ring: number;
  x: number;
  z: number;
  cellSizeM: number;
}

export interface FarSummaryTile {
  key: FarSummaryTileKey;
  state: FarSummaryTileState;
  revision: number;
  builtEpoch?: number;
  builtAtGlobalRevision?: number;
  lastTouchedFrame: number;
  lastTouchedTimeMs: number;
  cellSizeM: number;
  tileCells: number;
  originX: number;
  originZ: number;
  samples: FarSummarySample[];
}

export interface FarSummaryStats {
  requestedTiles: number;
  buildingTiles: number;
  readyTiles: number;
  staleTiles: number;
  evictedTiles: number;
  cacheHits: number;
  cacheMisses: number;
  proceduralFallbacks: number;
  lowerRingFallbacks: number;
  conservativeFallbacks: number;
  tilesBuiltThisFrame: number;
  tilesCommittedThisFrame: number;
  buildTimeMs: number;
  maxBuildTimeMs: number;
  staleRestores: number;
  buildsDiscarded: number;
}
