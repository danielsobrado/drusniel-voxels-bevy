export { createConstructionController } from "./construction_controller.js";
export type {
  ConstructionController,
  ConstructionControllerDeps,
  ConstructionControllerStats,
  ConstructionSupportAabb,
} from "./construction_controller.js";
export { defaultConstructionConfig, parseConstructionConfig } from "./config.js";
export { ConstructionSnapIndex, constructionSnapMath } from "./snap_index.js";
export type { ConstructionSnapQueryStats } from "./snap_index.js";
export { ConstructionOverlapIndex } from "./overlap_index.js";
export type { ConstructionOverlapQueryStats } from "./overlap_index.js";
export { ConstructionPerformanceTracker } from "./construction_timing.js";
export type { ConstructionPerformanceSnapshot, ConstructionTimingSummary } from "./construction_timing.js";
export {
  createConstructionCandidate,
  createFreePlacementPosition,
  validateConstructionPlacement,
} from "./placement.js";
export { ConstructionColliderSet } from "./construction_collider.js";
export { ConstructionSupportGraph } from "./construction_support_graph.js";
export type { ConstructionSupportIsland } from "./construction_support_graph.js";
export { ConstructionStabilityRuntime } from "./construction_stability_runtime.js";
export type { ConstructionStabilityRuntimeStats } from "./construction_stability_runtime.js";
export {
  constructionConnectionKind,
  predictConstructionStability,
  propagatedConstructionSupport,
  shouldConstructionCollapse,
  solveConstructionStabilityIsland,
} from "./construction_stability.js";
export type {
  ConstructionStabilityNode,
  ConstructionStabilitySolveResult,
} from "./construction_stability.js";
export { findConstructionConnectionIds } from "./construction_connections.js";
export {
  isConstructionPieceGrounded,
  refreshConstructionGrounding,
} from "./construction_grounding.js";
export type {
  ConstructionGroundingAabb,
  ConstructionGroundSolidProbe,
} from "./construction_grounding.js";
export { validatePersistedConstructionGeometry, validateStrictPersistedConstructionPlacement } from "./persisted_placement.js";
export type { PersistedConstructionPlacementValidationInput } from "./persisted_placement.js";
export { buildPlacedPieceMap, hasGroundSupport, isPlacedPieceSupported, resolveConstructionPlacementSupport } from "./support_state.js";
export type { ConstructionSupportInput, ConstructionSupportResult } from "./support_state.js";
export { reevaluateConstructionSupport } from "./support_reevaluation.js";
export type {
  ConstructionGroundSolidProbe as LegacyConstructionGroundSolidProbe,
  ConstructionSupportReevaluationInput,
  ConstructionSupportReevaluationResult,
} from "./support_reevaluation.js";
export type {
  ConstructionCandidate,
  ConstructionConfig,
  ConstructionConnectionKind,
  ConstructionGhostConfig,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionPlacementConfig,
  ConstructionSnapConfig,
  ConstructionSnapPoint,
  ConstructionSnapResult,
  ConstructionStabilityConfig,
  ConstructionStabilityPrediction,
  ConstructionSupportClass,
  ConstructionSupportProfile,
  ConstructionSupportState,
  ConstructionTerrainConformConfig,
  ConstructionTerrainConformRequest,
  IndexedConstructionSnapPoint,
  PlacedConstructionPiece,
  SnapGroup,
} from "./types.js";
