export { DEFAULT_FAR_SUMMARY_CONFIG, farSummaryRingForDistance } from "./config.js";
export type {
  FarSummaryConfig,
  FarSummaryRingConfig,
  FarSummaryStreamConfig,
  FarSummarySamplingConfig,
  FarSummaryDebugConfig,
} from "./config.js";

export type {
  FarSummaryTileState,
  FarSummarySample,
  FarSummaryTileKey,
  FarSummaryTile,
  FarSummaryStats,
} from "./types.js";

export {
  makeTileKey,
  tileKeyToString,
  tileKeyEquals,
  worldToTileCoord,
  tileOrigin,
  tileCenter,
} from "./tile-key.js";

export {
  updateStreamCenter,
} from "./stream-center.js";
export type { StreamCenter } from "./stream-center.js";

export {
  computeRequiredFarSummaryTiles,
  tileWorldBounds,
} from "./clipmap-rings.js";
export type { FarSummaryRingRequest } from "./clipmap-rings.js";

export {
  buildFarSummaryTile,
  computeNormalFiniteDifference,
} from "./summary-tile-builder.js";
export type { FarTerrainSampler, FarSummaryBuildInput } from "./summary-tile-builder.js";

export { FarSummaryCache } from "./summary-cache.js";

export { FarSummaryClipmapSampler } from "./clipmap-sampler.js";
export type { FarHeightProvider } from "./clipmap-sampler.js";

export { FarSummaryDebugOverlay } from "./debug-overlay.js";

export { createFarSummaryStats, resetFrameStats, accumulateStats } from "./stats.js";

export { initFarSummaryIntegration } from "./integration.js";
export type { FarSummaryIntegration, FarSummaryIntegrationOptions } from "./integration.js";
