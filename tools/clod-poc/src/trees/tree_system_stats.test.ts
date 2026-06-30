import { describe, expect, it } from "vitest";
import {
  buildTreeSystemStats,
  createEmptyTreeHeroFidelityStats,
  createEmptyTreeSystemStats,
  type TreeGenerationStats,
  type TreeSystemStatsPatchInput,
} from "./index.js";

describe("tree system stats aggregation", () => {
  it("creates the default tree stats snapshot", () => {
    expect(createEmptyTreeSystemStats()).toMatchObject({
      totalTrees: 0,
      patches: 0,
      visiblePatches: 0,
      culledPatches: 0,
      heroNearTreeTriangles: 0,
      heroNearFoliageTriangles: 0,
      heroNearPassesTriangleFloor: false,
      heroNearPassesRealFoliage: false,
      gpuStatus: "disabled",
      gpuShadowCasterCount: 0,
      gpuShadowOverflowed: false,
      gpuDispatchMs: null,
      impostorStatus: "disabled",
      generatedCandidates: 0,
      acceptedCandidates: 0,
    });
  });

  it("aggregates CPU patch stats", () => {
    const stats = buildTreeSystemStats({
      patches: [
        patch(true, 2, generation(4, 2, 1, 0, 1)),
        patch(false, 3, generation(6, 3, 0, 2, 1)),
      ],
      lodCounts: { near: 1, mid: 2, far: 3, impostor: 4 },
      heroFidelity: {
        nearTreeCount: 2,
        nearTriangleCount: 130_000,
        nearFoliageTriangleCount: 80_000,
        minNearTreeTriangles: 50_000,
        avgNearTreeTriangles: 65_000,
        passesTriangleFloor: true,
        passesRealFoliage: true,
      },
      gpuRing: false,
      gpuRingStats: { candidateCount: 99, acceptedCandidates: 88, counts: { near: 9, mid: 8, far: 7, impostor: 6 } },
      gpuVisibleCount: 77,
      gpuStatus: "fallback-cpu",
      gpuOverflowed: false,
      gpuDispatchMs: null,
      gpuShowCounts: true,
      impostorStatus: "baked",
      impostorReason: null,
    });

    expect(stats.totalTrees).toBe(5);
    expect(stats.patches).toBe(2);
    expect(stats.visiblePatches).toBe(1);
    expect(stats.culledPatches).toBe(1);
    expect(stats.generatedCandidates).toBe(10);
    expect(stats.acceptedCandidates).toBe(5);
    expect(stats.rejectedSlope).toBe(1);
    expect(stats.rejectedHeight).toBe(2);
    expect(stats.rejectedMaterial).toBe(2);
    expect(stats.nearTrees).toBe(1);
    expect(stats.heroNearTreeTriangles).toBe(130_000);
    expect(stats.heroNearFoliageTriangles).toBe(80_000);
    expect(stats.heroNearPassesTriangleFloor).toBe(true);
    expect(stats.heroNearPassesRealFoliage).toBe(true);
    expect(stats.gpuCandidateCount).toBe(0);
    expect(stats.gpuVisibleCount).toBe(0);
    expect(stats.gpuShadowCasterCount).toBe(0);
  });

  it("aggregates GPU ring stats", () => {
    const stats = buildTreeSystemStats({
      patches: [patch(true, 100, generation(100, 100, 0, 0, 0))],
      lodCounts: { near: 10, mid: 20, far: 30, impostor: 40 },
      heroFidelity: createEmptyTreeHeroFidelityStats(),
      gpuRing: true,
      gpuRingStats: {
        candidateCount: 123,
        acceptedCandidates: 0,
        counts: { near: 1, mid: 2, far: 3, impostor: 4 },
        shadowGroupCounts: [1, 2, 3],
        shadowOverflowed: true,
      },
      gpuVisibleCount: 0,
      gpuStatus: "ring",
      gpuOverflowed: true,
      gpuDispatchMs: 1.5,
      gpuShowCounts: false,
      impostorStatus: "fallback",
      impostorReason: "test",
    });

    expect(stats.totalTrees).toBe(10);
    expect(stats.generatedCandidates).toBe(123);
    expect(stats.acceptedCandidates).toBe(10);
    expect(stats.heroNearTreeTriangles).toBe(0);
    expect(stats.gpuCandidateCount).toBe(123);
    expect(stats.gpuAcceptedCount).toBe(10);
    expect(stats.gpuVisibleCount).toBe(10);
    expect(stats.gpuShadowCasterCount).toBe(6);
    expect(stats.gpuOverflowed).toBe(true);
    expect(stats.gpuShadowOverflowed).toBe(true);
    expect(stats.gpuDispatchMs).toBe(1.5);
    expect(stats.gpuShowCounts).toBe(false);
    expect(stats.impostorStatus).toBe("fallback");
    expect(stats.impostorReason).toBe("test");
  });
});

function patch(visible: boolean, instanceCount: number, generationStats: TreeGenerationStats): TreeSystemStatsPatchInput {
  return { visible, instances: new Array(instanceCount).fill(null), generationStats };
}

function generation(
  generatedCandidates: number,
  acceptedCandidates: number,
  rejectedSlope: number,
  rejectedHeight: number,
  rejectedMaterial: number,
): TreeGenerationStats {
  return {
    generatedCandidates,
    acceptedCandidates,
    rejectedSlope,
    rejectedHeight,
    rejectedMaterial,
  };
}
