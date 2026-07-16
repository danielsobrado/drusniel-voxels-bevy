import type { ConstructionCandidate, ConstructionTerrainConformConfig, ConstructionTerrainConformRequest } from "./types.js";

export function createConstructionTerrainConformRequest(
  candidate: ConstructionCandidate,
  config: ConstructionTerrainConformConfig,
): ConstructionTerrainConformRequest | null {
  if (!config.enabled || !config.foundationCategories.includes(candidate.piece.category)) return null;
  return {
    pieceId: candidate.piece.id,
    position: candidate.position,
    dimensionsM: candidate.piece.dimensionsM,
    rotationQuarterTurns: candidate.rotationQuarterTurns,
    materialSlot: config.materialSlot,
    padMarginM: config.padMarginM,
    fillDepthM: config.fillDepthM,
    trimHeightM: config.trimHeightM,
    falloffM: config.falloffM,
  };
}
