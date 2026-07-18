export interface ClodRenderNodeCacheConfig {
  enabled: boolean;
  maxInactiveNodes: number;
  pruneIntervalFrames: number;
  prefetchParent: boolean;
  prefetchChildren: boolean;
  maxPrefetchCreatesPerFrame: number;
  warnAtInactiveNodes: number;
  evictGeometryWithRenderNode: boolean;
}

export const DEFAULT_CLOD_RENDER_NODE_CACHE_CONFIG: ClodRenderNodeCacheConfig = {
  enabled: true,
  maxInactiveNodes: 256,
  pruneIntervalFrames: 30,
  prefetchParent: true,
  prefetchChildren: false,
  maxPrefetchCreatesPerFrame: 4,
  warnAtInactiveNodes: 224,
  evictGeometryWithRenderNode: true,
};
