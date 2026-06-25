import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSimplifier } from "../simplify.js";
import { buildTestHierarchy } from "../clod/buildTestHierarchy.js";
import { fixtureByName, type FixtureDef } from "../clod/stressFixtures.js";
import { type ClodPagesConfig, parseConfig } from "../config.js";
import type { TestBuildResult } from "../clod/buildTestHierarchy.js";
import type { AcceptanceConfig, AcceptanceRunReport, AcceptanceGateResult, AcceptanceMetrics, Logger } from "./acceptanceTypes.js";
import {
  buildReport,
  createRunDir,
  createRunId,
  createArtifacts,
  writeAllArtifacts,
} from "./reportWriter.js";
import { runGateA1 } from "./borderValidation.js";
import { runGateA2 } from "./borderValidation.js";
import { runGateA4, computeTriangleReduction } from "./triangleReductionGate.js";
import { runGateA6, computeLowBenefitRates } from "./lowBenefitGate.js";
import { runGateA5, runFullHierarchyBuild, type BuildTimingMetrics } from "./buildCostGate.js";
import { runGateA3 } from "./densityScarGate.js";
import { defineScreenshots, writeVisualSweepUnavailable } from "./screenshots.js";

const _runnerDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(_runnerDir, "..", "..", "config", "clod_pages.yaml");

function normalFromHeightFn(heightFn: (x: number, z: number) => number, eps = 0.01) {
  return (x: number, z: number): [number, number, number] => {
    const h = heightFn(x, z);
    const hx = heightFn(x + eps, z);
    const hz = heightFn(x, z + eps);
    const dx = (hx - h) / eps;
    const dz = (hz - h) / eps;
    const len = Math.hypot(-dx, 1, -dz);
    return len > 0 ? [-dx / len, 1 / len, -dz / len] : [0, 1, 0];
  };
}

function loadClodPagesConfig(path?: string): ClodPagesConfig {
  const configPath = path ?? DEFAULT_CONFIG_PATH;
  const text = readFileSync(configPath, "utf-8");
  return parseConfig(text);
}

function defaultPageMeshProvider(fixture: FixtureDef, cellsPerSide: number) {
  const heightFn = fixture.height;
  const materialFn = fixture.material;
  const normalFn = normalFromHeightFn(heightFn, 0.01);

  return (px: number, pz: number) => {
    const baseX = px * cellsPerSide;
    const baseZ = pz * cellsPerSide;
    const side = cellsPerSide + 1;
    const positions: number[] = [];
    const normals: number[] = [];
    const materials: number[] = [];

    for (let j = 0; j <= cellsPerSide; j++) {
      for (let i = 0; i <= cellsPerSide; i++) {
        const wx = baseX + i;
        const wz = baseZ + j;
        const h = heightFn(wx, wz);
        const n = normalFn(wx, wz);
        const m = materialFn(wx, wz);
        positions.push(wx, h, wz);
        normals.push(n[0], n[1], n[2]);
        materials.push(m);
      }
    }

    const indices: number[] = [];
    for (let j = 0; j < cellsPerSide; j++) {
      for (let i = 0; i < cellsPerSide; i++) {
        const a = j * side + i;
        const b = a + 1;
        const c = (j + 1) * side + i;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const nv = materials.length;
    const mw = new Float32Array(nv * 4);
    for (let i = 0; i < nv; i++) {
      const slot = Math.min(Math.max(0, Math.round(materials[i])), 3);
      mw[i * 4 + slot] = 1.0;
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      paintSlots: new Float32Array(materials),
      materialWeights: mw,
      materialWeightStride: 4,
      indices: new Uint32Array(indices),
    };
  };
}

function buildForFixture(
  clodCfg: ClodPagesConfig,
  fixture: FixtureDef,
  worldPagesX: number,
  worldPagesZ: number,
): TestBuildResult {
  const cellsPerPage = clodCfg.page.chunks_per_page * clodCfg.page.chunk_size;
  const provider = defaultPageMeshProvider(fixture, cellsPerPage);
  return buildTestHierarchy(worldPagesX, worldPagesZ, clodCfg, provider);
}

function buildFixtureWorld(clodCfg: ClodPagesConfig, config: AcceptanceConfig, fixture: FixtureDef): TestBuildResult {
  return buildForFixture(clodCfg, fixture, config.world.lod0PagesX, config.world.lod0PagesZ);
}

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

export async function runAcceptance(
  config: AcceptanceConfig,
  logger: Logger,
  singleScene?: string,
): Promise<{ report: AcceptanceRunReport; runDir: string }> {
  await initSimplifier();

  const clodCfg = loadClodPagesConfig();

  const startedAtIso = new Date().toISOString();
  const tStart = performance.now();
  const runId = createRunId();
  const runDir = createRunDir(config.outputDir, runId);
  const perSceneGates: Map<string, AcceptanceGateResult[]> = new Map();
  const lodDeltas = config.stressScenes.forcedNeighborLodDeltas;

  const activeFixtures: { name: string; def: FixtureDef }[] = [];

  if (singleScene) {
    const f = fixtureByName(singleScene) ?? fixtureByName(singleScene.replace("_border", ""));
    if (f) activeFixtures.push({ name: singleScene, def: f });
  } else {
    if (config.stressScenes.ridgeBorder) {
      const f = fixtureByName("ridge_border");
      if (f) activeFixtures.push({ name: "ridge_border", def: f });
    }
    if (config.stressScenes.cliffCorner) {
      const f = fixtureByName("cliff_corner");
      if (f) activeFixtures.push({ name: "cliff_corner", def: f });
    }
    if (config.stressScenes.caveMouthBorder) {
      const f = fixtureByName("cave_mouth");
      if (f) activeFixtures.push({ name: "cave_mouth_border", def: f });
    }
    if (config.stressScenes.thinBridge) {
      const f = fixtureByName("thin_bridge");
      if (f) activeFixtures.push({ name: "thin_bridge", def: f });
    }
  }

  if (activeFixtures.length === 0) {
    const f = fixtureByName("ridge_border");
    if (f) activeFixtures.push({ name: "ridge_border", def: f });
    logger.warn("No active fixtures configured, falling back to ridge_border");
  }

  logger.info(`Running ${activeFixtures.length} scenes`);
  logger.info(`LOD deltas: ${lodDeltas.join(", ")}`);

  for (const { name, def } of activeFixtures) {
    logger.info(`Building fixture: ${name}`);
    const result = buildFixtureWorld(clodCfg, config, def);
    const nodesByLevel = result.nodesByLevel;

    logger.info(`  Levels: ${nodesByLevel.size}, total nodes: ${[...nodesByLevel.values()].reduce((s, n) => s + n.length, 0)}`);

    const a1Result = runGateA1(nodesByLevel, config, name);
    const a2Result = runGateA2(nodesByLevel, config, name);
    const a3Result = runGateA3(nodesByLevel, config, name);
    const a4Result = runGateA4(nodesByLevel, config, name);
    const a6Result = runGateA6(nodesByLevel, config, name);

    logger.info(`  A1 Watertight: ${a1Result.status}, A2 Border: ${a2Result.status}, A3 Scars: ${a3Result.status}`);
    logger.info(`  A4 Reduction: ${a4Result.status}, A6 Low-benefit: ${a6Result.status}`);

    perSceneGates.set(name, [a1Result, a2Result, a3Result, a4Result, a6Result]);
  }

  const firstFixture = activeFixtures[0].def;
  const measured = runFullHierarchyBuild(
    () => buildFixtureWorld(clodCfg, config, firstFixture),
    3,
    5,
  );

  const lastBuildResult = measured.allStats.length > 0
    ? measured.allStats[measured.allStats.length - 1]
    : null;

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

  const a5Result = runGateA5(new Map(), config, computedTimings, activeFixtures[0].name);
  logger.info(`  A5 Build cost: ${a5Result.status}`);

  const mergedGates = mergeGatesAcrossScenes(perSceneGates, a5Result);

  const firstResult = buildFixtureWorld(clodCfg, config, firstFixture);
  const firstFixtureTriangles = computeTriangleReduction(firstResult.nodesByLevel);
  const firstFixtureLowBenefit = computeLowBenefitRates(firstResult.nodesByLevel);

  const combinedA1Result = mergedGates.find((g) => g.id === "A1");
  const combinedA2Result = mergedGates.find((g) => g.id === "A2");
  const combinedA3Result = mergedGates.find((g) => g.id === "A3");

  const metrics: AcceptanceMetrics = {
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
    maxBorderPositionDelta: typeof combinedA2Result?.measurements.maxPositionDelta === "number" ? combinedA2Result.measurements.maxPositionDelta : 0,
    minBorderNormalDot: typeof combinedA2Result?.measurements.minNormalDot === "number" ? combinedA2Result.measurements.minNormalDot : 1,
    maxBorderMaterialWeightDelta: typeof combinedA2Result?.measurements.maxMaterialWeightDelta === "number" ? combinedA2Result.measurements.maxMaterialWeightDelta : 0,
    densityScarScore: typeof combinedA3Result?.measurements.densityScarScore === "number" ? combinedA3Result.measurements.densityScarScore : 0,
    visualHolePixelRatio: -1,
    visualLipPixelRatio: -1,
    visualSweepAvailable: false,
    sameLevelEdgesTested: typeof combinedA1Result?.measurements.sameLevelEdgesTested === "number" ? combinedA1Result.measurements.sameLevelEdgesTested : 0,
    sameLevelFailureCount: typeof combinedA1Result?.measurements.sameLevelFailureCount === "number" ? combinedA1Result.measurements.sameLevelFailureCount : 0,
    mixedLodDeltasTested: typeof combinedA1Result?.measurements.mixedLodDeltasTested === "number" ? combinedA1Result.measurements.mixedLodDeltasTested : 0,
    mixedLodEdgesTested: typeof combinedA1Result?.measurements.mixedLodEdgesTested === "number" ? combinedA1Result.measurements.mixedLodEdgesTested : 0,
    mixedLodFailureCount: typeof combinedA1Result?.measurements.mixedLodFailureCount === "number" ? combinedA1Result.measurements.mixedLodFailureCount : 0,
    mixedLodUntestableDeltaCount: typeof combinedA1Result?.measurements.mixedLodUntestableDeltaCount === "number" ? combinedA1Result.measurements.mixedLodUntestableDeltaCount : 0,
  };

  const tEnd = performance.now();
  const finishedAtIso = new Date().toISOString();

  const allScreenshotSpecs = activeFixtures.flatMap(({ name }) =>
    defineScreenshots(name, lodDeltas)
  );

  const artifacts = createArtifacts(runDir);

  const debugFiles: string[] = [];

  const buildTimingsPath = join(runDir, "debug", "build_timings.json");
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
  writeFileSync(buildTimingsPath, JSON.stringify(buildTimingsData, null, 2), "utf-8");
  debugFiles.push(buildTimingsPath);

  if (!config.visual.enabled) {
    const visualUnavailPaths = writeVisualSweepUnavailable(runDir, config, allScreenshotSpecs);
    debugFiles.push(...visualUnavailPaths);
  }

  if (combinedA1Result && combinedA1Result.failures.some((f) =>
    f.code.startsWith("MIXED_LOD_")
  )) {
    const mixedFailPath = join(runDir, "debug", "mixed_lod_failures.json");
    const mixedFailData = {
      scene: activeFixtures[0].name,
      failures: combinedA1Result.failures.filter((f) => f.code.startsWith("MIXED_LOD_")),
    };
    writeFileSync(mixedFailPath, JSON.stringify(mixedFailData, null, 2), "utf-8");
    debugFiles.push(mixedFailPath);
  }

  const relDebugFiles = debugFiles.map((p) => {
    const absRunDir = join(config.outputDir, runId);
    return p.replace(absRunDir + "\\", "").replace(absRunDir + "/", "");
  });

  artifacts.debugFiles = relDebugFiles;

  const report = buildReport(
    runId,
    startedAtIso,
    finishedAtIso,
    tEnd - tStart,
    config.outputDir,
    mergedGates,
    metrics,
    artifacts,
  );

  writeAllArtifacts(runDir, report, config, relDebugFiles, []);

  logger.info(`Report written to ${runDir}`);

  return { report, runDir };
}

function mergeGatesAcrossScenes(
  perSceneGates: Map<string, AcceptanceGateResult[]>,
  a5Result: AcceptanceGateResult,
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

  if (!merged.has("A5")) {
    merged.set("A5", a5Result);
  } else {
    merged.set("A5", mergeGateResults(merged.get("A5")!, a5Result));
  }

  return Array.from(merged.values());
}
