export { createConstructionController } from "./construction_controller.js";
export type { ConstructionController, ConstructionControllerDeps, ConstructionControllerStats } from "./construction_controller.js";
export { defaultConstructionConfig, parseConstructionConfig, DEFAULT_CONSTRUCTION_SUPPORT_PROFILES } from "./config.js";
export { ConstructionSnapIndex, constructionSnapMath } from "./snap_index.js";
export type { ConstructionSnapQueryStats } from "./snap_index.js";
export { ConstructionSnapSelector } from "./construction_snap_selector.js";
export { ConstructionOverlapIndex } from "./overlap_index.js";
export type { ConstructionOverlapQueryStats } from "./overlap_index.js";
export { constructionPiecesOverlap, constructionObbMath } from "./construction_obb.js";
export { ConstructionPerformanceTracker } from "./construction_timing.js";
export type { ConstructionPerformanceSnapshot, ConstructionTimingSummary } from "./construction_timing.js";
export { createConstructionCandidate, createFreePlacementPosition, validateConstructionPlacement } from "./placement.js";
export { raycastConstructionTerrain } from "./targeting.js";
export { ConstructionColliderSet } from "./construction_collider.js";
export { ConstructionSupportGraph } from "./construction_support_graph.js";
export { ConstructionStabilityRuntime } from "./construction_stability_runtime.js";
export type { ConstructionStabilityRuntimeStats, ConstructionStabilityRecomputeResult, ConstructionCollapseStepResult } from "./construction_stability_runtime.js";
export {
  constructionConnectionIsVertical,
  constructionStabilityColorHex,
  constructionSupportProfile,
  placedConstructionStability,
  predictConstructionStability,
  propagatedConstructionSupport,
  shouldCollapseConstruction,
  solveConstructionStability,
} from "./construction_stability.js";
export type { ConstructionStabilityNode, ConstructionStabilitySolveResult, PredictConstructionStabilityInput } from "./construction_stability.js";
export { findConstructionConnectionIds } from "./construction_connections.js";
export { reevaluateConstructionSupport } from "./support_reevaluation.js";
export type { ConstructionGroundSolidProbe, ConstructionSupportAabb, ConstructionSupportReevaluationInput, ConstructionSupportReevaluationResult } from "./support_reevaluation.js";
export { validateStrictPersistedConstructionPlacement } from "./persisted_placement.js";
export type { PersistedConstructionPlacementValidationInput } from "./persisted_placement.js";
export { buildPlacedPieceMap, hasGroundSupport, isPlacedPieceSupported, resolveConstructionPlacementSupport } from "./support_state.js";
export type { ConstructionSupportInput, ConstructionSupportResult } from "./support_state.js";
export {
  analyzeConstructionTerrainSamples,
  constructionTerrainSamplePositions,
  createConstructionTerrainConformRequest,
  invalidConstructionTerrainPreview,
} from "./construction_terrain_conform.js";
export { getActiveConstructionTerrainConformHandler, setActiveConstructionTerrainConformHandler } from "./construction_terrain_registry.js";
export type {
  ConstructionCandidate,
  ConstructionConfig,
  ConstructionGeometryKind,
  ConstructionGeometryPart,
  ConstructionGhostConfig,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionPlacementBox,
  ConstructionPlacementConfig,
  ConstructionSnapConfig,
  ConstructionSnapPoint,
  ConstructionSnapResult,
  ConstructionStabilityConfig,
  ConstructionSupportClass,
  ConstructionSupportProfile,
  ConstructionSupportProfiles,
  ConstructionSurfaceHit,
  ConstructionSupportState,
  ConstructionTerrainAabb,
  ConstructionTerrainConformCommitResult,
  ConstructionTerrainConformConfig,
  ConstructionTerrainConformHandler,
  ConstructionTerrainConformPreview,
  ConstructionTerrainConformReceipt,
  ConstructionTerrainConformRequest,
  ConstructionTerrainConformSample,
  ConstructionTerrainConformUndoResult,
  ConstructionTerrainFootprint,
  IndexedConstructionSnapPoint,
  PlacedConstructionPiece,
  SnapGroup,
} from "./types.js";
