import type { BuildProgress, BuildResult } from "../clod/quadtree.js";
import { buildWorldAsync, type BuildCacheHooks } from "../clod/quadtree.js";
import type { ClodPagesConfig } from "../config.js";
import type { ClodPageNode } from "../types.js";
import {
  buildBaseKeyParts,
  buildPageNodeSourceHash,
  type ClodCacheContext,
} from "./clodCacheContext.js";
import {
  decodeClodPageNodeArtifact,
  encodeClodPageNodeArtifact,
  decodeClodPageTreeArtifact,
  encodeClodPageTreeArtifact,
  type ClodPageNodeArtifact,
} from "./artifactSerializer.js";
import { cacheLogger } from "./cacheLogger.js";

export interface CachedBuildStats {
  nodesFromCache: number;
  nodesBuilt: number;
  cacheHits: number;
  cacheMisses: number;
  buildMsSaved: number;
  coldBuildMs: number;
}

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
  return {
    async tryLoadNode(nodeId, level, px, pz) {
      if (!ctx.effective) return null;
      const sourceHash = await buildPageNodeSourceHash(ctx, px, pz, level);
      const keyParts = buildBaseKeyParts(ctx, "clod-page-node", {
        pageX: px,
        pageZ: pz,
        lod: level,
        nodeId,
        sourceHash,
      });
      const result = await ctx.service.get(keyParts, decodeClodPageNodeArtifact);
      if (result.status === "hit" && result.artifact) {
        stats.nodesFromCache++;
        stats.cacheHits++;
        stats.buildMsSaved += result.decodeMs;
        return artifactToNode(result.artifact);
      }
      stats.cacheMisses++;
      return null;
    },

    async storeNode(node, buildMs) {
      if (!ctx.effective) return;
      stats.nodesBuilt++;
      stats.coldBuildMs += buildMs;
      const { pageX, pageZ, lod } = parseNodeId(node.id);
      const sourceHash = await buildPageNodeSourceHash(ctx, pageX, pageZ, lod);
      const keyParts = buildBaseKeyParts(ctx, "clod-page-node", {
        pageX,
        pageZ,
        lod,
        nodeId: node.id,
        sourceHash,
      });
      void ctx.service.put(
        keyParts,
        nodeToArtifact(node),
        encodeClodPageNodeArtifact,
        { buildMs, triangleCount: node.mesh.indices.length / 3 },
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
        sourceHash: ctx.sourceRevision,
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
        `build complete: ${stats.nodesFromCache} from cache, ${stats.nodesBuilt} built, saved ~${stats.buildMsSaved.toFixed(1)} ms decode`,
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
    buildMsSaved: 0,
    coldBuildMs: 0,
  };
  const hooks = cacheCtx ? createBuildCacheHooks(cacheCtx, cacheStats) : undefined;
  const result = await buildWorldAsync(worldPagesX, worldPagesZ, cfg, onProgress, hooks);
  if (cacheCtx) {
    await cacheCtx.service.flush();
    const metrics = cacheCtx.service.getMetrics();
    metrics.nodesLoadedFromCache = cacheStats.nodesFromCache;
    metrics.buildMsSaved = cacheStats.buildMsSaved;
    metrics.coldBuildMs = cacheStats.coldBuildMs;
  }
  return { result, cacheStats };
}

export { decodeClodPageTreeArtifact };
