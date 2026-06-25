import { describe, expect, it } from "vitest";
import { compareBorderChains, buildTolerances, validateWatertightCut } from "../borderValidation.js";

const DEFAULT_THRESHOLDS = {
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
};

const tolerances = buildTolerances(DEFAULT_THRESHOLDS);

function makeChain(positions: [number, number, number][], normals?: [number, number, number][], materials?: number[], materialWeights?: number[][]) {
  return {
    positions,
    normals: normals ?? positions.map(() => [0, 1, 0] as [number, number, number]),
    materials: materials ?? positions.map(() => 0),
    materialWeights: materialWeights ?? positions.map(() => [1, 0, 0, 0]),
  };
}

describe("compareBorderChains", () => {
  it("equal chains pass", () => {
    const chain = makeChain(
      [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
      [[0, 1, 0], [0, 1, 0], [0, 1, 0]],
      [0, 0, 0],
      [[1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]],
    );
    const result = compareBorderChains(chain, chain, tolerances);
    expect(result.passes).toBe(true);
    expect(result.maxPositionDelta).toBe(0);
    expect(result.minNormalDot).toBe(1);
    expect(result.maxMaterialWeightDelta).toBe(0);
    expect(result.failures).toHaveLength(0);
  });

  it("position mismatch fails", () => {
    const left = makeChain([[0, 0, 0], [1, 0, 0]]);
    const right = makeChain([[0, 0, 0], [1.001, 0, 0]]);
    const result = compareBorderChains(left, right, tolerances);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f) => f.code === "BORDER_POSITION_MISMATCH")).toBe(true);
  });

  it("normal mismatch fails", () => {
    const left = makeChain(
      [[0, 0, 0], [1, 0, 0]],
      [[0, 1, 0], [0, 1, 0]],
    );
    const right = makeChain(
      [[0, 0, 0], [1, 0, 0]],
      [[0, 0.5, 0.866], [0, 1, 0]],
    );
    const result = compareBorderChains(left, right, tolerances);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f) => f.code === "BORDER_NORMAL_MISMATCH")).toBe(true);
  });

  it("material mismatch fails", () => {
    const left = makeChain(
      [[0, 0, 0], [1, 0, 0]],
      [[0, 1, 0], [0, 1, 0]],
      [0, 0],
    );
    const right = makeChain(
      [[0, 0, 0], [1, 0, 0]],
      [[0, 1, 0], [0, 1, 0]],
      [0, 1],
    );
    const result = compareBorderChains(left, right, tolerances);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f) => f.code === "BORDER_MATERIAL_MISMATCH")).toBe(true);
  });

  it("chain length mismatch fails", () => {
    const left = makeChain([[0, 0, 0], [1, 0, 0]]);
    const right = makeChain([[0, 0, 0]]);
    const result = compareBorderChains(left, right, tolerances);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f) => f.code === "BORDER_CHAIN_LENGTH_MISMATCH")).toBe(true);
  });

  it("coverage gap is reported", () => {
    const left = makeChain([[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
    const right = makeChain([[0, 0, 0], [1, 0, 0]]);
    const result = compareBorderChains(left, right, tolerances);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f) => f.code === "BORDER_CHAIN_LENGTH_MISMATCH")).toBe(true);
  });
});

describe("validateWatertightCut", () => {
  it("empty nodesByLevel produces no failures", () => {
    const result = validateWatertightCut(new Map(), tolerances);
    expect(result.passes).toBe(true);
    expect(result.failures).toHaveLength(0);
  });
});
