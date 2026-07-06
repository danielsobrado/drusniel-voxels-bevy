import type { ClodPageNode } from "../types.js";
import {
  buildBaseKeyParts,
  pageNodeSourceHash,
  type ClodCacheContext,
} from "./clodCacheContext.js";
import {
  decodeClodPageNodeArtifact,
  encodeClodPageNodeArtifact,
  type ClodPageNodeArtifact,
} from "./artifactSerializer.js";
import type { WorkerCacheBuildStats } from "./cacheMetrics.js";

const STREAM_ROOT_SOURCE_SUFFIX = "stream-root-v2-world-infinite-hydrology-bounded";

export type StreamRootCacheBackend = "cpu" | "gpu";
export type StreamRootCacheStats = WorkerCacheBuildStats;

export function createEmptyStreamRootCacheStats(): StreamRootCacheStats {
  return {
    nodesFromCache: 0,
    nodesBuilt: 0,
    cacheHits: 0,
    cacheMisses: 0,
    coldBuildMsAvoided: 0,
    cacheDecodeMs: 0,
    netSavedMs: 0,
    coldBuildMs: 0,
  };
}

export async function tryLoadStreamRootNode(
  ctx: ClodCacheContext | null,
  backend: StreamRootCacheBackend,
  level: number,
  px: number,
  pz: number,
  stats: StreamRootCacheStats,
): Promise<ClodPageNode | null> {
  if (!ctx?.effective) return null;
  const nodeId = streamRootNodeId(level, px, pz);
  const result = await ctx.service.get(
    streamRootKeyParts(ctx, backend, level, px, pz, nodeId),
    decodeClodPageNodeArtifact,
  );

  if (result.status !== "hit" || !result.artifact) {
    stats.cacheMisses++;
    return null;
  }

  const cachedBuildMs = typeof result.metadata?.buildMs === "number" ? result.metadata.buildMs : 0;
  stats.nodesFromCache++;
  stats.cacheHits++;
  stats.cacheDecodeMs += result.decodeMs;
  stats.coldBuildMsAvoided += cachedBuildMs;
  stats.netSavedMs += Math.max(0, cachedBuildMs - result.decodeMs);
  return artifactToNode(result.artifact);
}

export async function storeStreamRootNode(
  ctx: ClodCacheContext | null,
  backend: StreamRootCacheBackend,
  node: ClodPageNode,
  buildMs: number,
  stats: StreamRootCacheStats,
): Promise<void> {
  if (!ctx?.effective) return;
  const parsed = parseStreamRootNodeId(node.id);
  stats.nodesBuilt++;
  stats.coldBuildMs += buildMs;
  await ctx.service.put(
    streamRootKeyParts(ctx, backend, parsed.level, parsed.pageX, parsed.pageZ, node.id),
    nodeToArtifact(node),
    encodeClodPageNodeArtifact,
    {
      buildMs,
      triangleCount: node.mesh.indices.length / 3,
      worldMode: "infinite",
      hydrologyMode: "bounded-to-startup-world",
      backend,
    },
  );
}

export function publishStreamRootCacheCounters(
  stats: StreamRootCacheStats,
  backend: StreamRootCacheBackend,
): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;

  addCounter(counters, "live_clod_stream_cache_hits", stats.cacheHits);
  addCounter(counters, "live_clod_stream_cache_misses", stats.cacheMisses);
  addCounter(counters, "live_clod_stream_cache_nodes_from_cache", stats.nodesFromCache);
  addCounter(counters, "live_clod_stream_cache_nodes_built", stats.nodesBuilt);
  addCounter(counters, "live_clod_stream_cache_cold_build_ms", stats.coldBuildMs);
  addCounter(counters, "live_clod_stream_cache_cold_build_ms_avoided", stats.coldBuildMsAvoided);
  addCounter(counters, "live_clod_stream_cache_decode_ms", stats.cacheDecodeMs);
  addCounter(counters, "live_clod_stream_cache_net_saved_ms", stats.netSavedMs);
  counters["live_clod_stream_cache_backend_gpu"] = backend === "gpu" ? 1 : 0;
  counters["live_clod_stream_cache_backend_cpu"] = backend === "cpu" ? 1 : 0;
}

function addCounter(counters: Record<string, number>, key: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) return;
  counters[key] = (counters[key] ?? 0) + value;
}

function streamRootKeyParts(
  ctx: ClodCacheContext,
  backend: StreamRootCacheBackend,
  level: number,
  px: number,
  pz: number,
  nodeId: string,
) {
  const sourceHash = streamRootSourceHash(ctx, backend);
  return buildBaseKeyParts(ctx, "clod-stream-root-node", {
    pageX: px,
    pageZ: pz,
    lod: level,
    nodeId,
    sourceHash,
  });
}

function streamRootSourceHash(ctx: ClodCacheContext, backend: StreamRootCacheBackend): string {
  return `${pageNodeSourceHash(ctx)}-${STREAM_ROOT_SOURCE_SUFFIX}-backend-${backend}`;
}

function streamRootNodeId(level: number, px: number, pz: number): string {
  return `L${level}:${px},${pz}`;
}

function parseStreamRootNodeId(nodeId: string): { level: number; pageX: number; pageZ: number } {
  const match = /^L(\d+):(-?\d+),(-?\d+)$/.exec(nodeId);
  if (!match) throw new Error(`invalid streamed root node id ${nodeId}`);
  return { level: Number(match[1]), pageX: Number(match[2]), pageZ: Number(match[3]) };
}

function artifactToNode(artifact: ClodPageNodeArtifact): ClodPageNode {
  return {
    id: artifact.nodeId,
    level: artifact.level,
    children: [],
    mesh: {
      positions: artifact.positions,
      normals: artifact.normals,
      paintSlots: artifact.paintSlots,
      materialWeights: artifact.materialWeights,
      materialWeightStride: artifact.materialWeightStride,
      indices: artifact.indices,
    },
    footprint: artifact.footprint,
    bounds: artifact.bounds,
    errorWorld: artifact.errorWorld,
    lowBenefit: artifact.lowBenefit,
  };
}

function nodeToArtifact(node: ClodPageNode): ClodPageNodeArtifact {
  return {
    nodeId: node.id,
    level: node.level,
    positions: node.mesh.positions,
    normals: node.mesh.normals,
    paintSlots: node.mesh.paintSlots,
    materialWeights: node.mesh.materialWeights,
    materialWeightStride: node.mesh.materialWeightStride,
    indices: node.mesh.indices,
    errorWorld: node.errorWorld,
    boundingSphere: [
      node.bounds.center[0],
      node.bounds.center[1],
      node.bounds.center[2],
      node.bounds.radius,
    ],
    lowBenefit: node.lowBenefit,
    footprint: node.footprint,
    bounds: node.bounds,
  };
}
