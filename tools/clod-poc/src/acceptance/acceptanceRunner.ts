import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSimplifier } from "../simplify.js";
import { buildTestHierarchy } from "../clod/buildTestHierarchy.js";
import { fixtureByName, type FixtureDef } from "../clod/stressFixtures.js";
import { type ClodPagesConfig, parseConfig } from "../config.js";
import type { AcceptanceConfig, AcceptanceRunReport, AcceptanceGateResult, AcceptanceMetrics, Logger } from "./acceptanceTypes.js";
import {
  buildReport,
  createRunDir,
  createRunId,
  createArtifacts,
  writeAllArtifacts,
} from "./reportWriter.js";
import { runGateA1, runGateA2 } from "./borderValidation.js";
import { runGateA4, computeTriangleReduction } from "./triangleReductionGate.js";
import { runGateA6, computeLowBenefitRates } from "./lowBenefitGate.js";
import { runGateA5, measureBuildTimingsFromStats, runFullHierarchyBuild } from "./buildCostGate.js";
import { runGateA3 } from "./densityScarGate.js";
import { writeScreenshotNotAvailable } from "./screenshots.js";
import { defineScreenshots } from "./screenshots.js";

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
) {
  const cellsPerPage = clodCfg.page.chunks_per_page * clodCfg.page.chunk_size;
  const provider = defaultPageMeshProvider(fixture, cellsPerPage);
  return buildTestHierarchy(worldPagesX, worldPagesZ, clodCfg, provider);
}

function buildFixtureWorld(clodCfg: ClodPagesConfig, config: AcceptanceConfig, fixture: FixtureDef) {
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
      } else if (key === "failureCount") {
        mergedMeasurements[key] = (mergedMeasurements[key] as number) + val;
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
  const allScreenshotPaths: string[] = [];
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

    if (config.visual.enabled) {
      const specs = defineScreenshots(name, lodDeltas);
      const paths = writeScreenshotNotAvailable(runDir, specs, config);
      allScreenshotPaths.push(...paths);
    }
  }

  const firstFixture = activeFixtures[0].def;
  const warmupResult = buildFixtureWorld(clodCfg, config, firstFixture);
  const buildTimings = measureBuildTimingsFromStats(warmupResult.stats);
  const a5Result = runGateA5(warmupResult.nodesByLevel, config, buildTimings, activeFixtures[0].name);
  logger.info(`  A5 Build cost: ${a5Result.status}`);

  const mergedGates = mergeGatesAcrossScenes(perSceneGates, a5Result);

  const firstFixtureTriangles = computeTriangleReduction(warmupResult.nodesByLevel);
  const firstFixtureLowBenefit = computeLowBenefitRates(warmupResult.nodesByLevel);

  const combinedA2Result = mergedGates.find((g) => g.id === "A2");
  const combinedA3Result = mergedGates.find((g) => g.id === "A3");

  const metrics: AcceptanceMetrics = {
    lod0Triangles: firstFixtureTriangles.lod0Triangles,
    lod3Triangles: firstFixtureTriangles.lod3Triangles,
    lod3TriangleRatio: firstFixtureTriangles.lod3Ratio,
    fullHierarchyBuildMs: buildTimings.fullHierarchyBuildMs,
    singleNodeRebuildP50Ms: buildTimings.singleNodeRebuildMsP50,
    singleNodeRebuildP95Ms: buildTimings.singleNodeRebuildMsP95,
    lowBenefitRateLevel1: firstFixtureLowBenefit.lowBenefitRateLevel1,
    lowBenefitRateLevel2: firstFixtureLowBenefit.lowBenefitRateLevel2,
    maxBorderPositionDelta: typeof combinedA2Result?.measurements.maxPositionDelta === "number" ? combinedA2Result.measurements.maxPositionDelta : 0,
    minBorderNormalDot: typeof combinedA2Result?.measurements.minNormalDot === "number" ? combinedA2Result.measurements.minNormalDot : 1,
    maxBorderMaterialWeightDelta: typeof combinedA2Result?.measurements.maxMaterialWeightDelta === "number" ? combinedA2Result.measurements.maxMaterialWeightDelta : 0,
    densityScarScore: typeof combinedA3Result?.measurements.densityScarScore === "number" ? combinedA3Result.measurements.densityScarScore : 0,
    visualHolePixelRatio: 0,
    visualLipPixelRatio: 0,
  };

  const tEnd = performance.now();
  const finishedAtIso = new Date().toISOString();

  const artifacts = createArtifacts(runDir);
  artifacts.screenshots = allScreenshotPaths;

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

  const written = writeAllArtifacts(runDir, report, config);
  report.artifacts.screenshots = allScreenshotPaths;

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
