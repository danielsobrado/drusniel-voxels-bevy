import type { BuildProgress, BuildResult, NodeBuildStat } from "../clod/quadtree.js";
import { buildWorldAsync, type BuildCacheHooks } from "../clod/quadtree.js";
import type { ClodPagesConfig } from "../config.js";
import {
  buildBaseKeyParts,
  pageNodeSourceHash,
  type ClodCacheContext,
} from "./clodCacheContext.js";
import {
  decodeClodPageNodeArtifact,
  encodeClodPageNodeArtifact,
  encodeClodPageTreeArtifact,
} from "./artifactSerializer.js";
import { decodeBuildStatFromMetadata, encodeBuildStatMetadata } from "./cacheBuildStatMetadata.js";
import type { WorkerCacheBuildStats } from "./cacheMetrics.js";
import { cacheLogger } from "./cacheLogger.js";

import {
  clodPageNodeFromArtifact,
  clodPageNodeToArtifact,
} from "./clodPageNodeArtifact.js";

export type CachedBuildStats = WorkerCacheBuildStats;

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
        return clodPageNodeFromArtifact(result.artifact);
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
      await ctx.service.put(
        keyParts,
        clodPageNodeToArtifact(node),
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
      await ctx.service.put(
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
