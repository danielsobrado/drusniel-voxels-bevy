export const FRAME_PERF_BROAD_BUCKETS = [
  "frameSetupMs", "selectionUpdateMs", "longViewDiagnosticsMs", "farSummaryMs",
  "constructionMs", "brushMs", "combatMs", "spellsMs", "terrainPhaseMs",
  "shadowProxyMs", "clodShadowMs", "canopyMs", "vegetationTotalMs",
  "borderOceanDebugMs", "statsSyncMs", "renderMs", "unattributedMs",
] as const;

export const FRAME_PERF_PROP_BUCKETS = [
  "grassMs", "treesMs", "understoryMs", "forestLightingMs", "stonesMs",
  "customPropsMs", "waterMs", "deepOceanMs", "weatherMs",
  "propsRestMs", "propsUnattributedMs",
] as const;

export const FRAME_PERF_ALL_METRICS = [
  "frameMs", "selectionMs", "bubbleMs", "propsMs", "otherMs",
  ...FRAME_PERF_BROAD_BUCKETS,
  "selectionCutMs", "selectionBookMs", "selectionInfoMs", "selectionOverlaysMs",
  "vegetationTotalMs",
  ...FRAME_PERF_PROP_BUCKETS,
] as const;

export type FramePerfMetric = typeof FRAME_PERF_ALL_METRICS[number];
export type FramePerfBroadBucket = typeof FRAME_PERF_BROAD_BUCKETS[number];
export type FramePerfPropBucket = typeof FRAME_PERF_PROP_BUCKETS[number];
