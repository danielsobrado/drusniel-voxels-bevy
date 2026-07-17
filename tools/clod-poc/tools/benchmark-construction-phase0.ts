import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createConstructionBenchmarkCatalog, createConstructionBenchmarkScenarios } from "../src/construction/construction_benchmark_scenarios.js";
import { DEFAULT_CONSTRUCTION_SUPPORT_PROFILES } from "../src/construction/config.js";
import { ConstructionOverlapIndex } from "../src/construction/overlap_index.js";
import { validateConstructionPlacement } from "../src/construction/placement.js";
import { ConstructionSnapIndex } from "../src/construction/snap_index.js";
import type {
  ConstructionPlacementConfig,
  ConstructionSnapConfig,
  ConstructionStabilityConfig,
} from "../src/construction/types.js";

const ITERATIONS = 100;
const SNAP_CONFIG: ConstructionSnapConfig = { radiusM: 0.85, spatialCellM: 1, minAlignment: 0.7, alignmentWeight: 0.65, distanceWeight: 0.35 };
const PLACEMENT_CONFIG: ConstructionPlacementConfig = { maxRayDistanceM: 32, terrainStepM: 1, overlapPaddingM: 0.04, overlapSpatialCellM: 4, storageKey: "benchmark", unboundedWorld: true };
const STABILITY_CONFIG: ConstructionStabilityConfig = {
  collapseThreshold: 0.20,
  epsilon: 0.0001,
  maxIslandSize: 4096,
  maxCollapsesPerFrame: 8,
  connectionToleranceM: 0.08,
  verticalConnectionMinRatio: 0.55,
};

interface ScenarioResult {
  scene: string;
  pieces: number;
  snap_ms_p95: number;
  validation_ms_p95: number;
  snap_visited_cells_max: number;
  snap_candidates_max: number;
  overlap_visited_cells_max: number;
  overlap_candidates_max: number;
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function main(): void {
  const catalog = createConstructionBenchmarkCatalog();
  const results: ScenarioResult[] = [];
  for (const scene of createConstructionBenchmarkScenarios()) {
    const snapIndex = new ConstructionSnapIndex(SNAP_CONFIG.spatialCellM);
    const overlapIndex = new ConstructionOverlapIndex(PLACEMENT_CONFIG.overlapSpatialCellM);
    for (const placed of scene.pieces) {
      const definition = catalog.get(placed.typeId);
      if (!definition) throw new Error(`Missing benchmark definition ${placed.typeId}`);
      snapIndex.addPiece(definition, placed.id, placed.position, placed.rotationQuarterTurns);
      overlapIndex.addPiece(placed, definition);
    }
    const candidate = catalog.get(scene.candidatePieceId);
    if (!candidate) throw new Error(`Missing benchmark candidate ${scene.candidatePieceId}`);
    const snapTimes: number[] = [];
    const validationTimes: number[] = [];
    let snapVisitedCellsMax = 0;
    let snapCandidatesMax = 0;
    let overlapVisitedCellsMax = 0;
    let overlapCandidatesMax = 0;
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const snapStarted = performance.now();
      snapIndex.findBestSnapNearRay(scene.rayOrigin, scene.rayDirection, scene.rayDistanceM, candidate, 0, SNAP_CONFIG);
      snapTimes.push(performance.now() - snapStarted);
      const snapStats = snapIndex.queryStats();
      snapVisitedCellsMax = Math.max(snapVisitedCellsMax, snapStats.visitedCells);
      snapCandidatesMax = Math.max(snapCandidatesMax, snapStats.candidatePoints);

      const overlapCandidates = overlapIndex.query(candidate, scene.candidatePosition, 0);
      const validationStarted = performance.now();
      validateConstructionPlacement({
        piece: candidate,
        material: candidate.material,
        position: scene.candidatePosition,
        rotationQuarterTurns: 0,
        snapped: false,
        snap: null,
        connectionIds: [],
        terrainHit: {
          point: [scene.candidatePosition[0], 0, scene.candidatePosition[2]],
          normal: [0, 1, 0],
          distanceM: 2,
          surfaceType: "terrain",
        },
        placedPieces: scene.pieces,
        overlapCandidates,
        piecesById: catalog,
        worldCells: Number.MAX_SAFE_INTEGER,
        config: PLACEMENT_CONFIG,
        stabilityConfig: STABILITY_CONFIG,
        supportProfiles: DEFAULT_CONSTRUCTION_SUPPORT_PROFILES,
      });
      validationTimes.push(performance.now() - validationStarted);
      const overlapStats = overlapIndex.queryStats();
      overlapVisitedCellsMax = Math.max(overlapVisitedCellsMax, overlapStats.visitedCells);
      overlapCandidatesMax = Math.max(overlapCandidatesMax, overlapStats.candidatePieces);
    }
    results.push({
      scene: scene.id,
      pieces: scene.pieces.length,
      snap_ms_p95: p95(snapTimes),
      validation_ms_p95: p95(validationTimes),
      snap_visited_cells_max: snapVisitedCellsMax,
      snap_candidates_max: snapCandidatesMax,
      overlap_visited_cells_max: overlapVisitedCellsMax,
      overlap_candidates_max: overlapCandidatesMax,
    });
  }

  const baseline = results.find((result) => result.scene === "small-cabin");
  const settlement = results.find((result) => result.scene === "settlement-10k");
  if (!baseline || !settlement) throw new Error("Missing required benchmark scenes");
  const gates = {
    settlement_piece_count: settlement.pieces === 10_000,
    snap_candidates_local: settlement.snap_candidates_max <= Math.max(64, baseline.snap_candidates_max * 4),
    overlap_candidates_local: settlement.overlap_candidates_max <= Math.max(32, baseline.overlap_candidates_max * 4),
    snap_cells_bounded: settlement.snap_visited_cells_max <= 2_000,
    overlap_cells_bounded: settlement.overlap_visited_cells_max <= 64,
  };
  const passed = Object.values(gates).every(Boolean);
  const report = { generated_at: new Date().toISOString(), iterations: ITERATIONS, passed, gates, results };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve("construction-phase0-runs", timestamp);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "summary.json"), JSON.stringify(report, null, 2));
  console.table(results);
  console.log(`Construction Phase 0: ${passed ? "PASS" : "FAIL"}`);
  if (!passed) process.exitCode = 1;
}

main();
