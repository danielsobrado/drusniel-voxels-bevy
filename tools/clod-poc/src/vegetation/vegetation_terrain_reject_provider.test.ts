import { describe, expect, it } from "vitest";
import {
  createTerrainSummaryRejectProvider,
  createVegetationTerrainRejectProvider,
} from "./vegetation_terrain_reject_provider.js";
import type { VegetationClusterDescriptor } from "./vegetation_cluster_descriptors.js";
import type { TerrainSummaryField } from "../clod/terrain_summary_types.js";

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

function summaryField(coverageValue: number): TerrainSummaryField {
  const res = 4;
  const count = res * res;
  return {
    res,
    worldSize: 128,
    farReduceFactor: 1,
    heightMin: new Float32Array(count).fill(0),
    heightMax: new Float32Array(count).fill(8),
    normalX: new Float32Array(count),
    normalY: new Float32Array(count).fill(1),
    normalZ: new Float32Array(count),
    coverage: new Float32Array(count).fill(coverageValue),
  };
}

function missingHeightSummaryField(): TerrainSummaryField {
  const field = summaryField(1);
  field.heightMin.fill(Number.NaN);
  field.heightMax.fill(Number.NaN);
  return field;
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

  it("keeps clusters when terrain revision is stale by default", () => {
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

  it("rejects stale terrain revision when the caller requires fresh data", () => {
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

    expect(result).toMatchObject({ reject: true, reason: "summaryMissing", confidence: "fallback" });
  });

  it("rejects unknown sampled height when the caller requires summary data", () => {
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

    expect(result).toMatchObject({ reject: true, reason: "summaryMissing", confidence: "fallback" });
  });

  it("rejects missing far-summary heights when the caller requires known summary data", () => {
    const farSummaryProvider = createTerrainSummaryRejectProvider(() => missingHeightSummaryField());
    const result = createVegetationTerrainRejectProvider({ farSummaryProvider }).classifyCluster({
      descriptor: descriptor(),
      kind: "grass",
      cameraX: 0,
      cameraY: 2,
      cameraZ: 0,
      worldCells: 128,
      visibility,
      sampler: { sampleHeight: () => ({ height: 0 }) },
      acceptWhenSummaryMissing: false,
    });

    expect(result).toMatchObject({
      reject: true,
      reason: "summaryMissing",
      confidence: "summary",
      source: "naadfFarSummary",
    });
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

  it("does not reject far clusters as outsideTerrain in an unbounded (island) world", () => {
    // Same far cluster as above, but unbounded: island worlds have real terrain past worldCells, so
    // the box reject must not fire (the vegetation-vanishes-past-the-startup-box regression).
    const result = createVegetationTerrainRejectProvider().classifyCluster({
      descriptor: descriptor({ centerX: 4096, centerZ: 4096, halfSize: 4 }),
      kind: "grass",
      cameraX: 4096,
      cameraY: 2,
      cameraZ: 4096,
      worldCells: 128,
      unbounded: true,
      visibility,
      sampler: { sampleHeight: () => ({ height: 0 }) },
    });

    expect(result.reason).not.toBe("outsideTerrain");
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

  it("uses far-summary coverage as the first decisive rejection source", () => {
    const farSummaryProvider = createTerrainSummaryRejectProvider(() => summaryField(0));
    const result = createVegetationTerrainRejectProvider({ farSummaryProvider }).classifyCluster({
      descriptor: descriptor(),
      kind: "grass",
      cameraX: 0,
      cameraY: 2,
      cameraZ: 0,
      worldCells: 128,
      visibility,
      sampler: { sampleHeight: () => ({ height: 0 }) },
    });

    expect(result).toMatchObject({
      reject: true,
      reason: "noCoverage",
      confidence: "summary",
      source: "naadfFarSummary",
    });
  });

  it("falls through to the terrain sampler when far-summary data is not decisive", () => {
    const farSummaryProvider = createTerrainSummaryRejectProvider(() => summaryField(1));
    const result = createVegetationTerrainRejectProvider({ farSummaryProvider }).classifyCluster({
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

    expect(result).toMatchObject({
      reject: true,
      reason: "terrainHidden",
      source: "terrainVisibilitySampler",
    });
  });
});
