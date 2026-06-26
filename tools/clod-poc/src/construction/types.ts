export const SNAP_GROUPS = [
  "floor-edge",
  "wall-bottom",
  "wall-top",
  "wall-side",
  "roof-edge",
  "generic",
] as const;

export type SnapGroup = typeof SNAP_GROUPS[number];
export type ConstructionCategory = "floor" | "wall" | "fence" | "pillar" | "roof" | "generic";
export type ConstructionMaterial = "wood" | "stone" | "metal" | "thatch";
export type ConstructionSupportState = "grounded" | "connected" | "unsupported";

export interface ConstructionSnapPoint {
  id: string;
  localPos: readonly [number, number, number];
  direction: readonly [number, number, number];
  group: SnapGroup;
  accepts: readonly SnapGroup[];
}

export interface ConstructionPieceDef {
  id: string;
  label: string;
  category: ConstructionCategory;
  dimensionsM: readonly [number, number, number];
  canGround: boolean;
  material: ConstructionMaterial;
  snapPoints: readonly ConstructionSnapPoint[];
}

export interface ConstructionSnapConfig {
  radiusM: number;
  spatialCellM: number;
  minAlignment: number;
  alignmentWeight: number;
  distanceWeight: number;
}

export interface ConstructionPlacementConfig {
  maxRayDistanceM: number;
  terrainStepM: number;
  overlapPaddingM: number;
  storageKey: string;
}

export interface ConstructionGhostConfig {
  opacity: number;
}

export interface ConstructionTerrainConformConfig {
  enabled: boolean;
  foundationCategories: readonly ConstructionCategory[];
  padMarginM: number;
  fillDepthM: number;
  trimHeightM: number;
  falloffM: number;
  materialSlot: number;
}

export interface ConstructionConfig {
  enabled: boolean;
  snap: ConstructionSnapConfig;
  placement: ConstructionPlacementConfig;
  ghost: ConstructionGhostConfig;
  terrainConform: ConstructionTerrainConformConfig;
  pieces: readonly ConstructionPieceDef[];
}

export interface PlacedConstructionPiece {
  id: string;
  typeId: string;
  position: readonly [number, number, number];
  rotationQuarterTurns: number;
  grounded?: boolean;
  parentIds?: readonly string[];
}

export interface ConstructionTerrainConformRequest {
  pieceId: string;
  position: readonly [number, number, number];
  dimensionsM: readonly [number, number, number];
  rotationQuarterTurns: number;
  materialSlot: number;
  padMarginM: number;
  fillDepthM: number;
  trimHeightM: number;
  falloffM: number;
}

export interface IndexedConstructionSnapPoint {
  entityId: string;
  pieceTypeId: string;
  snapIndex: number;
  worldPos: readonly [number, number, number];
  worldDirection: readonly [number, number, number];
  group: SnapGroup;
  accepts: readonly SnapGroup[];
}

export interface ConstructionSnapResult {
  target: IndexedConstructionSnapPoint;
  sourceSnapIndex: number;
  worldPosition: readonly [number, number, number];
  rotationQuarterTurns: number;
  score: number;
}

export interface ConstructionCandidate {
  piece: ConstructionPieceDef;
  position: readonly [number, number, number];
  rotationQuarterTurns: number;
  snapped: boolean;
  valid: boolean;
  reason: string | null;
  snap: ConstructionSnapResult | null;
  supportState?: ConstructionSupportState;
  supportParentIds?: readonly string[];
}
