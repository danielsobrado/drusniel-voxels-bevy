export { DEFAULT_LONG_VIEW_CONFIG, createDefaultLongViewConfig, longViewConfigToFarSummaryConfig } from "./longViewConfig.js";
export type { LongViewConfig } from "./longViewConfig.js";

export { sampleMacroTerrainHeight, sampleMacroTerrainNormal, sampleMacroTerrainMaterial } from "./macroTerrain.js";

export { sampleBlendedHeightNormalMaterial } from "./farSummarySampler.js";
export type { HeightNormalMaterial, FarSummarySamplerOptions } from "./farSummarySampler.js";

export { createFarShellMetrics, resetFrameShellMetrics, exposeMetricsOnWindow, getExposedMetrics, publishFarShellMetricsToCounters } from "./farShellMetrics.js";
export type { FarShellMetrics } from "./farShellMetrics.js";

export { InfiniteFarShell, createInfiniteFarShell } from "./infiniteFarShell.js";
export type { FarShellHeightSamplingMode, InfiniteFarShellOptions, SnappedCenter } from "./infiniteFarShell.js";

export { createInfiniteFarShellMaterial, updateFarShellMaterialMaterial } from "./infiniteFarShellMaterial.js";
export type { InfiniteFarShellMaterialOptions } from "./infiniteFarShellMaterial.js";
