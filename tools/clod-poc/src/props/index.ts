export type {
  CollisionMode,
  CustomPropsSettings,
  LightingProxyMode,
  PropAssetDef,
  PropAssetMetadata,
  PropBoundsSnapshot,
  PropCategory,
  PropCategoryBudget,
  PropCollisionPolicy,
  PropCullingPolicy,
  PropCullingSettings,
  PropDebugSettings,
  PropInstance,
  PropLightingProxy,
  PropLodAvailability,
  PropLodMode,
  PropLodPolicy,
  PropPlacementRules,
  PropPlacementScene,
  PropSpatialCell,
  PropShadowSettings,
  PropValidationIssue,
  PropValidationReport,
} from "./prop_types.js";

export {
  DEFAULT_CUSTOM_PROPS_SETTINGS,
  PROP_CATEGORIES,
  parseCustomPropsConfig,
  propDefById,
} from "./prop_config.js";

export { assignPropCellCoords, parsePropPlacements, resolvePropPlacementScene } from "./prop_placements.js";

export {
  propCastsShadow,
  propDistanceToCamera,
  propInReflection,
  propLodErrorPx,
  propNeedsCollider,
  selectPropLodIndex,
  type PropLodSelectionParams,
} from "./prop_lod.js";

export { extractPropAssetMetadata } from "./prop_asset_metadata.js";

export {
  validateCustomPropsManifest,
  validatePropAssetDef,
  validatePropAssetMetadata,
} from "./prop_asset_validate.js";

export { PropAssetRegistry, type LoadedPropAsset } from "./prop_asset_loader.js";

export { buildPropLodChain, type PropLodChain, type PropLodLevel } from "./prop_lod_build.js";
export { initPropSimplifier, simplifyPropMesh, bufferGeometryToPropMesh } from "./prop_mesh_simplify.js";
export { PropSpatialGrid } from "./prop_spatial_grid.js";
export { cullPropSpatialGrid } from "./prop_culling.js";
export { PropDebugOverlay } from "./prop_debug.js";
export { PropSystem } from "./prop_system.js";
export { PropColliderSet, type PropColliderInstanceInput } from "./prop_collider.js";
export { validatePropShotStats, type PropAcceptanceConfig } from "./prop_acceptance.js";
export { EMPTY_PROP_STATS, syncPropStatsToHooks, type PropStats } from "./prop_stats.js";
