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

const STREAM_ROOT_SOURCE_SUFFIX = "stream-root-v1-world-infinite-hydrology-bounded";

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
  level: number,
  px: number,
  pz: number,
  stats: StreamRootCacheStats,
): Promise<ClodPageNode | null> {
  if (!ctx?.effective) return null;
  const nodeId = streamRootNodeId(level, px, pz);
  const result = await ctx.service.get(
    streamRootKeyParts(ctx, level, px, pz, nodeId),
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
  node: ClodPageNode,
  buildMs: number,
  stats: StreamRootCacheStats,
): Promise<void> {
  if (!ctx?.effective) return;
  const parsed = parseStreamRootNodeId(node.id);
  stats.nodesBuilt++;
  stats.coldBuildMs += buildMs;
  await ctx.service.put(
    streamRootKeyParts(ctx, parsed.level, parsed.pageX, parsed.pageZ, node.id),
    nodeToArtifact(node),
    encodeClodPageNodeArtifact,
    {
      buildMs,
      triangleCount: node.mesh.indices.length / 3,
      worldMode: "infinite",
      hydrologyMode: "bounded-to-startup-world",
    },
  );
}

function streamRootKeyParts(
  ctx: ClodCacheContext,
  level: number,
  px: number,
  pz: number,
  nodeId: string,
) {
  const sourceHash = streamRootSourceHash(ctx);
  return buildBaseKeyParts(ctx, "clod-stream-root-node", {
    pageX: px,
    pageZ: pz,
    lod: level,
    nodeId,
    sourceHash,
  });
}

function streamRootSourceHash(ctx: ClodCacheContext): string {
  return `${pageNodeSourceHash(ctx)}-${STREAM_ROOT_SOURCE_SUFFIX}`;
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
