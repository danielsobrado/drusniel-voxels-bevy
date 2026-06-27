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
