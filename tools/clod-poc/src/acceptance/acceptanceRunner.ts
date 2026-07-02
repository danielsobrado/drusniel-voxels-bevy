import { initSimplifier } from "../clod/simplify.js";
import { fixtureByName } from "../clod/stressFixtures.js";
import { loadClodPagesConfig, buildFixtureWorld } from "./acceptance_runner_fixtures.js";
export { loadClodPagesConfig, buildFixtureWorld } from "./acceptance_runner_fixtures.js";
import type { AcceptanceConfig, AcceptanceRunReport, AcceptanceGateResult, Logger } from "./acceptance_runner_types.js";
export type { AcceptanceConfig, AcceptanceRunReport, AcceptanceGateResult, Logger } from "./acceptance_runner_types.js";
import {
  mergeGatesAcrossScenes,
  extractBuildMetrics,
  buildAcceptanceMetrics,
  writeDebugArtifacts,
} from "./acceptance_runner_report.js";
export { mergeGatesAcrossScenes, extractBuildMetrics, buildAcceptanceMetrics, writeDebugArtifacts } from "./acceptance_runner_report.js";
import { runGateA1, runGateA2 } from "./borderValidation.js";
import { runGateA4, computeTriangleReduction } from "./triangleReductionGate.js";
import { runGateA6, computeLowBenefitRates } from "./lowBenefitGate.js";
import { runGateA5, runFullHierarchyBuild } from "./buildCostGate.js";
import { runGateA3 } from "./densityScarGate.js";
import { runGateA1VisualSweep } from "./visualSweepGate.js";
import { runGateA7 } from "./streamingWalkBatteryGate.js";
import { defineScreenshots } from "./screenshots.js";
import { buildReport, createRunDir, createRunId, createArtifacts, writeAllArtifacts } from "./reportWriter.js";

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

  const activeFixtures: { name: string; def: ReturnType<typeof fixtureByName> }[] = [];

  if (singleScene) {
    const f = fixtureByName(singleScene) ?? fixtureByName(singleScene.replace("_border", ""));
    if (f) activeFixtures.push({ name: singleScene, def: f });
  } else {
    const sceneKeys: [string, string][] = [
      ["ridgeBorder", "ridge_border"],
      ["cliffCorner", "cliff_corner"],
      ["caveMouthBorder", "cave_mouth"],
      ["thinBridge", "thin_bridge"],
    ];
    for (const [cfgKey, fixtureKey] of sceneKeys) {
      if ((config.stressScenes as Record<string, unknown>)[cfgKey] === true) {
        const f = fixtureByName(fixtureKey === "cave_mouth" ? "cave_mouth" : fixtureKey);
        if (f) activeFixtures.push({ name: fixtureKey === "cave_mouth" ? "cave_mouth_border" : fixtureKey, def: f });
      }
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
    if (!def) continue;
    logger.info(`Building fixture: ${name}`);
    const result = buildFixtureWorld(clodCfg, config, def);
    const nodesByLevel = result.nodesByLevel;

    logger.info(`  Levels: ${nodesByLevel.size}, total nodes: ${[...nodesByLevel.values()].reduce((s, n) => s + n.length, 0)}`);

    let a1Result = runGateA1(nodesByLevel, config, name);
    const a3Result = runGateA3(nodesByLevel, config, name);
    const a4Result = runGateA4(nodesByLevel, config, name);
    const a6Result = runGateA6(nodesByLevel, config, name);

    const a1VisualResult = runGateA1VisualSweep(nodesByLevel, config, name);
    if (a1VisualResult) {
      const order: Record<string, number> = { pass: 0, warn: 1, fail: 2 };
      const mergedStatus = order[a1Result.status] >= order[a1VisualResult.status] ? a1Result.status : a1VisualResult.status;
      a1Result = {
        ...a1Result,
        status: mergedStatus,
        message: a1Result.status !== "fail" ? a1VisualResult.message : a1Result.message,
        measurements: { ...a1Result.measurements, ...a1VisualResult.measurements, visualSweepAvailable: false, visualSweepStatus: "not_available" },
        failures: [...a1Result.failures, ...a1VisualResult.failures],
      };
    }

    let a2Result = runGateA2(nodesByLevel, config, name);
    const surfaceFindingsCount = typeof a1Result.measurements.mixedLodSurfaceFindingsCount === "number"
      ? a1Result.measurements.mixedLodSurfaceFindingsCount : 0;
    if (surfaceFindingsCount > 0) {
      const a1maxPos = typeof a1Result.measurements.maxPositionDelta === "number" ? a1Result.measurements.maxPositionDelta : 0;
      const a1minDot = typeof a1Result.measurements.minNormalDot === "number" ? a1Result.measurements.minNormalDot : 1;
      const a1maxMat = typeof a1Result.measurements.maxMaterialWeightDelta === "number" ? a1Result.measurements.maxMaterialWeightDelta : 0;
      a2Result = {
        ...a2Result,
        status: a2Result.status === "fail" ? "fail" : "warn",
        message: a2Result.status === "fail" ? a2Result.message
          : `${surfaceFindingsCount} mixed-LOD surface findings detected. Position delta ${a1maxPos.toExponential(2)}, normal dot ${a1minDot.toFixed(6)}`,
        measurements: {
          ...a2Result.measurements,
          mixedLodSurfaceFindingsCount: surfaceFindingsCount,
          mixedLodMaxPositionDelta: a1maxPos,
          mixedLodMinNormalDot: a1minDot,
          mixedLodMaxMaterialWeightDelta: a1maxMat,
        },
      };
    }
    logger.info(`  A1 Watertight: ${a1Result.status}, A2 Border: ${a2Result.status}, A3 Scars: ${a3Result.status}`);
    logger.info(`  A4 Reduction: ${a4Result.status}, A6 Low-benefit: ${a6Result.status}`);
    perSceneGates.set(name, [a1Result, a2Result, a3Result, a4Result, a6Result]);
  }

  const firstFixture = activeFixtures[0].def!;
  const measured = runFullHierarchyBuild(() => buildFixtureWorld(clodCfg, config, firstFixture), 3, 5);
  const lastBuildResult = measured.allStats.length > 0 ? measured.allStats[measured.allStats.length - 1] : null;
  const computedTimings = extractBuildMetrics(measured, lastBuildResult);

  const a5Result = runGateA5(new Map(), config, computedTimings, activeFixtures[0].name);
  logger.info(`  A5 Build cost: ${a5Result.status}`);
  const a7Result = runGateA7(clodCfg, config);
  logger.info(`  A7 Streaming walk: ${a7Result.status}`);

  const mergedGates = mergeGatesAcrossScenes(perSceneGates, a5Result, a7Result);
  const firstResult = buildFixtureWorld(clodCfg, config, firstFixture);
  const firstFixtureTriangles = computeTriangleReduction(firstResult.nodesByLevel);
  const firstFixtureLowBenefit = computeLowBenefitRates(firstResult.nodesByLevel);

  const combinedA1Result = mergedGates.find((g) => g.id === "A1");
  const combinedA3Result = mergedGates.find((g) => g.id === "A3");
  const combinedA2Result = mergedGates.find((g) => g.id === "A2");
  const combinedA7Result = mergedGates.find((g) => g.id === "A7");

  const metrics = buildAcceptanceMetrics(firstFixtureTriangles, firstFixtureLowBenefit, computedTimings, {
    a1: combinedA1Result,
    a2: combinedA2Result,
    a3: combinedA3Result,
    a7: combinedA7Result,
  });

  const tEnd = performance.now();
  const finishedAtIso = new Date().toISOString();
  const allScreenshotSpecs = activeFixtures.flatMap(({ name }) => defineScreenshots(name, lodDeltas));

  const artifacts = createArtifacts(runDir);
  const debugFilenames = writeDebugArtifacts(runDir, measured, computedTimings, a7Result, config, allScreenshotSpecs, combinedA1Result, activeFixtures[0].name);
  artifacts.debugFiles = debugFilenames;

  const report = buildReport(runId, startedAtIso, finishedAtIso, tEnd - tStart, config.outputDir, mergedGates, metrics, artifacts);
  writeAllArtifacts(runDir, report, config, debugFilenames, []);
  logger.info(`Report written to ${runDir}`);

  return { report, runDir };
}
