import { FRAME_PERF_FAR_SUMMARY_BUCKETS } from "./far_summary_subphase_timing.js";

export { FRAME_PERF_FAR_SUMMARY_BUCKETS } from "./far_summary_subphase_timing.js";

export const FRAME_PERF_BROAD_BUCKETS = [
  "frameSetupMs", "inputMs", "selectionUpdateMs", "clodApplyMs", "longViewDiagnosticsMs", "farSummaryMs",
  "constructionMs", "brushMs", "combatMs", "spellsMs", "terrainPhaseMs",
  "shadowProxyMs", "clodShadowMs", "canopyMs", "vegetationTotalMs",
  "borderOceanDebugMs", "statsSyncMs", "renderMs", "unattributedMs",
] as const;

export const FRAME_PERF_PROP_BUCKETS = [
  "grassMs", "treesMs", "understoryMs", "forestLightingMs", "stonesMs",
  "customPropsMs", "waterMs", "deepOceanMs", "weatherMs",
  "propsRestMs", "propsUnattributedMs",
] as const;

export const FRAME_PERF_MATERIAL_CHURN_BUCKETS = [
  "materialChurnNewMaterials",
  "materialChurnAssignments",
  "materialChurnNeedsUpdate",
  "materialChurnVersionChanges",
  "materialChurnPipelineSensitiveChanges",
  "materialChurnRendererProgramCount",
  "materialChurnRendererProgramDelta",
  "materialChurnSuspectedPipelineKeyChanges",
] as const;

export const FRAME_PERF_SELECTION_SUBPHASE_BUCKETS = [
  "selectionCutMs",
  "selectionBookMs",
  "selectionInfoMs",
  "selectionOverlaysMs",
  "selectionSub.cut",
  "selectionSub.book",
  "selectionSub.info",
  "selectionSub.overlays",
] as const;

export const FRAME_PERF_ALL_METRICS = [
  "frameMs", "selectionMs", "bubbleMs", "propsMs", "otherMs",
  ...FRAME_PERF_BROAD_BUCKETS,
  ...FRAME_PERF_FAR_SUMMARY_BUCKETS,
  ...FRAME_PERF_SELECTION_SUBPHASE_BUCKETS,
  ...FRAME_PERF_PROP_BUCKETS,
  ...FRAME_PERF_MATERIAL_CHURN_BUCKETS,
] as const;

export type FramePerfMetric = typeof FRAME_PERF_ALL_METRICS[number];
export type FramePerfBroadBucket = typeof FRAME_PERF_BROAD_BUCKETS[number];
export type FramePerfPropBucket = typeof FRAME_PERF_PROP_BUCKETS[number];
