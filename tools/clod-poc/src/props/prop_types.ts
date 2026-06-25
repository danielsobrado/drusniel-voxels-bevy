export type PropCategory =
  | "small_decor"
  | "medium_static"
  | "large_static"
  | "vegetation"
  | "interactive";

export type PropLodMode = "provided" | "generated";

export type CollisionMode = "none" | "box" | "convex" | "trimesh_near_only";

export type LightingProxyMode = "none" | "coarse_bounds";

export type PropLodAvailability = "none" | "provided" | "generated";

export interface PropPlacementRules {
  alignToTerrain: boolean;
  terrainConform: boolean;
  snapToGrid: boolean;
  flattenRadius?: number;
  slopeLimitDegrees?: number;
}

export interface PropLodPolicy {
  mode: PropLodMode;
  distances: number[];
  triangleRatios: number[];
  billboardFrom?: number;
  hysteresis: number;
}

export interface PropCullingPolicy {
  maxDistance: number;
  shadowDistance: number;
  reflectionDistance: number;
  minScreenPx: number;
}

export interface PropCollisionPolicy {
  mode: CollisionMode;
  distance: number;
}

export interface PropLightingProxy {
  mode: LightingProxyMode;
  affectGi: boolean;
  affectFog: boolean;
}

export interface PropAssetDef {
  id: string;
  source: string;
  category: PropCategory;
  placement: PropPlacementRules;
  lod: PropLodPolicy;
  culling: PropCullingPolicy;
  collision: PropCollisionPolicy;
  lightingProxy?: PropLightingProxy;
}

export interface PropCategoryBudget {
  maxTriangles: number;
  maxMaterials: number;
  maxDrawParts: number;
  maxTexturePx: number;
}

export interface PropSpatialSettings {
  cellSizeM: number;
  maxInstancesPerCellWarning: number;
  farCellUpdateIntervalFrames: number;
}

export interface PropCullingSettings {
  cellFrustumCulling: boolean;
  cellDistanceCulling: boolean;
  perInstanceFrustumCullingForLargeProps: boolean;
  perInstanceCullingMinRadius: number;
  farUpdateIntervalFrames: number;
  hysteresisM: number;
}

export interface PropDebugSettings {
  showCells: boolean;
  showBounds: boolean;
  lodColorOverlay: boolean;
  billboardOverlay: boolean;
}

export interface PropShadowSettings {
  maxShadowProps: number;
}

export interface CustomPropsSettings {
  enabled: boolean;
  props: PropAssetDef[];
  spatial: PropSpatialSettings;
  culling: PropCullingSettings;
  shadows: PropShadowSettings;
  categoryBudgets: Record<PropCategory, PropCategoryBudget>;
  debug: PropDebugSettings;
}

export interface PropBoundsSnapshot {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  radius: number;
}

export interface PropAssetMetadata {
  id: string;
  sourcePath: string;
  meshCount: number;
  materialCount: number;
  localBounds: PropBoundsSnapshot;
  boundingSphereRadius: number;
  triangleCount: number;
  hasAlphaMaterial: boolean;
  hasAnimation: boolean;
  hasCollisionMesh: boolean;
  lodAvailability: PropLodAvailability;
  drawCallParts: number;
  maxTextureSize: number;
  hasNormals: boolean;
  scaleUniform: boolean;
}

export interface PropValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface PropValidationReport {
  ok: boolean;
  errors: PropValidationIssue[];
  warnings: PropValidationIssue[];
}

export interface PropInstance {
  assetId: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  seed: number;
  variationId: number;
  cellCoord?: [number, number];
  flags: number;
  revision: number;
}

export interface PropPlacementScene {
  schemaVersion: number;
  sceneId: string;
  instances: PropInstance[];
}

export interface PropSpatialCell {
  cellCoord: [number, number];
  bounds: PropBoundsSnapshot;
  propInstanceIndices: number[];
  visibleThisFrame: boolean;
}
