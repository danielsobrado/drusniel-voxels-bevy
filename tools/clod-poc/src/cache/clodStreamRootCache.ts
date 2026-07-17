import type { ClodPageNode } from "../types.js";
import {
  buildBaseKeyParts,
  pageNodeSourceHash,
  type ClodCacheContext,
} from "./clodCacheContext.js";
import {
  decodeClodPageNodeArtifact,
  encodeClodPageNodeArtifact,
} from "./artifactSerializer.js";
import type { WorkerCacheBuildStats } from "./cacheMetrics.js";
import {
  clodPageNodeFromArtifact,
  clodPageNodeToArtifact,
} from "./clodPageNodeArtifact.js";
import { gpuClodHierarchyConfigFromWindow } from "../terrain/streaming/gpu_clod_hierarchy_config.js";
import {
  captureTerrainStreamingToken,
  type TerrainStreamingToken,
} from "../stream/terrain_streaming_control.js";

const STREAM_ROOT_SOURCE_SUFFIX = "stream-root-v5-gpu-resident-isolation";

export type StreamRootCacheBackend = "cpu" | "gpu";
export type StreamRootCacheStats = WorkerCacheBuildStats;

const streamingTokens = new WeakMap<object, TerrainStreamingToken>();
const activeRequestTokens = new Set<TerrainStreamingToken>();

function workerRealm(): boolean {
  return typeof window === "undefined"
    && typeof WorkerGlobalScope !== "undefined"
    && globalThis instanceof WorkerGlobalScope;
}

async function yieldWorkerStreamingState(): Promise<void> {
  if (!workerRealm()) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function beginStreamRootCacheOperation(): () => void {
  const token = captureTerrainStreamingToken();
  activeRequestTokens.add(token);
  return () => activeRequestTokens.delete(token);
}

export function createEmptyStreamRootCacheStats(): StreamRootCacheStats {
  const stats: StreamRootCacheStats = {
    nodesFromCache: 0,
    nodesBuilt: 0,
    cacheHits: 0,
    cacheMisses: 0,
    coldBuildMsAvoided: 0,
    cacheDecodeMs: 0,
    netSavedMs: 0,
    coldBuildMs: 0,
  };
  streamingTokens.set(stats, captureTerrainStreamingToken());
  return stats;
}

export function streamRootCacheOperationIsCurrent(stats: StreamRootCacheStats): boolean {
  const statsCurrent = streamingTokens.get(stats as object)?.isCurrent() ?? true;
  if (!statsCurrent) return false;
  for (const token of activeRequestTokens) if (!token.isCurrent()) return false;
  return true;
}

export async function tryLoadStreamRootNode(
  ctx: ClodCacheContext | null,
  backend: StreamRootCacheBackend,
  level: number,
  px: number,
  pz: number,
  stats: StreamRootCacheStats,
): Promise<ClodPageNode | null> {
  if (!ctx?.effective || residentHierarchyEnabled() || !streamRootCacheOperationIsCurrent(stats)) return null;
  const nodeId = streamRootNodeId(level, px, pz);
  const result = await ctx.service.get(
    streamRootKeyParts(ctx, backend, level, px, pz, nodeId),
    decodeClodPageNodeArtifact,
  );
  if (!streamRootCacheOperationIsCurrent(stats)) return null;

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
  return clodPageNodeFromArtifact(result.artifact);
}

export async function storeStreamRootNode(
  ctx: ClodCacheContext | null,
  backend: StreamRootCacheBackend,
  node: ClodPageNode,
  buildMs: number,
  stats: StreamRootCacheStats,
): Promise<void> {
  await yieldWorkerStreamingState();
  if (!ctx?.effective
    || residentHierarchyEnabled()
    || node.mesh.indices.length === 0
    || !streamRootCacheOperationIsCurrent(stats)) return;
  const parsed = parseStreamRootNodeId(node.id);
  const artifact = clodPageNodeToArtifact(node);
  if (!streamRootCacheOperationIsCurrent(stats)) return;
  await ctx.service.put(
    streamRootKeyParts(ctx, backend, parsed.level, parsed.pageX, parsed.pageZ, node.id),
    artifact,
    encodeClodPageNodeArtifact,
    {
      buildMs,
      triangleCount: node.mesh.indices.length / 3,
      worldMode: "infinite",
      hydrologyMode: "bounded-to-startup-world",
      backend,
    },
  );
  if (!streamRootCacheOperationIsCurrent(stats)) return;
  stats.nodesBuilt++;
  stats.coldBuildMs += buildMs;
}

export function publishStreamRootCacheCounters(
  stats: StreamRootCacheStats,
  backend: StreamRootCacheBackend,
): void {
  if (!streamRootCacheOperationIsCurrent(stats)) return;
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
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  counters[key] = (counters[key] ?? 0) + safeValue;
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

function residentHierarchyEnabled(): boolean {
  return gpuClodHierarchyConfigFromWindow().enabled;
}
