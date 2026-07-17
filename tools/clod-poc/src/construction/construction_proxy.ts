import type { ConstructionPieceDef, ConstructionPlacementBox } from "./types.js";

const DEFAULT_CENTER = [0, 0, 0] as const;

export function constructionPlacementBoxes(piece: ConstructionPieceDef): readonly ConstructionPlacementBox[] {
  if (piece.placementBoxes && piece.placementBoxes.length > 0) return piece.placementBoxes;
  return [{
    center: DEFAULT_CENTER,
    dimensionsM: piece.dimensionsM,
    rotationYDegrees: piece.geometryYawDegrees ?? 0,
  }];
}
