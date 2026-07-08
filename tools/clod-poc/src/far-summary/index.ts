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

export {
  DEFAULT_FAR_SUMMARY_GPU_CONFIG,
  farSummaryGpuConfigFromParams,
  farSummaryGpuConfigFromWindow,
  farSummaryGpuFallbackDecision,
} from "./gpu-config.js";
export type { FarSummaryGpuConfig, FarSummaryGpuFallbackDecision, FarSummaryGpuFallbackReason } from "./gpu-config.js";

export {
  planFarSummaryGpuDirtyTiles,
  buildFarSummaryGpuPlan,
  splitFarSummaryGpuBatches,
  estimateFarSummaryGpuBatchBytes,
  farSummaryGpuTileBounds,
} from "./gpu-planner.js";
export type {
  FarSummaryGpuDirtyReason,
  FarSummaryGpuDirtyTile,
  FarSummaryGpuBatch,
  FarSummaryGpuPlan,
} from "./gpu-planner.js";

export {
  createFarSummaryGpuCounters,
  publishFarSummaryGpuCounters,
} from "./gpu-counters.js";
export type { FarSummaryGpuCounters } from "./gpu-counters.js";

export { composeFarSummaryGpuBuildShader } from "./gpu-shader.js";

export {
  createFarSummaryGpuBuilder,
  dispatchFarSummaryGpuPlanOrFallback,
  disabledFarSummaryGpuCounters,
} from "./gpu-builder.js";
export type {
  FarSummaryGpuBuilder,
  FarSummaryGpuDebugReadback,
  FarSummaryGpuDispatchResult,
  FarSummaryGpuDispatchOrFallbackResult,
} from "./gpu-builder.js";

export {
  decodeFarSummaryGpuRecord,
  decodeFarSummaryGpuRecords,
  compareFarSummaryGpuRecordToCpu,
} from "./gpu-records.js";
export type {
  FarSummaryGpuRecord,
  FarSummaryGpuParityTolerances,
  FarSummaryGpuParityMismatch,
  FarSummaryGpuParityResult,
} from "./gpu-records.js";

export {
  evaluateFarSummaryGpuDebugReadbackParity,
  shouldEvaluateFarSummaryGpuStrictParity,
  applyFarSummaryGpuParityEvaluationToCounters,
} from "./gpu-parity.js";
export type {
  FarSummaryGpuParityEvaluation,
  FarSummaryGpuParityInput,
  FarSummaryGpuParityReadback,
  FarSummaryGpuParitySkipReason,
  FarSummaryGpuTileParityFailure,
} from "./gpu-parity.js";

export {
  FarSummaryGpuRuntime,
  createFarSummaryGpuRuntimeFromParams,
} from "./gpu-runtime.js";
export type {
  FarSummaryGpuRuntimeOptions,
  FarSummaryGpuRuntimeDispatchInput,
  FarSummaryGpuRuntimeStats,
} from "./gpu-runtime.js";
