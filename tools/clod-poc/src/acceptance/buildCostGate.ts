import type { BuildStats } from "../clod/stats.js";
import type { ClodPageNode } from "../types.js";
import type { AcceptanceGateResult, AcceptanceConfig, AcceptanceFailure } from "./acceptanceTypes.js";

export interface BuildTimingMetrics {
  fullHierarchyBuildMs: number;
  fullHierarchyBuildRuns: number;
  fullHierarchyWarmupRuns: number;
  fullHierarchyMeasuredRuns: number;
  fullHierarchyBuildMsMin: number;
  fullHierarchyBuildMsP50: number;
  fullHierarchyBuildMsP95: number;
  singleNodeRebuildMeasured: boolean;
  singleNodeRebuildMsMin: number;
  singleNodeRebuildMsP50: number;
  singleNodeRebuildMsP95: number;
  weldMsP95: number;
  simplifyMsP95: number;
  validationMsP95: number;
  slowestNodes: SlowNodeInfo[];
}

export interface SlowNodeInfo {
  id: string;
  level: number;
  inputTriangles: number;
  outputTriangles: number;
  weldMs: number;
  simplifyMs: number;
  validateMs: number;
  lowBenefit: boolean;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function runFullHierarchyBuild(
  buildFn: () => { stats: BuildStats },
  warmRuns: number,
  measuredRuns: number,
): { timings: number[]; allStats: BuildStats[] } {
  for (let i = 0; i < warmRuns; i++) buildFn();

  const timings: number[] = [];
  const allStats: BuildStats[] = [];
  for (let i = 0; i < measuredRuns; i++) {
    const t0 = performance.now();
    const result = buildFn();
    timings.push(performance.now() - t0);
    allStats.push(result.stats);
  }
  return { timings, allStats };
}

export function measureBuildTimingsFromStats(stats: BuildStats): BuildTimingMetrics {
  const allMs = stats.levels.flatMap((l) => {
    if (l.level === 0) return [];
    return [l.averageBuildMs * l.nodeCount];
  });

  const totalBuildMs = stats.totalBuildMs;

  const maxLevel = Math.max(...stats.levels.map((l) => l.level));

  const rebuildMs = stats.levels
    .filter((l) => l.level > 0 && l.level < maxLevel)
    .flatMap((l) => {
      const perNodeSamples = Math.max(1, Math.floor(l.nodeCount / 2));
      return Array(perNodeSamples).fill(l.averageBuildMs);
    });

  const fallbackRebuildMs = rebuildMs.length === 0
    ? stats.levels.filter((l) => l.level > 0).flatMap((l) => {
        const perNodeSamples = Math.max(1, Math.floor(l.nodeCount / 2));
        return Array(perNodeSamples).fill(l.averageBuildMs);
      })
    : rebuildMs;

  return {
    fullHierarchyBuildMs: totalBuildMs,
    fullHierarchyBuildRuns: 1,
    fullHierarchyWarmupRuns: 0,
    fullHierarchyMeasuredRuns: 1,
    fullHierarchyBuildMsMin: allMs.length > 0 ? Math.min(...allMs) : 0,
    fullHierarchyBuildMsP50: percentile(allMs, 50),
    fullHierarchyBuildMsP95: percentile(allMs, 95),
    singleNodeRebuildMeasured: false,
    singleNodeRebuildMsMin: fallbackRebuildMs.length > 0 ? Math.min(...fallbackRebuildMs) : 0,
    singleNodeRebuildMsP50: percentile(fallbackRebuildMs, 50),
    singleNodeRebuildMsP95: percentile(fallbackRebuildMs, 95),
    weldMsP95: 0,
    simplifyMsP95: 0,
    validationMsP95: 0,
    slowestNodes: [],
  };
}

export function runGateA5(
  _nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  buildMetrics: BuildTimingMetrics,
  _fixtureName: string,
): AcceptanceGateResult {
  const thresholds = config.thresholds;
  const failures: AcceptanceFailure[] = [];
  const requireMeasured = thresholds.requireMeasuredSingleNodeRebuild;

  const fullOk = buildMetrics.fullHierarchyBuildMsP50 <= thresholds.fullHierarchyBuildMsMax;
  if (!fullOk) {
    failures.push({
      code: "FULL_HIERARCHY_BUILD_TOO_SLOW",
      message: `Full hierarchy build p50 ${buildMetrics.fullHierarchyBuildMsP50.toFixed(1)}ms exceeds max ${thresholds.fullHierarchyBuildMsMax}ms`,
      value: buildMetrics.fullHierarchyBuildMsP50,
      threshold: thresholds.fullHierarchyBuildMsMax,
    });
  }

  if (!buildMetrics.singleNodeRebuildMeasured) {
    if (!failures.some((f) => f.code === "SINGLE_NODE_REBUILD_ESTIMATED")) {
      failures.push({
        code: "SINGLE_NODE_REBUILD_ESTIMATED",
        message: `Single node rebuild times are estimated from per-level averages (p95 ${buildMetrics.singleNodeRebuildMsP95.toFixed(1)}ms). Not directly measured — add isolated node rebuild sampling for accurate metrics.`,
        value: buildMetrics.singleNodeRebuildMsP95,
        threshold: thresholds.singleNodeRebuildMsMax,
      });
    }

    if (requireMeasured) {
      failures.push({
        code: "SINGLE_NODE_REBUILD_NOT_MEASURED",
        message: "Single node rebuild times are estimated, not measured. Set require_measured_single_node_rebuild to false or implement direct sampling.",
        value: 0,
        threshold: 1,
      });
    }
  } else {
    const singleOk = buildMetrics.singleNodeRebuildMsP95 <= thresholds.singleNodeRebuildMsMax;
    if (!singleOk) {
      failures.push({
        code: "SINGLE_NODE_REBUILD_TOO_SLOW",
        message: `Single node rebuild p95 ${buildMetrics.singleNodeRebuildMsP95.toFixed(1)}ms exceeds max ${thresholds.singleNodeRebuildMsMax}ms`,
        value: buildMetrics.singleNodeRebuildMsP95,
        threshold: thresholds.singleNodeRebuildMsMax,
      });
    }
  }

  let status: "pass" | "warn" | "fail";
  if (failures.some((f) => f.code === "FULL_HIERARCHY_BUILD_TOO_SLOW")) {
    status = "fail";
  } else if (failures.some((f) => f.code === "SINGLE_NODE_REBUILD_NOT_MEASURED")) {
    status = "fail";
  } else if (failures.some((f) => f.code === "SINGLE_NODE_REBUILD_ESTIMATED")) {
    status = "warn";
  } else if (failures.some((f) => f.code === "SINGLE_NODE_REBUILD_TOO_SLOW")) {
    status = "fail";
  } else {
    status = "pass";
  }

  const message = status === "pass"
    ? `Full build p50 ${buildMetrics.fullHierarchyBuildMsP50.toFixed(0)}ms, single rebuild p95 ${buildMetrics.singleNodeRebuildMsP95.toFixed(1)}ms`
    : status === "warn"
      ? `Build cost acceptable but single-node data is estimated (${buildMetrics.singleNodeRebuildMsP95.toFixed(1)}ms p95)`
      : `Build cost exceeds thresholds`;

  return {
    id: "A5",
    name: "Build cost",
    status,
    message,
    measurements: {
      fullHierarchyBuildMs: buildMetrics.fullHierarchyBuildMs,
      fullHierarchyBuildRuns: buildMetrics.fullHierarchyBuildRuns,
      fullHierarchyWarmupRuns: buildMetrics.fullHierarchyWarmupRuns,
      fullHierarchyMeasuredRuns: buildMetrics.fullHierarchyMeasuredRuns,
      fullHierarchyBuildMsMin: buildMetrics.fullHierarchyBuildMsMin,
      fullHierarchyBuildMsP50: buildMetrics.fullHierarchyBuildMsP50,
      fullHierarchyBuildMsP95: buildMetrics.fullHierarchyBuildMsP95,
      singleNodeRebuildMeasured: buildMetrics.singleNodeRebuildMeasured,
      singleNodeRebuildMsMin: buildMetrics.singleNodeRebuildMsMin,
      singleNodeRebuildMsP50: buildMetrics.singleNodeRebuildMsP50,
      singleNodeRebuildMsP95: buildMetrics.singleNodeRebuildMsP95,
      fullHierarchyBuildMsMax: thresholds.fullHierarchyBuildMsMax,
      singleNodeRebuildMsMax: thresholds.singleNodeRebuildMsMax,
      requireMeasuredSingleNodeRebuild: requireMeasured,
    },
    failures,
  };
}
