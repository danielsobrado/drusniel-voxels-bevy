import { describe, expect, it } from "vitest";
import { createVegetationTerrainRejectProvider } from "./vegetation_terrain_reject_provider.js";
import type { VegetationClusterDescriptor } from "./vegetation_cluster_descriptors.js";

const visibility = {
  enabled: true,
  minDistanceM: 0,
  sampleCount: 3,
  heightMarginM: 0,
  crownHeightM: 1,
};

function descriptor(overrides: Partial<VegetationClusterDescriptor> = {}): VegetationClusterDescriptor {
  return {
    id: 1,
    kind: "tree",
    ring: 0,
    pageX: 0,
    pageZ: 0,
    centerX: 32,
    centerZ: 32,
    halfSize: 4,
    minY: 0,
    maxY: 20,
    seed: 123,
    densityBudget: 16,
    terrainRevision: 7,
    ...overrides,
  };
}

describe("VegetationTerrainRejectProvider", () => {
  it("keeps clusters when summary data is missing", () => {
    const result = createVegetationTerrainRejectProvider().classifyCluster({
      descriptor: descriptor(),
      kind: "tree",
      cameraX: 0,
      cameraY: 2,
      cameraZ: 0,
      worldCells: 128,
      visibility,
    });

    expect(result).toMatchObject({ reject: false, reason: "summaryMissing", confidence: "fallback" });
  });

  it("keeps clusters when terrain revision is stale", () => {
    const result = createVegetationTerrainRejectProvider().classifyCluster({
      descriptor: descriptor(),
      kind: "grass",
      cameraX: 0,
      cameraY: 2,
      cameraZ: 0,
      worldCells: 128,
      visibility,
      sampler: { sampleHeight: () => ({ height: 0 }) },
      terrainRevision: 1,
      expectedTerrainRevision: 2,
    });

    expect(result).toMatchObject({ reject: false, reason: "summaryMissing", confidence: "fallback" });
  });

  it("keeps stale clusters even when a caller requests freshness", () => {
    const result = createVegetationTerrainRejectProvider().classifyCluster({
      descriptor: descriptor(),
      kind: "grass",
      cameraX: 0,
      cameraY: 2,
      cameraZ: 0,
      worldCells: 128,
      visibility,
      sampler: { sampleHeight: () => ({ height: 0 }) },
      terrainRevision: 1,
      expectedTerrainRevision: 2,
      acceptWhenRevisionMismatch: false,
    });

    expect(result).toMatchObject({ reject: false, reason: "summaryMissing", confidence: "fallback" });
  });

  it("keeps clusters when sampled height is unknown", () => {
    const result = createVegetationTerrainRejectProvider().classifyCluster({
      descriptor: descriptor(),
      kind: "understory",
      cameraX: 0,
      cameraY: 2,
      cameraZ: 0,
      worldCells: 128,
      visibility,
      sampler: { sampleHeight: () => ({ height: Number.NaN, unknown: true }) },
      acceptWhenSummaryMissing: false,
    });

    expect(result).toMatchObject({ reject: false, reason: "summaryMissing", confidence: "fallback" });
  });

  it("rejects clusters completely outside terrain", () => {
    const result = createVegetationTerrainRejectProvider().classifyCluster({
      descriptor: descriptor({ centerX: -32, centerZ: -32, halfSize: 4 }),
      kind: "understory",
      cameraX: 0,
      cameraY: 2,
      cameraZ: 0,
      worldCells: 128,
      visibility,
      sampler: { sampleHeight: () => ({ height: 0 }) },
    });

    expect(result).toMatchObject({ reject: true, reason: "outsideTerrain", confidence: "exact" });
  });

  it("rejects terrain-hidden clusters only when the segment proves occlusion", () => {
    const provider = createVegetationTerrainRejectProvider();
    const result = provider.classifyCluster({
      descriptor: descriptor({ centerX: 64, centerZ: 0, halfSize: 4 }),
      kind: "tree",
      cameraX: 0,
      cameraY: 0,
      cameraZ: 0,
      worldCells: 128,
      visibility,
      sampler: {
        sampleHeight: (x) => ({ height: x > 8 && x < 56 ? 100 : 0 }),
      },
    });

    expect(result).toMatchObject({ reject: true, reason: "terrainHidden" });
  });

  it("keeps accepted clusters deterministic", () => {
    const provider = createVegetationTerrainRejectProvider();
    const query = {
      descriptor: descriptor({ seed: 999 }),
      kind: "grass" as const,
      cameraX: 0,
      cameraY: 10,
      cameraZ: 0,
      worldCells: 128,
      visibility,
      sampler: { sampleHeight: () => ({ height: 0 }) },
    };

    const first = provider.classifyCluster(query);
    const second = provider.classifyCluster(query);

    expect(first).toEqual(second);
    expect(query.descriptor.seed).toBe(999);
  });
});
