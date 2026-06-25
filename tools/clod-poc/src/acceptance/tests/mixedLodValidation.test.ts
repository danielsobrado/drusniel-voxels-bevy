import { describe, expect, it } from "vitest";
import { collectFineEdgeChain, validateIntervalCoverage, validateMixedLodCutForDelta } from "../borderValidation.js";
import { buildTolerances } from "../borderValidation.js";
import type { AcceptanceFailure } from "../acceptanceTypes.js";

const TEST_THRESHOLDS = {
  borderPositionEpsilon: 1e-6,
  borderNormalDotMin: 0.9999,
  borderMaterialWeightDeltaMax: 1e-4,
  lod3TriangleRatioMax: 0.15,
  lowBenefitRateMax: 0.1,
  fullHierarchyBuildMsMax: 8000,
  singleNodeRebuildMsMax: 80,
  densityScarScoreMax: 0.35,
  visualHolePixelRatioMax: 0,
  visualLipPixelRatioMax: 0,
  requireMeasuredSingleNodeRebuild: false,
};

const tolerances = buildTolerances(TEST_THRESHOLDS);

describe("validateIntervalCoverage", () => {
  it("fine intervals fully cover coarse span -> pass", () => {
    const intervals = [{ start: 0, end: 2 }, { start: 2, end: 4 }];
    const result = validateIntervalCoverage(intervals, 0, 4);
    expect(result.passes).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("empty intervals -> fail with MIXED_LOD_MISSING_FINE_SEGMENT", () => {
    const result = validateIntervalCoverage([], 0, 4);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f: AcceptanceFailure) => f.code === "MIXED_LOD_MISSING_FINE_SEGMENT")).toBe(true);
  });

  it("gap between intervals -> fail with MIXED_LOD_COVERAGE_GAP", () => {
    const intervals = [{ start: 0, end: 1.5 }, { start: 2.5, end: 4 }];
    const result = validateIntervalCoverage(intervals, 0, 4);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f: AcceptanceFailure) => f.code === "MIXED_LOD_COVERAGE_GAP")).toBe(true);
  });

  it("overlapping intervals -> fail with MIXED_LOD_EDGE_OVERLAP", () => {
    const intervals = [{ start: 0, end: 3 }, { start: 2, end: 4 }];
    const result = validateIntervalCoverage(intervals, 0, 4);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f: AcceptanceFailure) => f.code === "MIXED_LOD_EDGE_OVERLAP")).toBe(true);
  });

  it("interval starts after span start -> fail with MIXED_LOD_COVERAGE_GAP", () => {
    const intervals = [{ start: 1, end: 4 }];
    const result = validateIntervalCoverage(intervals, 0, 4);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f: AcceptanceFailure) => f.code === "MIXED_LOD_COVERAGE_GAP")).toBe(true);
  });

  it("interval ends before span end -> fail with MIXED_LOD_COVERAGE_GAP", () => {
    const intervals = [{ start: 0, end: 3 }];
    const result = validateIntervalCoverage(intervals, 0, 4);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f: AcceptanceFailure) => f.code === "MIXED_LOD_COVERAGE_GAP")).toBe(true);
  });
});

describe("validateMixedLodCutForDelta", () => {
  it("empty nodesByLevel produces empty result", () => {
    const result = validateMixedLodCutForDelta(new Map(), 1, tolerances, "test");
    expect(result.passes).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.edgesTested).toBe(0);
  });

  it("untestable delta (no matching levels) produces no failures", () => {
    const nodesByLevel = new Map<number, any[]>();
    nodesByLevel.set(1, []);
    const result = validateMixedLodCutForDelta(nodesByLevel, 10, tolerances, "test");
    expect(result.edgesTested).toBe(0);
    expect(result.passes).toBe(true);
  });
});

describe("collectFineEdgeChain", () => {
  it("empty mesh produces empty chain", () => {
    const mockNode = {
      mesh: {
        positions: new Float32Array([]),
        normals: new Float32Array([]),
        paintSlots: new Float32Array([]),
        materialWeights: new Float32Array([]),
        materialWeightStride: 4,
        indices: new Uint32Array([]),
      },
      footprint: { minX: 0, minZ: 0, maxX: 4, maxZ: 4 },
      id: "L1:0,0",
      level: 1,
      children: [],
      bounds: { center: [2, 0, 2] as [number, number, number], radius: 4, minY: 0, maxY: 0 },
      errorWorld: 0,
      lowBenefit: false,
    };

    const chain = collectFineEdgeChain(mockNode, "x", 4);
    expect(Array.isArray(chain.positions)).toBe(true);
  });
});
