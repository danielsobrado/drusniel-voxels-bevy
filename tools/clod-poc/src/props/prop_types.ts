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

export type PropSnapGroup =
  | "prop-bottom"
  | "prop-top"
  | "prop-side"
  | "prop-door"
  | "prop-window"
  | "prop-roof"
  | "prop-foundation";

export type PropPivotMode = "original" | "bottom_center" | "bounds_center" | "front_bottom_center";

export interface PropSnapPoint {
  id: string;
  localPos: [number, number, number];
  direction: [number, number, number];
  group: PropSnapGroup;
  accepts: PropSnapGroup[];
}

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
  pivot?: PropPivotMode;
  snapPoints?: PropSnapPoint[];
}

export interface PropExternalCatalogRef {
  url: string;
  enabled: boolean;
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
  /** 0 means derive from the largest prop culling distance plus one cell. */
  ringRadiusM: number;
  /** Max dirty enter/leave/refresh cells rebuilt per frame. */
  cellUpdateBudgetPerFrame: number;
  /** Max instance matrix writes processed per frame. */
  matrixUploadBudgetPerFrame: number;
  /** Camera movement required before active prop cells are refreshed for LOD/shadow changes. */
  lodRefreshDistanceM: number;
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

export interface PropOcclusionSettings {
  enabled: boolean;
  cellSizeM: number;
  buildCellsPerFrame: number;
  footprintPaddingM: number;
  minimumHeightM: number;
  mistClipStrength: number;
}

export type PropGpuStatus = "disabled" | "unsupported" | "ring" | "fallback-cpu";

export interface PropGpuSettings {
  enabled: boolean;
  preferWebGpu: boolean;
  fallbackToCpu: boolean;
  debugForceCpu: boolean;
  maxVisible: number;
  workgroupSize: 32 | 64 | 128 | 256;
  debugShowGpuCounts: boolean;
}

export interface CustomPropsSettings {
  enabled: boolean;
  props: PropAssetDef[];
  externalCatalogs?: PropExternalCatalogRef[];
  spatial: PropSpatialSettings;
  culling: PropCullingSettings;
  shadows: PropShadowSettings;
  occlusion: PropOcclusionSettings;
  gpu: PropGpuSettings;
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
