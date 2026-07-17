export const SNAP_GROUPS = [
  "floor-edge",
  "wall-bottom",
  "wall-top",
  "wall-side",
  "roof-edge",
  "generic",
] as const;

export const CONSTRUCTION_MATERIALS = [
  "wood",
  "brick",
  "concrete",
  "marble",
  "tiles",
  "stone",
  "metal",
  "thatch",
] as const;

export const CONSTRUCTION_GEOMETRY_KINDS = ["box", "wedge", "stairs", "cylinder"] as const;

export type SnapGroup = typeof SNAP_GROUPS[number];
export type ConstructionCategory = "floor" | "wall" | "fence" | "pillar" | "roof" | "generic";
export type ConstructionMaterial = typeof CONSTRUCTION_MATERIALS[number];
export type ConstructionSupportState = "grounded" | "connected" | "unsupported";
export type ConstructionGeometryKind = typeof CONSTRUCTION_GEOMETRY_KINDS[number];
export type ConstructionVec3 = readonly [number, number, number];

export interface ConstructionSnapPoint {
  id: string;
  localPos: ConstructionVec3;
  direction: ConstructionVec3;
  tangent?: ConstructionVec3;
  allowedTwistDegrees?: readonly number[];
  group: SnapGroup;
  accepts: readonly SnapGroup[];
}

export interface ConstructionPlacementBox {
  center: ConstructionVec3;
  dimensionsM: ConstructionVec3;
  rotationYDegrees?: number;
}

export interface ConstructionPieceDef {
  id: string;
  label: string;
  category: ConstructionCategory;
  dimensionsM: ConstructionVec3;
  canGround: boolean;
  material: ConstructionMaterial;
  snapPoints: readonly ConstructionSnapPoint[];
  rotationStepDegrees?: number;
  geometryKind?: ConstructionGeometryKind;
  geometryYawDegrees?: number;
  placementBoxes?: readonly ConstructionPlacementBox[];
  groundNormalMinY?: number;
}

export interface ConstructionSnapConfig {
  radiusM: number;
  spatialCellM: number;
  minAlignment: number;
  alignmentWeight: number;
  distanceWeight: number;
  tangentWeight?: number;
  releaseRadiusMultiplier?: number;
  maxRayDistanceM?: number;
}

export interface ConstructionPlacementConfig {
  maxRayDistanceM: number;
  terrainStepM: number;
  overlapPaddingM: number;
  overlapSpatialCellM?: number;
  storageKey: string;
  unboundedWorld?: boolean;
  allowHeightfieldFallback?: boolean;
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
  position: ConstructionVec3;
  rotationQuarterTurns: number;
  material?: ConstructionMaterial;
  grounded?: boolean;
  parentIds?: readonly string[];
  unsupported?: boolean;
}

export interface ConstructionTerrainConformRequest {
  pieceId: string;
  position: ConstructionVec3;
  dimensionsM: ConstructionVec3;
  rotationQuarterTurns: number;
  materialSlot: number;
  padMarginM: number;
  fillDepthM: number;
  trimHeightM: number;
  falloffM: number;
}

export interface ConstructionSurfaceHit {
  point: ConstructionVec3;
  normal: ConstructionVec3;
  distanceM: number;
  surfaceType: "terrain" | "construction" | "prop";
  entityId?: string;
  pageId?: string;
}

export interface IndexedConstructionSnapPoint {
  entityId: string;
  pieceTypeId: string;
  snapIndex: number;
  worldPos: ConstructionVec3;
  worldDirection: ConstructionVec3;
  worldTangent?: ConstructionVec3;
  group: SnapGroup;
  accepts: readonly SnapGroup[];
}

export interface ConstructionSnapResult {
  target: IndexedConstructionSnapPoint;
  sourceSnapIndex: number;
  worldPosition: ConstructionVec3;
  rotationQuarterTurns: number;
  score: number;
  rayDistanceM?: number;
  key?: string;
}

export interface ConstructionCandidate {
  piece: ConstructionPieceDef;
  position: ConstructionVec3;
  rotationQuarterTurns: number;
  snapped: boolean;
  valid: boolean;
  reason: string | null;
  snap: ConstructionSnapResult | null;
  terrainHit?: ConstructionSurfaceHit | null;
  supportState?: ConstructionSupportState;
  supportParentIds?: readonly string[];
}
