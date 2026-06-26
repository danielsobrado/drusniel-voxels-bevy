import type { BuildProgress, BuildResult, NodeBuildStat } from "../clod/quadtree.js";
import { buildWorldAsync, type BuildCacheHooks } from "../clod/quadtree.js";
import type { ClodPagesConfig } from "../config.js";
import type { ClodPageNode } from "../types.js";
import {
  buildBaseKeyParts,
  pageNodeSourceHash,
  type ClodCacheContext,
} from "./clodCacheContext.js";
import {
  decodeClodPageNodeArtifact,
  encodeClodPageNodeArtifact,
  encodeClodPageTreeArtifact,
  type ClodPageNodeArtifact,
} from "./artifactSerializer.js";
import { decodeBuildStatFromMetadata, encodeBuildStatMetadata } from "./cacheBuildStatMetadata.js";
import type { WorkerCacheBuildStats } from "./cacheMetrics.js";
import { cacheLogger } from "./cacheLogger.js";

export type CachedBuildStats = WorkerCacheBuildStats;

function artifactToNode(artifact: ClodPageNodeArtifact, children: ClodPageNode[] = []): ClodPageNode {
  return {
    id: artifact.nodeId,
    level: artifact.level,
    children,
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

export function createBuildCacheHooks(ctx: ClodCacheContext, stats: CachedBuildStats): BuildCacheHooks {
  const sourceHash = () => pageNodeSourceHash(ctx);
  const cachedBuildStats = new Map<string, NodeBuildStat>();

  return {
    getCachedBuildStat(nodeId) {
      return cachedBuildStats.get(nodeId);
    },

    async tryLoadNode(nodeId, level, px, pz) {
      if (!ctx.effective) return null;
      const keyParts = buildBaseKeyParts(ctx, "clod-page-node", {
        pageX: px,
        pageZ: pz,
        lod: level,
        nodeId,
        sourceHash: sourceHash(),
      });
      const result = await ctx.service.get(keyParts, decodeClodPageNodeArtifact);
      if (result.status === "hit" && result.artifact) {
        const cachedBuildMs = typeof result.metadata?.buildMs === "number" ? result.metadata.buildMs : 0;
        const restoredStat = decodeBuildStatFromMetadata(nodeId, level, result.metadata);
        if (restoredStat) cachedBuildStats.set(nodeId, restoredStat);
        stats.nodesFromCache++;
        stats.cacheHits++;
        stats.cacheDecodeMs += result.decodeMs;
        stats.coldBuildMsAvoided += cachedBuildMs;
        stats.netSavedMs += Math.max(0, cachedBuildMs - result.decodeMs);
        return artifactToNode(result.artifact);
      }
      stats.cacheMisses++;
      return null;
    },

    async storeNode(node, stat) {
      if (!ctx.effective) return;
      stats.nodesBuilt++;
      stats.coldBuildMs += stat.buildMs;
      const { pageX, pageZ, lod } = parseNodeId(node.id);
      const keyParts = buildBaseKeyParts(ctx, "clod-page-node", {
        pageX,
        pageZ,
        lod,
        nodeId: node.id,
        sourceHash: sourceHash(),
      });
      void ctx.service.put(
        keyParts,
        nodeToArtifact(node),
        encodeClodPageNodeArtifact,
        {
          ...encodeBuildStatMetadata(stat),
          triangleCount: node.mesh.indices.length / 3,
        },
      );
    },

    async onBuildComplete(result) {
      if (!ctx.effective) return;
      const nodes: Array<{ id: string; level: number; childIds: (string | null)[] }> = [];
      for (const levelNodes of result.nodesByLevel.values()) {
        for (const node of levelNodes) {
          nodes.push({
            id: node.id,
            level: node.level,
            childIds: node.children.map((c) => c?.id ?? null),
          });
        }
      }
      const keyParts = buildBaseKeyParts(ctx, "clod-page-tree", {
        sourceHash: sourceHash(),
      });
      void ctx.service.put(
        keyParts,
        {
          worldPagesX: result.worldPagesX,
          worldPagesZ: result.worldPagesZ,
          levels: result.nodesByLevel.size,
          nodes,
        },
        encodeClodPageTreeArtifact,
        { nodeCount: nodes.length },
      );
      cacheLogger.info(
        `build complete: ${stats.nodesFromCache} from cache, ${stats.nodesBuilt} built, ` +
        `avoided ${stats.coldBuildMsAvoided.toFixed(1)} ms build, decode ${stats.cacheDecodeMs.toFixed(1)} ms, ` +
        `net saved ${stats.netSavedMs.toFixed(1)} ms`,
      );
    },
  };
}

function parseNodeId(nodeId: string): { pageX: number; pageZ: number; lod: number } {
  const match = /^L(\d+):(\d+),(\d+)$/.exec(nodeId);
  if (!match) throw new Error(`invalid node id ${nodeId}`);
  return { lod: Number(match[1]), pageX: Number(match[2]), pageZ: Number(match[3]) };
}

export async function buildWorldAsyncWithCache(
  worldPagesX: number,
  worldPagesZ: number,
  cfg: ClodPagesConfig,
  onProgress: (progress: BuildProgress) => void,
  cacheCtx: ClodCacheContext | null,
): Promise<{ result: BuildResult; cacheStats: CachedBuildStats }> {
  const cacheStats: CachedBuildStats = {
    nodesFromCache: 0,
    nodesBuilt: 0,
    cacheHits: 0,
    cacheMisses: 0,
    coldBuildMsAvoided: 0,
    cacheDecodeMs: 0,
    netSavedMs: 0,
    coldBuildMs: 0,
  };
  const hooks = cacheCtx ? createBuildCacheHooks(cacheCtx, cacheStats) : undefined;
  const result = await buildWorldAsync(worldPagesX, worldPagesZ, cfg, onProgress, hooks);
  if (cacheCtx) await cacheCtx.service.flush();
  return { result, cacheStats };
}
