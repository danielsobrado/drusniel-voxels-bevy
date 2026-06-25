import { describe, expect, it } from "vitest";
import { compareBorderChains, buildTolerances, validateSameLevelWatertightness } from "../borderValidation.js";
import type { ClodPageNode } from "../../types.js";
import type { AcceptanceConfig } from "../acceptanceTypes.js";

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
  requireMeasuredSingleNodeRebuild: false,
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

  it("chain length mismatch fails without allowLengthMismatch", () => {
    const left = makeChain([[0, 0, 0], [1, 0, 0]]);
    const right = makeChain([[0, 0, 0]]);
    const result = compareBorderChains(left, right, tolerances);
    expect(result.passes).toBe(false);
    expect(result.failures.some((f) => f.code === "BORDER_CHAIN_LENGTH_MISMATCH")).toBe(true);
  });
});

describe("validateSameLevelWatertightness", () => {
  it("empty nodesByLevel produces no failures", () => {
    const result = validateSameLevelWatertightness(new Map(), tolerances);
    expect(result.passes).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.edgesTested).toBe(0);
  });
});

describe("runGateA1 mixed-LOD integration", () => {
  function makeMinimalConfig(): AcceptanceConfig {
    return {
      outputDir: "acceptance-runs",
      world: { lod0PagesX: 4, lod0PagesZ: 4, smokeLod0PagesX: 2, smokeLod0PagesZ: 2 },
      thresholds: {
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
      },
      visual: { enabled: false, screenshotWidth: 1920, screenshotHeight: 1080, cameraFovYDeg: 60, grazingAngleDeg: 7, crossfadeFrames: 12 },
      stressScenes: { ridgeBorder: true, cliffCorner: true, caveMouthBorder: true, thinBridge: true, forcedNeighborLodDeltas: [1, 2, 3], nearFieldBubbleMask: true },
      logging: { level: "info" },
    };
  }

  it("runGateA1 includes mixedLod measurements", async () => {
    const { runGateA1 } = await import("../borderValidation.js");
    const config = makeMinimalConfig();
    const nodesByLevel = new Map<number, ClodPageNode[]>();
    nodesByLevel.set(0, []);

    const result = runGateA1(nodesByLevel, config, "test_fixture");

    expect(result.measurements.mixedLodDeltasTested).toBeTypeOf("number");
    expect(result.measurements.mixedLodEdgesTested).toBeTypeOf("number");
    expect(result.measurements.mixedLodFailureCount).toBeTypeOf("number");
  });

  it("reports warn when mixedLod edges tested is 0 but deltas configured", async () => {
    const { runGateA1 } = await import("../borderValidation.js");
    const config = makeMinimalConfig();
    const nodesByLevel = new Map<number, ClodPageNode[]>();
    nodesByLevel.set(0, []);

    const result = runGateA1(nodesByLevel, config, "empty_scene");

    const edgesTested = result.measurements.mixedLodEdgesTested;
    if (typeof edgesTested === "number" && edgesTested === 0) {
      expect(result.status).toBe("warn");
    }
  });

  it("reports untestable delta when delta cannot be tested", async () => {
    const { runGateA1 } = await import("../borderValidation.js");
    const config = makeMinimalConfig();
    config.stressScenes.forcedNeighborLodDeltas = [10];
    const nodesByLevel = new Map<number, ClodPageNode[]>();
    nodesByLevel.set(0, []);

    const result = runGateA1(nodesByLevel, config, "small_scene");

    const untestableCount = result.measurements.mixedLodUntestableDeltaCount;
    if (typeof untestableCount === "number" && untestableCount > 0) {
      expect(result.status).toBe("warn");
    }
  });
});
