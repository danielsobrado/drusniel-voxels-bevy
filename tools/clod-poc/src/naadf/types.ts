export const SOURCE_NEAR_TABLE = "near_table" as const;
export const SOURCE_HASH_FALLBACK = "hash_fallback" as const;
export const SOURCE_FAR_CLIPMAP = "far_clipmap" as const;
export const SOURCE_MACRO = "macro" as const;
export const SOURCE_UNKNOWN = "unknown" as const;

export type QuerySource =
  | typeof SOURCE_NEAR_TABLE
  | typeof SOURCE_HASH_FALLBACK
  | typeof SOURCE_FAR_CLIPMAP
  | typeof SOURCE_MACRO
  | typeof SOURCE_UNKNOWN;

export type ChunkKey = Readonly<{
  x: number;
  z: number;
}>;

export type SummaryTileKey = Readonly<{
  ring: number;
  x: number;
  z: number;
}>;

export type ResidentState =
  | "missing"
  | "requested"
  | "building"
  | "ready"
  | "stale"
  | "cooling"
  | "evicted";

export type MipSummaryNode = Readonly<{
  occupiedAny: boolean;
  occupiedAll: boolean;

  minHeight: number;
  maxHeight: number;
  avgHeight: number;

  avgNormalX: number;
  avgNormalY: number;
  avgNormalZ: number;
  normalVariance: number;

  dominantMaterial: number;
  materialVariance: number;

  aadfPosX: number;
  aadfNegX: number;
  aadfPosZ: number;
  aadfNegZ: number;
  aadfPosY: number;
  aadfNegY: number;

  canopyCoverage: number;
  waterCoverage: number;
}>;

export type ChunkBrick = Readonly<{
  key: ChunkKey;
  originX: number;
  originZ: number;
  sizeCells: number;
  heights: Float32Array;
  materials: Uint16Array;
  canopyCoverage: Float32Array;
  waterCoverage: Float32Array;
  revision: number;
}>;

export type ChunkMipChain = Readonly<{
  key: ChunkKey;
  revision: number;
  levels: ReadonlyArray<ReadonlyArray<MipSummaryNode>>;
}>;

export type AadfDistances = Readonly<{
  posX: number;
  negX: number;
  posZ: number;
  negZ: number;
  posY: number;
  negY: number;
}>;

export type FarClipmapRingConfig = Readonly<{
  name: string;
  startM: number;
  endM: number;
  cellM: number;
}>;

export type FarSummaryTile = Readonly<{
  key: SummaryTileKey;
  originX: number;
  originZ: number;
  cellM: number;
  resolution: number;
  minHeight: Float32Array;
  maxHeight: Float32Array;
  avgHeight: Float32Array;
  dominantMaterial: Uint16Array;
  canopyCoverage: Float32Array;
  waterCoverage: Float32Array;
  revision: number;
  state: ResidentState;
}>;

export type FarSummarySample = Readonly<{
  height: number;
  minHeight: number;
  maxHeight: number;
  material: number;
  canopyCoverage: number;
  waterCoverage: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  unknown: boolean;
  ring: number;
}>;

export type TerrainQueryResult = Readonly<{
  height: number;
  material: number;
  canopyCoverage: number;
  waterCoverage: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  unknown: boolean;
  source: QuerySource;
  nearTableHit: boolean;
  hashFallbackHit: boolean;
  farClipmapHit: boolean;
  missingSample: boolean;
}>;

export type RayTraceResult = Readonly<{
  hit: boolean;
  unknown: boolean;
  hitX: number;
  hitY: number;
  hitZ: number;
  material: number;
  steps: number;
  aadfSkips: number;
  nearTableHits: number;
  hashFallbackHits: number;
  farClipmapHits: number;
  missingSamples: number;
}>;

export type SunVisibilityResult = Readonly<{
  visible: boolean;
  unknown: boolean;
  blocked: boolean;
  steps: number;
  aadfSkips: number;
  nearTableHits: number;
  hashFallbackHits: number;
  farClipmapHits: number;
  missingSamples: number;
}>;

export type SummaryStreamingUpdate = Readonly<{
  requestedJobs: number;
  buildingJobs: number;
  committedJobs: number;
  evictedEntries: number;
  residentChunks: number;
  residentFarTiles: number;
}>;

export type ResidentChunkEntry = {
  key: ChunkKey;
  state: ResidentState;
  brick: ChunkBrick | null;
  mipChain: ChunkMipChain | null;
  pendingBrick: ChunkBrick | null;
  pendingMipChain: ChunkMipChain | null;
  revision: number;
  requestedFrame: number;
  builtFrame: number;
  lastTouchedFrame: number;
  coolingSinceMs: number;
};
