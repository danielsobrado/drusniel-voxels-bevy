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
export const CONSTRUCTION_SUPPORT_CLASSES = ["wood", "stone", "ground"] as const;

export type SnapGroup = typeof SNAP_GROUPS[number];
export type ConstructionCategory =
  | "floor"
  | "wall"
  | "opening"
  | "fence"
  | "pillar"
  | "beam"
  | "stairs"
  | "roof"
  | "foundation"
  | "generic";
export type ConstructionMaterial = typeof CONSTRUCTION_MATERIALS[number];
export type ConstructionSupportState = "grounded" | "connected" | "unsupported";
export type ConstructionGeometryKind = typeof CONSTRUCTION_GEOMETRY_KINDS[number];
export type ConstructionSupportClass = typeof CONSTRUCTION_SUPPORT_CLASSES[number];
export type ConstructionVec3 = readonly [number, number, number];

export interface ConstructionSupportProfile {
  maxSupport: number;
  verticalDecay: number;
  horizontalDecay: number;
  supportClass: ConstructionSupportClass;
}

export type ConstructionSupportProfiles = Readonly<Record<ConstructionMaterial, ConstructionSupportProfile>>;

export interface ConstructionStabilityConfig {
  collapseThreshold: number;
  epsilon: number;
  maxIslandSize: number;
  maxCollapsesPerFrame: number;
  connectionToleranceM: number;
  verticalConnectionMinRatio: number;
}

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

export interface ConstructionGeometryPart {
  kind: ConstructionGeometryKind;
  center: ConstructionVec3;
  dimensionsM: ConstructionVec3;
  rotationDegrees?: ConstructionVec3;
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
  geometryParts?: readonly ConstructionGeometryPart[];
  placementBoxes?: readonly ConstructionPlacementBox[];
  groundNormalMinY?: number;
  supportProfile?: ConstructionSupportProfile;
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
  stability: ConstructionStabilityConfig;
  supportProfiles: ConstructionSupportProfiles;
  pieces: readonly ConstructionPieceDef[];
}

export interface PlacedConstructionPiece {
  id: string;
  typeId: string;
  position: ConstructionVec3;
  rotationQuarterTurns: number;
  material?: ConstructionMaterial;
  grounded?: boolean;
  connectionIds?: readonly string[];
  /** Legacy v1 directed support metadata. Read during migration only. */
  parentIds?: readonly string[];
  stability?: number;
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
  material: ConstructionMaterial;
  position: ConstructionVec3;
  rotationQuarterTurns: number;
  snapped: boolean;
  valid: boolean;
  reason: string | null;
  snap: ConstructionSnapResult | null;
  terrainHit?: ConstructionSurfaceHit | null;
  supportState: ConstructionSupportState;
  connectionIds: readonly string[];
  stabilityValue: number;
  stabilityMaxSupport: number;
  stabilityGrounded: boolean;
}
