export type {
  LongViewSunShadowsConfig,
  ShadowProxyConfig,
  ShadowProxyCoverage,
  ShadowProxyRuntime,
  ShadowProxyShadowSide,
  ShadowProxySource,
  ShadowProxyStats,
} from "./shadowProxyTypes.js";
export {
  applyShadowProxyDebugQueryOverrides,
  applyShadowProxySceneOverrides,
  cloneLongViewSunShadowsConfig,
  cloneShadowProxyConfig,
  DEFAULT_SHADOW_PROXY_CONFIG,
  parseLongViewSunShadowsConfig,
} from "./shadowProxyConfig.js";
export { DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG } from "../config/longViewDefaults.js";
export { buildShadowProxyGeometry } from "./shadowProxyGeometry.js";
export { buildShadowProxyMesh, updateShadowProxyDebugMaterial } from "./shadowProxyBuilder.js";
export { createShadowProxyMaterial, applyShadowProxyMaterialFlags } from "./shadowProxyMaterial.js";
export {
  validateShadowProxyConfig,
  validateTerrainSummarySource,
  computeShadowProxyCoverage,
  clampProxyHeight,
  ringFadeWeight,
  sampleProxyHeight,
} from "./shadowProxyValidation.js";
export {
  createEmptyShadowProxyStats,
  formatShadowProxyStatsLine,
  shadowProxyStatsToCounters,
} from "./shadowProxyStats.js";
export {
  configureLongViewSunShadows,
  createLongViewSunLight,
  enableRendererShadowMaps,
  syncLongViewSunLight,
} from "./longViewSunShadows.js";
export { isStreamingLongViewScene } from "./longViewScene.js";
export { createShadowProxyController, type ShadowProxyController } from "./shadowProxyController.js";
export {
  createShadowProxyDebugState,
  shadowProxyDebugStateToConfig,
  type ShadowProxyDebugState,
} from "./shadowProxyDebug.js";
