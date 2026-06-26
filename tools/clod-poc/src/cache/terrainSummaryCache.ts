import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";
import type { ClodPageNode } from "../types.js";
import { buildBaseKeyParts, type ClodCacheContext } from "./clodCacheContext.js";
import {
  decodeTerrainSummaryArtifact,
  encodeTerrainSummaryArtifact,
  type TerrainSummaryArtifact,
} from "./artifactSerializer.js";

function summaryToArtifact(field: TerrainSummaryField): TerrainSummaryArtifact {
  return {
    res: field.res,
    worldSize: field.worldSize,
    farReduceFactor: field.farReduceFactor,
    heightMin: field.heightMin,
    heightMax: field.heightMax,
    normalX: field.normalX,
    normalY: field.normalY,
    normalZ: field.normalZ,
    coverage: field.coverage,
  };
}

function artifactToSummary(artifact: TerrainSummaryArtifact): TerrainSummaryField {
  return {
    res: artifact.res,
    worldSize: artifact.worldSize,
    farReduceFactor: artifact.farReduceFactor,
    heightMin: artifact.heightMin,
    heightMax: artifact.heightMax,
    normalX: artifact.normalX,
    normalY: artifact.normalY,
    normalZ: artifact.normalZ,
    coverage: artifact.coverage,
  };
}

export interface TerrainSummaryCacheResult {
  summary: TerrainSummaryField;
  fromCache: boolean;
  keptStale: boolean;
}

export async function loadTerrainSummaryWithCache(
  lod0Nodes: readonly ClodPageNode[],
  worldSize: number,
  farReduceFactor: number,
  cacheCtx: ClodCacheContext | null,
  previousSummary: TerrainSummaryField | null,
): Promise<TerrainSummaryCacheResult> {
  if (!cacheCtx?.effective) {
    return {
      summary: buildTerrainSummary(lod0Nodes, worldSize, farReduceFactor),
      fromCache: false,
      keptStale: false,
    };
  }

  const keyParts = buildBaseKeyParts(cacheCtx, "terrain-summary", {
    sourceHash: cacheCtx.terrainSourceHash,
  });
  const cached = await cacheCtx.service.get(keyParts, decodeTerrainSummaryArtifact);

  if (cached.status === "hit" && cached.artifact) {
    return {
      summary: artifactToSummary(cached.artifact),
      fromCache: true,
      keptStale: false,
    };
  }

  const built = buildTerrainSummary(lod0Nodes, worldSize, farReduceFactor);

  if (previousSummary && cacheCtx.config.streaming.keep_stale_until_replacement) {
    void cacheCtx.service.put(
      keyParts,
      summaryToArtifact(built),
      encodeTerrainSummaryArtifact,
      { res: built.res, worldSize: built.worldSize },
    ).then(() => {
      // replacement ready asynchronously; caller may swap on next frame if needed
    });
    return {
      summary: previousSummary,
      fromCache: false,
      keptStale: true,
    };
  }

  void cacheCtx.service.put(
    keyParts,
    summaryToArtifact(built),
    encodeTerrainSummaryArtifact,
    { res: built.res, worldSize: built.worldSize },
  );
  return { summary: built, fromCache: false, keptStale: false };
}

export async function loadTerrainSummaryWithCacheSimple(
  lod0Nodes: readonly ClodPageNode[],
  worldSize: number,
  farReduceFactor: number,
  cacheCtx: ClodCacheContext | null,
): Promise<TerrainSummaryCacheResult> {
  if (!cacheCtx?.effective) {
    return {
      summary: buildTerrainSummary(lod0Nodes, worldSize, farReduceFactor),
      fromCache: false,
      keptStale: false,
    };
  }

  const keyParts = buildBaseKeyParts(cacheCtx, "terrain-summary", {
    sourceHash: cacheCtx.terrainSourceHash,
  });
  const cached = await cacheCtx.service.get(keyParts, decodeTerrainSummaryArtifact);
  if (cached.status === "hit" && cached.artifact) {
    return {
      summary: artifactToSummary(cached.artifact),
      fromCache: true,
      keptStale: false,
    };
  }

  const built = buildTerrainSummary(lod0Nodes, worldSize, farReduceFactor);
  void cacheCtx.service.put(
    keyParts,
    summaryToArtifact(built),
    encodeTerrainSummaryArtifact,
    { res: built.res, worldSize: built.worldSize },
  );
  return { summary: built, fromCache: false, keptStale: false };
}
