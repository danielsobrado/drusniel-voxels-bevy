import type { ClodPagesConfig } from "../../config.js";
import type { ProjectSessionState } from "../../project/project_archive.js";
import { FAR_SHELL_DEFAULTS } from "../clod_constants.js";
import { assignArchiveFields } from "./archive_fields.js";

export interface ClodSliceState {
  clodPerfMode: boolean;
  webgpuSelection: boolean;
  materialTiers: boolean;
  thresholdPx: number;
  enforce21: boolean;
  freeze: boolean;
  wireframe: boolean;
  showBounds: boolean;
  showSeamPoints: boolean;
  showCrossLodBorders: boolean;
  showNodeLabels: boolean;
  showLockedBorderVertices: boolean;
  colorByLod: boolean;
  normalColor: boolean;
  normalDivergence: boolean;
  divergenceGain: number;
  frontSideOnly: boolean;
  recomputedNormals: boolean;
  forceMaxLevel: string;
  bubble: boolean;
  bubbleRadius: number;
  tintBubble: boolean;
  profileEnabled: boolean;
  farShellEnabled: boolean;
  farShellRadiusFactor: number;
  farShellHeightBias: number;
  farShellHeightDrop: number;

  longViewInfiniteShellEnabled: boolean;
  longViewInfiniteShellWireframe: boolean;
  longViewShowShellRings: boolean;
  longViewShowMissingSummaryFallback: boolean;
  longViewShowFarSummaryTiles: boolean;
  longViewFreezeStreamCenter: boolean;
  longViewForceMissingTiles: boolean;
  longViewRebuildBudget: number;
}

const CLOD_ARCHIVE_KEYS = [
  "thresholdPx", "enforce21", "freeze", "wireframe", "showBounds", "showSeamPoints",
  "showCrossLodBorders", "colorByLod", "normalColor", "normalDivergence", "divergenceGain",
  "frontSideOnly", "recomputedNormals", "forceMaxLevel", "bubble", "bubbleRadius", "tintBubble",
] as const satisfies readonly (keyof ProjectSessionState)[];

export function createClodSliceState(input: {
  cfg: ClodPagesConfig;
  queryPerfMode: boolean;
  queryWebGpuSelection: boolean;
  queryMaterialTiers: boolean;
  queryFarShell: boolean;
  isLongView: boolean;
  profileEnabled: boolean;
}): ClodSliceState {
  return {
    clodPerfMode: input.queryPerfMode,
    webgpuSelection: input.queryWebGpuSelection,
    materialTiers: input.queryMaterialTiers,
    thresholdPx: input.cfg.selection.error_threshold_px,
    enforce21: true,
    freeze: false,
    wireframe: false,
    showBounds: false,
    showSeamPoints: false,
    showCrossLodBorders: false,
    showNodeLabels: false,
    showLockedBorderVertices: false,
    colorByLod: input.queryPerfMode,
    normalColor: false,
    normalDivergence: false,
    divergenceGain: 8,
    frontSideOnly: false,
    recomputedNormals: false,
    forceMaxLevel: "auto",
    bubble: false,
    bubbleRadius: input.cfg.near_field.radius_chunks * input.cfg.page.chunk_size,
    tintBubble: true,
    profileEnabled: input.profileEnabled,
    farShellEnabled: FAR_SHELL_DEFAULTS.enabled,
    farShellRadiusFactor: FAR_SHELL_DEFAULTS.radiusFactor,
    farShellHeightBias: FAR_SHELL_DEFAULTS.heightBias,
    farShellHeightDrop: FAR_SHELL_DEFAULTS.heightDrop,

    longViewInfiniteShellEnabled: true,
    longViewInfiniteShellWireframe: false,
    longViewShowShellRings: false,
    longViewShowMissingSummaryFallback: false,
    longViewShowFarSummaryTiles: false,
    longViewFreezeStreamCenter: false,
    longViewForceMissingTiles: false,
    longViewRebuildBudget: 4,
  };
}

export function applyClodArchiveState(target: ClodSliceState, archive: ProjectSessionState): void {
  assignArchiveFields(target, archive, CLOD_ARCHIVE_KEYS);
}
