export { createConstructionController } from "./construction_controller.js";
export type { ConstructionController, ConstructionControllerDeps, ConstructionControllerStats } from "./construction_controller.js";
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
export { validateStrictPersistedConstructionPlacement } from "./persisted_placement.js";
export type { PersistedConstructionPlacementValidationInput } from "./persisted_placement.js";
export { buildPlacedPieceMap, hasGroundSupport, isPlacedPieceSupported, resolveConstructionPlacementSupport } from "./support_state.js";
export type { ConstructionSupportInput, ConstructionSupportResult } from "./support_state.js";
export type {
  ConstructionCandidate,
  ConstructionConfig,
  ConstructionGhostConfig,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionPlacementConfig,
  ConstructionSnapConfig,
  ConstructionSnapPoint,
  ConstructionSnapResult,
  ConstructionSupportState,
  ConstructionTerrainConformConfig,
  ConstructionTerrainConformRequest,
  IndexedConstructionSnapPoint,
  PlacedConstructionPiece,
  SnapGroup,
} from "./types.js";
