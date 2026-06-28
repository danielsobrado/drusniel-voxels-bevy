import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { buildTerrainSummary, populateTerrainSummaryBiomes } from "../clod/terrain_summary.js";
import { getTerrainFieldCoreConfig } from "../gpu/terrain_field_core.js";
import type { ClodPageNode } from "../types.js";
import { ProceduralWorldSource, type WorldSource } from "../world_source/world_source.js";
import { buildBaseKeyParts, type ClodCacheContext } from "./clodCacheContext.js";
import {
  decodeTerrainSummaryArtifact,
  encodeTerrainSummaryArtifact,
  type TerrainSummaryArtifact,
} from "./artifactSerializer.js";

type TerrainSummaryWorldSource = Pick<WorldSource, "sampleHeight" | "sampleBiome">;

function resolveWorldSource(worldSource?: TerrainSummaryWorldSource): TerrainSummaryWorldSource {
  return worldSource ?? new ProceduralWorldSource(getTerrainFieldCoreConfig());
}

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

function withWorldSource(
  summary: TerrainSummaryField,
  worldSource: TerrainSummaryWorldSource,
): TerrainSummaryField {
  return populateTerrainSummaryBiomes(summary, worldSource);
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
  worldSource?: TerrainSummaryWorldSource,
): Promise<TerrainSummaryCacheResult> {
  const resolvedWorldSource = resolveWorldSource(worldSource);

  if (!cacheCtx?.effective) {
    return {
      summary: buildTerrainSummary(lod0Nodes, worldSize, farReduceFactor, { worldSource: resolvedWorldSource }),
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
      summary: withWorldSource(artifactToSummary(cached.artifact), resolvedWorldSource),
      fromCache: true,
      keptStale: false,
    };
  }

  const built = buildTerrainSummary(lod0Nodes, worldSize, farReduceFactor, { worldSource: resolvedWorldSource });
  await cacheCtx.service.put(
    keyParts,
    summaryToArtifact(built),
    encodeTerrainSummaryArtifact,
    { res: built.res, worldSize: built.worldSize },
  );

  if (previousSummary && cacheCtx.config.streaming.keep_stale_until_replacement) {
    return {
      summary: withWorldSource(previousSummary, resolvedWorldSource),
      fromCache: false,
      keptStale: true,
    };
  }

  return { summary: built, fromCache: false, keptStale: false };
}

export async function loadTerrainSummaryWithCacheSimple(
  lod0Nodes: readonly ClodPageNode[],
  worldSize: number,
  farReduceFactor: number,
  cacheCtx: ClodCacheContext | null,
  worldSource?: TerrainSummaryWorldSource,
): Promise<TerrainSummaryCacheResult> {
  const resolvedWorldSource = resolveWorldSource(worldSource);

  if (!cacheCtx?.effective) {
    return {
      summary: buildTerrainSummary(lod0Nodes, worldSize, farReduceFactor, { worldSource: resolvedWorldSource }),
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
      summary: withWorldSource(artifactToSummary(cached.artifact), resolvedWorldSource),
      fromCache: true,
      keptStale: false,
    };
  }

  const built = buildTerrainSummary(lod0Nodes, worldSize, farReduceFactor, { worldSource: resolvedWorldSource });
  await cacheCtx.service.put(
    keyParts,
    summaryToArtifact(built),
    encodeTerrainSummaryArtifact,
    { res: built.res, worldSize: built.worldSize },
  );
  return { summary: built, fromCache: false, keptStale: false };
}
