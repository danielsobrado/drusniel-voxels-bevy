import type { ClodCacheConfig } from "./cacheConfig.js";
import type { ClodCacheGetResult, ClodCacheKeyParts, ClodCachePutResult } from "./cacheTypes.js";
import type { ClodCacheMetrics } from "./cacheMetrics.js";

export interface ClodCacheService {
  get<TArtifact>(
    keyParts: ClodCacheKeyParts,
    decode: (payload: ArrayBuffer) => TArtifact,
  ): Promise<ClodCacheGetResult<TArtifact>>;

  put<TArtifact>(
    keyParts: ClodCacheKeyParts,
    artifact: TArtifact,
    encode: (artifact: TArtifact) => ArrayBuffer,
    metadata: Record<string, string | number | boolean>,
  ): Promise<ClodCachePutResult>;

  delete(keyParts: ClodCacheKeyParts): Promise<void>;
  deleteIfMatches(
    keyParts: ClodCacheKeyParts,
    expectedMetadata: Readonly<Record<string, string | number | boolean>>,
  ): Promise<boolean>;
  clear(): Promise<void>;
  clearMemory(): void;
  clearPersistent(): Promise<void>;
  flush(): Promise<void>;
  initialize(): Promise<void>;
  getMetrics(): ClodCacheMetrics;
  getConfig(): ClodCacheConfig;
}
