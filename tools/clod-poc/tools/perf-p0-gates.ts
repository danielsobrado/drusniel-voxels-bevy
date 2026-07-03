export type P0PerfGateStatus = "passed" | "failed";

export interface P0PerfGateCaseLike {
  name: string;
  status: string;
  metrics: Record<string, number | null | undefined>;
}

export interface P0PerfGateResult {
  name: string;
  status: P0PerfGateStatus;
  detail: string;
}

export interface P0PerfGateSummary {
  status: P0PerfGateStatus;
  failedCount: number;
  results: P0PerfGateResult[];
}

const REQUIRED_CASES = [
  "terrain-material-cache-disabled",
  "terrain-material-cache-enabled",
  "gpu-early-reject-disabled",
  "gpu-early-reject-enabled",
  "gpu-early-reject-enabled-with-debug-oracle",
  "combined-cache-and-early-reject-enabled",
] as const;

const FAR_SUMMARY_SOURCE_COUNTERS = [
  "vegetationGpuSourceFarSummary",
  "treeGpuPrefilterSourceFarSummaryAvg",
  "grassGpuPrefilterSourceFarSummaryAvg",
  "understoryGpuPrefilterSourceFarSummaryAvg",
] as const;

const P0_DIRTY_ATLAS_STATUS_DONE = 3;

export function evaluateP0PerfGates(cases: readonly P0PerfGateCaseLike[]): P0PerfGateSummary {
  const byName = new Map(cases.map((perfCase) => [perfCase.name, perfCase]));
  const results = [
    gateRequiredCases(byName),
    gateCasesPassed(cases),
    gateP0DirtyAtlasExerciseCompleted(byName),
    gateMaterialCacheEvidence(byName),
    gateVegetationEarlyRejectEvidence(byName),
    gateFarSummarySourceEvidence(byName),
    gateAtlasPackingEvidence(byName),
    gateAtlasDirtyUploadEvidence(byName),
  ];
  const failedCount = results.filter((result) => result.status === "failed").length;
  return {
    status: failedCount === 0 ? "passed" : "failed",
    failedCount,
    results,
  };
}

function gateRequiredCases(byName: ReadonlyMap<string, P0PerfGateCaseLike>): P0PerfGateResult {
  const missing = REQUIRED_CASES.filter((name) => !byName.has(name));
  return gate(
    "required-cases-present",
    missing.length === 0,
    missing.length === 0 ? "all required P0 cases are present" : `missing cases: ${missing.join(", ")}`,
  );
}

function gateCasesPassed(cases: readonly P0PerfGateCaseLike[]): P0PerfGateResult {
  const failed = cases.filter((perfCase) => perfCase.status !== "passed").map((perfCase) => perfCase.name);
  return gate(
    "cases-passed",
    failed.length === 0,
    failed.length === 0 ? "all collected cases passed" : `failed cases: ${failed.join(", ")}`,
  );
}

function gateP0DirtyAtlasExerciseCompleted(byName: ReadonlyMap<string, P0PerfGateCaseLike>): P0PerfGateResult {
  const cases = [...byName.values()];
  const enabledCases = cases.filter((perfCase) => metric(perfCase, "p0DirtyAtlasExercise.enabled") === 1);
  const completed = enabledCases.filter((perfCase) => {
    const status = metric(perfCase, "p0DirtyAtlasExercise.status");
    const moveM = metric(perfCase, "p0DirtyAtlasExercise.moveM");
    const triggeredFrame = metric(perfCase, "p0DirtyAtlasExercise.triggeredFrame");
    const resetFrame = metric(perfCase, "p0DirtyAtlasExercise.resetFrame");
    return status === P0_DIRTY_ATLAS_STATUS_DONE && positive(moveM) && finite(triggeredFrame) && finite(resetFrame) && resetFrame >= triggeredFrame;
  });
  const skipped = enabledCases.filter((perfCase) => metric(perfCase, "p0DirtyAtlasExercise.status") === 4).map((perfCase) => perfCase.name);
  const bestMove = completed.reduce((max, perfCase) => Math.max(max, metric(perfCase, "p0DirtyAtlasExercise.moveM") ?? 0), 0);
  return gate(
    "p0-dirty-atlas-exercise-completed",
    enabledCases.length > 0 && completed.length > 0 && skipped.length === 0,
    enabledCases.length > 0 && completed.length > 0 && skipped.length === 0
      ? `dirty atlas exercise completed cases=${completed.length}/${enabledCases.length} bestMoveM=${formatMetric(bestMove)}`
      : `dirty atlas exercise incomplete enabled=${enabledCases.length} completed=${completed.length} skipped=${skipped.join(", ") || "-"}`,
  );
}

function gateMaterialCacheEvidence(byName: ReadonlyMap<string, P0PerfGateCaseLike>): P0PerfGateResult {
  const enabled = byName.get("terrain-material-cache-enabled");
  if (!enabled) return gate("terrain-material-cache-evidence", false, "missing terrain-material-cache-enabled case");
  const hits = metric(enabled, "terrainMaterialCacheHits");
  const ready = metric(enabled, "terrainMaterialCacheReady");
  const stale = metric(enabled, "terrainMaterialCacheStale");
  const hasEvidence = positive(hits) || positive(ready) || positive(stale);
  return gate(
    "terrain-material-cache-evidence",
    hasEvidence,
    hasEvidence
      ? `cache evidence hits=${formatMetric(hits)} ready=${formatMetric(ready)} stale=${formatMetric(stale)}`
      : "cache enabled case did not expose hits, ready entries, or stale entries",
  );
}

function gateVegetationEarlyRejectEvidence(byName: ReadonlyMap<string, P0PerfGateCaseLike>): P0PerfGateResult {
  const enabled = byName.get("gpu-early-reject-enabled");
  if (!enabled) return gate("vegetation-early-reject-evidence", false, "missing gpu-early-reject-enabled case");
  const before = metric(enabled, "vegetationGpuCandidatesBudgetBeforeReject");
  const after = metric(enabled, "vegetationGpuCandidatesBudgetAfterReject");
  const rejected = metric(enabled, "vegetationGpuClustersRejectedEarly");
  const reduced = finite(before) && finite(after) && after <= before && before > after;
  const hasEvidence = reduced || positive(rejected);
  return gate(
    "vegetation-early-reject-evidence",
    hasEvidence,
    hasEvidence
      ? `early reject evidence before=${formatMetric(before)} after=${formatMetric(after)} rejectedClusters=${formatMetric(rejected)}`
      : `no early reject evidence before=${formatMetric(before)} after=${formatMetric(after)} rejectedClusters=${formatMetric(rejected)}`,
  );
}

function gateFarSummarySourceEvidence(byName: ReadonlyMap<string, P0PerfGateCaseLike>): P0PerfGateResult {
  const enabledCases = [
    byName.get("gpu-early-reject-enabled"),
    byName.get("gpu-early-reject-enabled-with-debug-oracle"),
    byName.get("combined-cache-and-early-reject-enabled"),
  ].filter((perfCase): perfCase is P0PerfGateCaseLike => !!perfCase);
  const farSummaryUses = enabledCases.reduce((sum, perfCase) => (
    sum + FAR_SUMMARY_SOURCE_COUNTERS.reduce((inner, key) => inner + (metric(perfCase, key) ?? 0), 0)
  ), 0);
  const fallbackUses = enabledCases.reduce((sum, perfCase) => sum + (metric(perfCase, "vegetationGpuSourceFallback") ?? 0), 0);
  return gate(
    "far-summary-source-evidence",
    farSummaryUses > 0,
    farSummaryUses > 0
      ? `far-summary source used=${formatMetric(farSummaryUses)} fallback=${formatMetric(fallbackUses)}`
      : "early-reject enabled cases did not expose far-summary source usage",
  );
}

function gateAtlasPackingEvidence(byName: ReadonlyMap<string, P0PerfGateCaseLike>): P0PerfGateResult {
  const cases = [...byName.values()];
  const savings = cases.map((perfCase) => metric(perfCase, "naadf.farSummaryAtlas.memorySavingsPct")).filter(finite);
  const bestSavings = savings.length > 0 ? Math.max(...savings) : null;
  return gate(
    "far-summary-atlas-packing-evidence",
    bestSavings !== null && bestSavings > 0,
    bestSavings !== null && bestSavings > 0
      ? `atlas packing savings detected bestSavingsPct=${formatMetric(bestSavings)}`
      : "atlas packing memory savings metric missing or zero",
  );
}

function gateAtlasDirtyUploadEvidence(byName: ReadonlyMap<string, P0PerfGateCaseLike>): P0PerfGateResult {
  const cases = [...byName.values()];
  const best = cases.reduce<AtlasDirtyUploadEvidence | null>((current, perfCase) => {
    const evidence = atlasDirtyUploadEvidence(perfCase);
    if (!evidence) return current;
    if (!current) return evidence;
    return evidence.dirtyPixels > current.dirtyPixels ? evidence : current;
  }, null);
  return gate(
    "far-summary-atlas-dirty-upload-evidence",
    best !== null,
    best
      ? `dirty upload evidence case=${best.caseName} dirtyUploads=${formatMetric(best.dirtyUploads)} dirtyPixels=${formatMetric(best.dirtyPixels)} totalPixels=${formatMetric(best.totalPixels)} dirtyPct=${formatMetric(best.dirtyPct)}`
      : "no dirty atlas upload evidence; expected dirty uploads with dirtyPixels < totalPixels and mode=dirty",
  );
}

interface AtlasDirtyUploadEvidence {
  caseName: string;
  dirtyUploads: number;
  dirtyPixels: number;
  totalPixels: number;
  dirtyPct: number;
}

function atlasDirtyUploadEvidence(perfCase: P0PerfGateCaseLike): AtlasDirtyUploadEvidence | null {
  const dirtyUploads = metric(perfCase, "naadf.farSummaryAtlas.upload.dirtyUploads");
  const dirtyPixels = metric(perfCase, "naadf.farSummaryAtlas.upload.dirtyPixels");
  const totalPixels = metric(perfCase, "naadf.farSummaryAtlas.upload.totalPixels");
  const dirtyPct = metric(perfCase, "naadf.farSummaryAtlas.upload.dirtyPct");
  const modeCode = metric(perfCase, "naadf.farSummaryAtlas.upload.modeCode");
  if (!positive(dirtyUploads) || !positive(dirtyPixels) || !positive(totalPixels)) return null;
  if (dirtyPixels >= totalPixels) return null;
  if (modeCode !== null && modeCode !== 1) return null;
  return { caseName: perfCase.name, dirtyUploads, dirtyPixels, totalPixels, dirtyPct: dirtyPct ?? dirtyPixels / totalPixels };
}

function gate(name: string, passed: boolean, detail: string): P0PerfGateResult {
  return { name, status: passed ? "passed" : "failed", detail };
}

function metric(perfCase: P0PerfGateCaseLike, name: string): number | null {
  const value = perfCase.metrics[name];
  return finite(value) ? value : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: number | null): boolean {
  return value !== null && value > 0;
}

function formatMetric(value: number | null): string {
  if (value === null) return "-";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  return value.toFixed(2);
}
