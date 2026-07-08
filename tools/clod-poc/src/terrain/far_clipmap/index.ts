export {
  DEFAULT_FAR_CLIPMAP_CONFIG,
  farClipmapConfigFromSearchParams,
  resolveFarClipmapConfig,
} from "./far_clipmap_config.js";
export type {
  FarClipmapConfig,
  FarClipmapConfigConstraints,
  FarClipmapDebugMode,
} from "./far_clipmap_config.js";

export {
  farClipmapRingCellSize,
  farClipmapRingRange,
  farClipmapSnap,
  farClipmapTileKey,
  farClipmapTileKeysForSnap,
  snapFarClipmapCoord,
} from "./far_clipmap_keys.js";
export type { FarClipmapRingRange, FarClipmapSnap } from "./far_clipmap_keys.js";

export {
  createFarClipmapGridGeometry,
  createFarClipmapTerrainGeometry,
} from "./far_clipmap_geometry.js";
export type {
  FarClipmapGridGeometryOptions,
  FarClipmapTerrainGeometryOptions,
} from "./far_clipmap_geometry.js";

export {
  createConservativeFarClipmapSource,
  createDefaultFarClipmapSource,
  createFarClipmapSourceFromFarHeightProvider,
  createFarClipmapSourceFromProviderGetter,
  createFarClipmapSourceFromTerrainSampler,
} from "./far_clipmap_source.js";
export type { FarClipmapSource } from "./far_clipmap_source.js";

export {
  createFarClipmapMaterial,
  farClipmapDebugModeCode,
  farClipmapMaterialDisplacementMode,
  setFarClipmapMaterialDebugMode,
  updateFarClipmapMaterialFrameUniforms,
  updateFarClipmapMaterialSourceTexture,
} from "./far_clipmap_material.js";
export type {
  FarClipmapDisplacementMode,
  FarClipmapMaterial,
  FarClipmapMaterialUniforms,
  FarClipmapSourceTextureStats,
} from "./far_clipmap_material.js";

export { createFarClipmapController } from "./far_clipmap_controller.js";
export type {
  FarClipmapController,
  FarClipmapOwnershipSnapshot,
  FarClipmapStats,
} from "./far_clipmap_controller.js";

export { publishFarClipmapStatsToCounters } from "./far_clipmap_counters.js";
