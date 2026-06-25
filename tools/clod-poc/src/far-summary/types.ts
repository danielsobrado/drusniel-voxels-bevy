export type FarSummaryTileState =
  | 'missing'
  | 'requested'
  | 'building'
  | 'ready'
  | 'stale'
  | 'cooling'
  | 'evicted';

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
  tilesBuiltThisFrame: number;
  tilesCommittedThisFrame: number;
  buildTimeMs: number;
  maxBuildTimeMs: number;
}
