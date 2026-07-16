import { describe, expect, it } from "vitest";
import { createConstructionBenchmarkCatalog, createConstructionBenchmarkScenarios } from "./construction_benchmark_scenarios.js";
import { ConstructionOverlapIndex } from "./overlap_index.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionSnapConfig } from "./types.js";

const snapConfig: ConstructionSnapConfig = {
  radiusM: 1,
  spatialCellM: 1,
  minAlignment: 0.7,
  alignmentWeight: 0.65,
  distanceWeight: 0.35,
};

describe("construction phase 0 architecture", () => {
  it("defines all deterministic benchmark scenes including exactly 10k settlement pieces", () => {
    const scenes = createConstructionBenchmarkScenarios();
    expect(scenes.map((scene) => scene.id)).toEqual([
      "small-cabin",
      "cantilever-balcony",
      "supported-bridge",
      "tall-tower",
      "sloped-roof-corners",
      "uneven-terrain-foundation",
      "settlement-10k",
    ]);
    expect(scenes.find((scene) => scene.id === "settlement-10k")?.pieces).toHaveLength(10_000);
  });

  it("keeps snap ray candidates local when ten thousand distant pieces exist", () => {
    const catalog = createConstructionBenchmarkCatalog();
    const floor = catalog.get("bench-floor")!;
    const index = new ConstructionSnapIndex(1);
    index.addPiece(floor, "near", [4, 0.1, 0], 0);
    for (let indexValue = 0; indexValue < 10_000; indexValue += 1) {
      index.addPiece(floor, `far-${indexValue}`, [1_000 + indexValue * 4, 0.1, 1_000], 0);
    }

    const snap = index.findBestSnapNearRay([0, 0.1, 0], [1, 0, 0], 10, floor, 0, snapConfig);
    const stats = index.queryStats();

    expect(snap?.target.entityId).toBe("near");
    expect(stats.candidatePoints).toBeLessThanOrEqual(4);
    expect(stats.visitedCells).toBeLessThan(1_000);
    expect(stats.traversalTruncated).toBe(false);
  });

  it("keeps overlap candidates local when ten thousand distant pieces exist", () => {
    const catalog = createConstructionBenchmarkCatalog();
    const floor = catalog.get("bench-floor")!;
    const overlapIndex = new ConstructionOverlapIndex(4);
    for (let indexValue = 0; indexValue < 10_000; indexValue += 1) {
      const placed = { id: `piece-${indexValue}`, typeId: floor.id, position: [indexValue * 4, 0.1, 100] as const, rotationQuarterTurns: 0 };
      overlapIndex.addPiece(placed, floor);
    }

    const candidates = overlapIndex.query(floor, [0, 0.1, 0], 0);
    const stats = overlapIndex.queryStats();

    expect(candidates).toHaveLength(0);
    expect(stats.candidatePieces).toBe(0);
    expect(stats.visitedCells).toBeLessThanOrEqual(8);
  });
});
