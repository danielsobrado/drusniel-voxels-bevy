export type ClodCacheArtifactKind =
  | "clod-page-node"
  | "clod-page-tree"
  | "terrain-summary"
  | "far-shell-summary"
  | "shadow-proxy-summary"
  | "canopy-summary";

export type CacheCompressionMode = "none" | "gzip";
export type CacheChecksumMode = "sha256";

export interface ClodCacheKeyParts {
  namespace: string;
  schemaVersion: number;
  builderVersion: string;
  artifactKind: ClodCacheArtifactKind;

  worldSeed: string;
  generatorVersion: string;
  sourceRevision: string;

  pageX?: number;
  pageZ?: number;
  lod?: number;
  nodeId?: string;

  configHash: string;
  sourceHash: string;
}

export interface ClodCacheRecordHeader {
  schemaVersion: number;
  artifactKind: ClodCacheArtifactKind;
  key: string;

  createdAtUnixMs: number;
  builderVersion: string;
  generatorVersion: string;
  worldSeed: string;
  sourceRevision: string;
  configHash: string;
  sourceHash: string;

  uncompressedBytes: number;
  storedBytes: number;
  compression: CacheCompressionMode;
  checksum: string;

  metadata: Record<string, string | number | boolean>;
}

export interface ClodCacheStoredRecord {
  header: ClodCacheRecordHeader;
  payload: ArrayBuffer;
}

export type CacheMissReason =
  | "disabled"
  | "not-found"
  | "schema-mismatch"
  | "builder-version-mismatch"
  | "generator-version-mismatch"
  | "world-seed-mismatch"
  | "source-revision-mismatch"
  | "config-hash-mismatch"
  | "source-hash-mismatch"
  | "checksum-mismatch"
  | "decode-error"
  | "backend-error";

export interface ClodCacheGetResult<TArtifact> {
  status: "hit" | "miss";
  artifact?: TArtifact;
  reason?: CacheMissReason;
  key: string;
  bytesRead: number;
  decodeMs: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ClodCachePutResult {
  key: string;
  bytesWritten: number;
  encodeMs: number;
  compression: CacheCompressionMode;
}

export interface ClodCacheManifestEntry {
  key: string;
  artifactKind: ClodCacheArtifactKind;
  createdAtUnixMs: number;
  lastAccessedUnixMs: number;
  hitCount: number;
  storedBytes: number;
}

export const CACHE_SECTION = {
  POSITIONS_F32: 1,
  NORMALS_F32: 2,
  MATERIAL_WEIGHTS_F32: 3,
  INDICES_U32: 4,
  NODE_METADATA_JSON: 5,
  TREE_METADATA_JSON: 6,
  SUMMARY_F32: 7,
  SUMMARY_U8: 8,
  PAINT_SLOTS_F32: 9,
} as const;

export const CACHE_MAGIC = "DCP1";
