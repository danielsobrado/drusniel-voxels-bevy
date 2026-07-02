import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AcceptanceConfig, AcceptanceGateResult, AcceptanceMetrics } from "./acceptanceTypes.js";
import type { BuildTimingMetrics } from "./buildCostGate.js";
import { computeTriangleReduction, computeLowBenefitRates } from "./index.js";
import { defineScreenshots, writeVisualSweepUnavailable } from "./screenshots.js";

function worstStatus(a: "pass" | "warn" | "fail", b: "pass" | "warn" | "fail"): "pass" | "warn" | "fail" {
  const order: Record<string, number> = { pass: 0, warn: 1, fail: 2 };
  return order[a] >= order[b] ? a : b;
}

function mergeGateResults(current: AcceptanceGateResult, next: AcceptanceGateResult): AcceptanceGateResult {
  const mergedStatus = worstStatus(current.status, next.status);
  const mergedFailures = [...current.failures, ...next.failures];
  const mergedMeasurements = { ...current.measurements };

  for (const [key, val] of Object.entries(next.measurements)) {
    if (typeof val === "number" && typeof mergedMeasurements[key] === "number") {
      if (key.startsWith("max") || key.includes("Max") || key.includes("P95") || key.includes("P50")) {
        mergedMeasurements[key] = Math.max(mergedMeasurements[key] as number, val);
      } else if (key.startsWith("min") || key.includes("Min")) {
        mergedMeasurements[key] = Math.min(mergedMeasurements[key] as number, val);
      } else if (key === "failureCount" || key === "sameLevelFailureCount" || key === "mixedLodFailureCount") {
        mergedMeasurements[key] = (mergedMeasurements[key] as number) + val;
      } else if (key === "sameLevelEdgesTested" || key === "mixedLodEdgesTested") {
        mergedMeasurements[key] = (mergedMeasurements[key] as number) + val;
      }
    } else if (typeof val === "boolean") {
      if (key === "singleNodeRebuildMeasured") {
        mergedMeasurements[key] = mergedMeasurements[key] || val;
      }
    } else {
      mergedMeasurements[key] = val;
    }
  }

  return {
    id: current.id,
    name: current.name,
    status: mergedStatus,
    message: current.message,
    measurements: mergedMeasurements,
    failures: mergedFailures,
  };
}

function percentileFromSamples(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function numericMeasurement(gate: AcceptanceGateResult | undefined, key: string, fallback = 0): number {
  const value = gate?.measurements[key];
  return typeof value === "number" ? value : fallback;
}

export function mergeGatesAcrossScenes(
  perSceneGates: Map<string, AcceptanceGateResult[]>,
  a5Result: AcceptanceGateResult,
  a7Result: AcceptanceGateResult,
): AcceptanceGateResult[] {
  const merged: Map<string, AcceptanceGateResult> = new Map();

  for (const [, gates] of perSceneGates) {
    for (const gate of gates) {
      const existing = merged.get(gate.id);
      if (existing) {
        merged.set(gate.id, mergeGateResults(existing, gate));
      } else {
        merged.set(gate.id, { ...gate, failures: [...gate.failures] });
      }
    }
  }

  for (const gate of [a5Result, a7Result]) {
    if (!merged.has(gate.id)) {
      merged.set(gate.id, gate);
    } else {
      merged.set(gate.id, mergeGateResults(merged.get(gate.id)!, gate));
    }
  }

  return Array.from(merged.values());
}

export function extractBuildMetrics(
  measured: { timings: number[]; allStats: { levels?: { level: number; nodeCount: number; averageBuildMs: number; perNodeBuildMs?: number[] }[] }[] },
  lastBuildResult: { levels?: { level: number; nodeCount: number; averageBuildMs: number; perNodeBuildMs?: number[] }[] } | null,
): BuildTimingMetrics {
  const computedTimings: BuildTimingMetrics = {
    fullHierarchyBuildMs: measured.timings.length > 0 ? measured.timings[0] : 0,
    fullHierarchyBuildRuns: 3 + 5,
    fullHierarchyWarmupRuns: 3,
    fullHierarchyMeasuredRuns: 5,
    fullHierarchyBuildMsMin: measured.timings.length > 0 ? Math.min(...measured.timings) : 0,
    fullHierarchyBuildMsP50: percentileFromSamples(measured.timings, 50),
    fullHierarchyBuildMsP95: percentileFromSamples(measured.timings, 95),
    singleNodeRebuildMeasured: false,
    singleNodeRebuildMsMin: 0,
    singleNodeRebuildMsP50: 0,
    singleNodeRebuildMsP95: 0,
    weldMsP95: 0,
    simplifyMsP95: 0,
    validationMsP95: 0,
    slowestNodes: [],
  };

  if (lastBuildResult && lastBuildResult.levels) {
    const maxLevel = Math.max(...lastBuildResult.levels.map((l) => l.level));
    const perNodeSamples: number[] = [];
    for (const l of lastBuildResult.levels) {
      if (l.level === 0 || l.level >= maxLevel) continue;
      if (l.perNodeBuildMs && l.perNodeBuildMs.length > 0) {
        perNodeSamples.push(...l.perNodeBuildMs);
      } else {
        const synthetic = Array(Math.max(1, Math.floor(l.nodeCount / 2))).fill(l.averageBuildMs) as number[];
        perNodeSamples.push(...synthetic);
      }
    }
    if (perNodeSamples.length > 0) {
      computedTimings.singleNodeRebuildMeasured = lastBuildResult.levels.some(
        (l) => l.perNodeBuildMs && l.perNodeBuildMs.length > 0,
      );
      computedTimings.singleNodeRebuildMsMin = Math.min(...perNodeSamples);
      computedTimings.singleNodeRebuildMsP50 = percentileFromSamples(perNodeSamples, 50);
      computedTimings.singleNodeRebuildMsP95 = percentileFromSamples(perNodeSamples, 95);
    }
  }

  return computedTimings;
}

export function buildAcceptanceMetrics(
  firstFixtureTriangles: ReturnType<typeof computeTriangleReduction>,
  firstFixtureLowBenefit: ReturnType<typeof computeLowBenefitRates>,
  computedTimings: BuildTimingMetrics,
  combinedResults: { a1?: AcceptanceGateResult; a2?: AcceptanceGateResult; a3?: AcceptanceGateResult; a7?: AcceptanceGateResult },
): AcceptanceMetrics {
  return {
    lod0Triangles: firstFixtureTriangles.lod0Triangles,
    lod3Triangles: firstFixtureTriangles.lod3Triangles,
    lod3TriangleRatio: firstFixtureTriangles.lod3Ratio,
    fullHierarchyBuildMs: computedTimings.fullHierarchyBuildMs,
    fullHierarchyBuildMsMin: computedTimings.fullHierarchyBuildMsMin,
    fullHierarchyBuildMsP50: computedTimings.fullHierarchyBuildMsP50,
    fullHierarchyBuildMsP95: computedTimings.fullHierarchyBuildMsP95,
    fullHierarchyBuildRuns: computedTimings.fullHierarchyBuildRuns,
    singleNodeRebuildMeasured: computedTimings.singleNodeRebuildMeasured,
    singleNodeRebuildMsMin: computedTimings.singleNodeRebuildMsMin,
    singleNodeRebuildMsP50: computedTimings.singleNodeRebuildMsP50,
    singleNodeRebuildMsP95: computedTimings.singleNodeRebuildMsP95,
    lowBenefitRateLevel1: firstFixtureLowBenefit.lowBenefitRateLevel1,
    lowBenefitRateLevel2: firstFixtureLowBenefit.lowBenefitRateLevel2,
    maxBorderPositionDelta: numericMeasurement(combinedResults.a2, "maxPositionDelta", 0),
    minBorderNormalDot: numericMeasurement(combinedResults.a2, "minNormalDot", 1),
    maxBorderMaterialWeightDelta: numericMeasurement(combinedResults.a2, "maxMaterialWeightDelta", 0),
    densityScarScore: numericMeasurement(combinedResults.a3, "densityScarScore", 0),
    visualHolePixelRatio: -1,
    visualLipPixelRatio: -1,
    visualSweepAvailable: false,
    sameLevelEdgesTested: numericMeasurement(combinedResults.a1, "sameLevelEdgesTested", 0),
    sameLevelFailureCount: numericMeasurement(combinedResults.a1, "sameLevelFailureCount", 0),
    mixedLodDeltasTested: numericMeasurement(combinedResults.a1, "mixedLodDeltasTested", 0),
    mixedLodEdgesTested: numericMeasurement(combinedResults.a1, "mixedLodEdgesTested", 0),
    mixedLodFailureCount: numericMeasurement(combinedResults.a1, "mixedLodFailureCount", 0),
    mixedLodUntestableDeltaCount: numericMeasurement(combinedResults.a1, "mixedLodUntestableDeltaCount", 0),
    streamingWalkFrames: numericMeasurement(combinedResults.a7, "frames", 0),
    streamingMaxCameraToClodCenterM: numericMeasurement(combinedResults.a7, "maxCameraToClodCenterM", 0),
    streamingMaxCameraToFarShellCenterM: numericMeasurement(combinedResults.a7, "maxCameraToFarShellCenterM", 0),
    streamingMaxLiveClodGapHoles: numericMeasurement(combinedResults.a7, "maxLiveClodGapHoles", 0),
    streamingMaxClodFarGapHoles: numericMeasurement(combinedResults.a7, "maxClodFarGapHoles", 0),
    streamingMaxLiveClodOverlapCells: numericMeasurement(combinedResults.a7, "maxLiveClodOverlapCells", 0),
    streamingMaxHorizonHoleRatio: numericMeasurement(combinedResults.a7, "maxHorizonHoleRatio", 0),
    streamingTextureWindowSwaps: numericMeasurement(combinedResults.a7, "textureWindowSwaps", 0),
    streamingMaxActiveBiomeTextures: numericMeasurement(combinedResults.a7, "maxActiveBiomeTextures", 0),
  };
}

export function writeDebugArtifacts(
  runDir: string,
  measured: { timings: number[] },
  computedTimings: BuildTimingMetrics,
  a7Result: AcceptanceGateResult,
  config: AcceptanceConfig,
  allScreenshotSpecs: ReturnType<typeof defineScreenshots>,
  combinedA1Result?: AcceptanceGateResult,
  fixtureName?: string,
): string[] {
  const debugDir = join(runDir, "debug");
  mkdirSync(debugDir, { recursive: true });

  const buildTimingsData = {
    warmupRuns: 3,
    measuredRuns: 5,
    timingsMs: measured.timings,
    fullHierarchyBuildMsMin: computedTimings.fullHierarchyBuildMsMin,
    fullHierarchyBuildMsP50: computedTimings.fullHierarchyBuildMsP50,
    fullHierarchyBuildMsP95: computedTimings.fullHierarchyBuildMsP95,
    singleNodeRebuildMeasured: computedTimings.singleNodeRebuildMeasured,
    singleNodeRebuildMsMin: computedTimings.singleNodeRebuildMsMin,
    singleNodeRebuildMsP50: computedTimings.singleNodeRebuildMsP50,
    singleNodeRebuildMsP95: computedTimings.singleNodeRebuildMsP95,
  };
  writeFileSync(join(debugDir, "build_timings.json"), JSON.stringify(buildTimingsData, null, 2), "utf-8");

  writeFileSync(join(debugDir, "streaming_walk.json"), JSON.stringify({ gate: a7Result }, null, 2), "utf-8");

  const debugFilenames: string[] = ["build_timings.json", "streaming_walk.json"];

  if (!config.visual.enabled) {
    const visualUnavailPaths = writeVisualSweepUnavailable(runDir, config, allScreenshotSpecs);
    debugFilenames.push(...visualUnavailPaths.map((p) => p.replace(debugDir + "\\", "").replace(debugDir + "/", "")));
  }

  if (combinedA1Result && combinedA1Result.failures.some((f) =>
    f.code.startsWith("MIXED_LOD_")
  )) {
    const mixedFailData = {
      scene: fixtureName ?? "unknown",
      failures: combinedA1Result.failures.filter((f) => f.code.startsWith("MIXED_LOD_")),
    };
    writeFileSync(join(debugDir, "mixed_lod_failures.json"), JSON.stringify(mixedFailData, null, 2), "utf-8");
    debugFilenames.push("mixed_lod_failures.json");
  }

  return debugFilenames;
}
