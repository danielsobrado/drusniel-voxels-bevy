import { initSimplifier } from "../simplify.js";
import { buildTestHierarchy } from "../clod/buildTestHierarchy.js";
import { fixtureByName, type FixtureDef } from "../clod/stressFixtures.js";
import { type ClodPagesConfig, DEFAULT_DIAGONAL_FLIP_CONFIG } from "../config.js";
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
import { runGateA5, measureBuildTimingsFromStats } from "./buildCostGate.js";
import { runGateA3 } from "./densityScarGate.js";
import { writeScreenshotNotAvailable } from "./screenshots.js";
import { defineScreenshots } from "./screenshots.js";

const ACCEPTANCE_CFG: ClodPagesConfig = {
  page: { chunks_per_page: 4, chunk_size: 16, halo_chunks: 1, quadtree_levels: 4 },
  simplify: {
    target_ratio_per_level: 0.5,
    abandon_ratio: 0.85,
    target_error: 0.01,
    weld_epsilon_cells: 0.001,
    attribute_weights: { normal: 0.5, material: 1.0 },
  },
  polish: { diagonal_flip: DEFAULT_DIAGONAL_FLIP_CONFIG },
  selection: {
    error_threshold_px: 1,
    hysteresis_merge_factor: 1.5,
    neighbor_level_delta_max: 1,
    transition_mode: "instant",
    crossfade_frames: 0,
    freeze_selection: false,
  },
  near_field: { enabled: true, radius_chunks: 6, show_mask: true },
  debug: {
    show_wireframe: true, show_page_boundaries: true, show_locked_border_vertices: false,
    show_error_labels: true, show_stats_panel: true,
    lod_colors: { lod0: "#3b82f6", lod1: "#22c55e", lod2: "#f59e0b", lod3: "#ef4444" },
  },
  stress: { active_scene: "ridge_border" },
  meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: true, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

function defaultPageMeshProvider(fixture: FixtureDef, cellsPerSide: number) {
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
        const h = fixture.height(wx, wz);
        const m = fixture.material(wx, wz);
        positions.push(wx, h, wz);
        normals.push(0, 1, 0);
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

function buildForFixture(fixture: FixtureDef, worldPagesX: number, worldPagesZ: number) {
  const cellsPerPage = ACCEPTANCE_CFG.page.chunks_per_page * ACCEPTANCE_CFG.page.chunk_size;
  const provider = defaultPageMeshProvider(fixture, cellsPerPage);
  return buildTestHierarchy(worldPagesX, worldPagesZ, ACCEPTANCE_CFG, provider);
}

function buildFixtureWorld(config: AcceptanceConfig, fixture: FixtureDef) {
  return buildForFixture(fixture, config.world.lod0PagesX, config.world.lod0PagesZ);
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

  const startedAtIso = new Date().toISOString();
  const tStart = performance.now();
  const runId = createRunId();
  const runDir = createRunDir(config.outputDir, runId);
  const perSceneGates: Map<string, AcceptanceGateResult[]> = new Map();

  const activeFixtures: { name: string; def: FixtureDef }[] = [];

  if (singleScene) {
    const f = fixtureByName(singleScene) ?? fixtureByName(singleScene.replace("_border", ""));
    const name = singleScene;
    if (f) activeFixtures.push({ name, def: f });
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

  const lodDeltas = config.stressScenes.forcedNeighborLodDeltas;

  logger.info(`Running ${activeFixtures.length} scenes`);
  logger.info(`LOD deltas: ${lodDeltas.join(", ")}`);

  for (const { name, def } of activeFixtures) {
    logger.info(`Building fixture: ${name}`);
    const result = buildFixtureWorld(config, def);
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
      const screenshots = defineScreenshots(name, lodDeltas);
      writeScreenshotNotAvailable(runDir, screenshots, config);
    }
  }

  const firstResult = buildFixtureWorld(config, activeFixtures[0].def);
  const buildMetrics = measureBuildTimingsFromStats(firstResult.stats);
  const a5Result = runGateA5(firstResult.nodesByLevel, config, buildMetrics, activeFixtures[0].name);
  logger.info(`  A5 Build cost: ${a5Result.status}`);

  const mergedGates = mergeGatesAcrossScenes(perSceneGates, a5Result);

  const firstFixtureTriangles = computeTriangleReduction(firstResult.nodesByLevel);
  const firstFixtureLowBenefit = computeLowBenefitRates(firstResult.nodesByLevel);

  const combinedA2Result = mergedGates.find((g) => g.id === "A2");
  const combinedA3Result = mergedGates.find((g) => g.id === "A3");

  const metrics: AcceptanceMetrics = {
    lod0Triangles: firstFixtureTriangles.lod0Triangles,
    lod3Triangles: firstFixtureTriangles.lod3Triangles,
    lod3TriangleRatio: firstFixtureTriangles.lod3Ratio,
    fullHierarchyBuildMs: buildMetrics.fullHierarchyBuildMs,
    singleNodeRebuildP50Ms: buildMetrics.singleNodeRebuildMsP50,
    singleNodeRebuildP95Ms: buildMetrics.singleNodeRebuildMsP95,
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
  report.artifacts = written;

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



