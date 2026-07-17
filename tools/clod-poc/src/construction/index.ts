export { createConstructionController } from "./construction_controller.js";
export type { ConstructionController, ConstructionControllerDeps, ConstructionControllerStats } from "./construction_controller.js";
export { defaultConstructionConfig, parseConstructionConfig } from "./config.js";
export { ConstructionSnapIndex, constructionSnapMath } from "./snap_index.js";
export type { ConstructionSnapQueryStats } from "./snap_index.js";
export { ConstructionSnapSelector } from "./construction_snap_selector.js";
export { ConstructionOverlapIndex } from "./overlap_index.js";
export type { ConstructionOverlapQueryStats } from "./overlap_index.js";
export { constructionPiecesOverlap, constructionObbMath } from "./construction_obb.js";
export { ConstructionPerformanceTracker } from "./construction_timing.js";
export type { ConstructionPerformanceSnapshot, ConstructionTimingSummary } from "./construction_timing.js";
export {
  createConstructionCandidate,
  createFreePlacementPosition,
  validateConstructionPlacement,
} from "./placement.js";
export { raycastConstructionTerrain } from "./targeting.js";
export { ConstructionColliderSet } from "./construction_collider.js";
export { reevaluateConstructionSupport } from "./support_reevaluation.js";
export type {
  ConstructionGroundSolidProbe,
  ConstructionSupportAabb,
  ConstructionSupportReevaluationInput,
  ConstructionSupportReevaluationResult,
} from "./support_reevaluation.js";
export { validateStrictPersistedConstructionPlacement } from "./persisted_placement.js";
export type { PersistedConstructionPlacementValidationInput } from "./persisted_placement.js";
export { buildPlacedPieceMap, hasGroundSupport, isPlacedPieceSupported, resolveConstructionPlacementSupport } from "./support_state.js";
export type { ConstructionSupportInput, ConstructionSupportResult } from "./support_state.js";
export type {
  ConstructionCandidate,
  ConstructionConfig,
  ConstructionGeometryKind,
  ConstructionGhostConfig,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionPlacementBox,
  ConstructionPlacementConfig,
  ConstructionSnapConfig,
  ConstructionSnapPoint,
  ConstructionSnapResult,
  ConstructionSurfaceHit,
  ConstructionSupportState,
  ConstructionTerrainConformConfig,
  ConstructionTerrainConformRequest,
  IndexedConstructionSnapPoint,
  PlacedConstructionPiece,
  SnapGroup,
} from "./types.js";
