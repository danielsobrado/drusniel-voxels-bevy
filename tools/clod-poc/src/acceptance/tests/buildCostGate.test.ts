import { describe, expect, it } from "vitest";
import { percentile, runFullHierarchyBuild, runGateA5 } from "../buildCostGate.js";
import type { BuildStats } from "../../clod/stats.js";
import type { AcceptanceConfig } from "../acceptanceTypes.js";

describe("percentile", () => {
  it("returns correct p50 for even count", () => {
    const values = [1, 2, 3, 4, 5, 6];
    expect(percentile(values, 50)).toBe(3);
  });

  it("returns correct p50 for odd count", () => {
    const values = [1, 2, 3, 4, 5];
    expect(percentile(values, 50)).toBe(3);
  });

  it("returns correct p95", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 95)).toBe(100);
  });

  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe("runFullHierarchyBuild", () => {
  it("returns measured timings from repeated builds", () => {
    let callCount = 0;
    const fakeBuild = () => {
      callCount++;
      return {
        stats: {
          totalBuildMs: callCount * 100,
          levels: [],
        } as BuildStats,
      };
    };

    const result = runFullHierarchyBuild(fakeBuild, 2, 3);
    expect(callCount).toBe(5);
    expect(result.timings).toHaveLength(3);
    expect(result.allStats).toHaveLength(3);
  });

  it("p50 and p95 come from measured samples, not level stats", () => {
    const timings: number[] = [];
    const fakeBuild = () => {
      const t = 100 + timings.length * 10;
      timings.push(t);
      return {
        stats: {
          totalBuildMs: t,
          levels: [],
        } as BuildStats,
      };
    };

    const result = runFullHierarchyBuild(fakeBuild, 0, 5);
    expect(result.timings).toHaveLength(5);
    const p50 = percentile(result.timings, 50);
    const p95 = percentile(result.timings, 95);
    expect(p50).toBeGreaterThan(0);
    expect(p95).toBeGreaterThanOrEqual(p50);
  });
});

describe("runGateA5", () => {
  function makeConfig(overrides?: Partial<AcceptanceConfig>): AcceptanceConfig {
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
      ...overrides,
    };
  }

  it("reports warn when singleNodeRebuild is not measured", () => {
    const config = makeConfig();
    const metrics = {
      fullHierarchyBuildMs: 1000,
      fullHierarchyBuildRuns: 8,
      fullHierarchyWarmupRuns: 3,
      fullHierarchyMeasuredRuns: 5,
      fullHierarchyBuildMsMin: 900,
      fullHierarchyBuildMsP50: 1000,
      fullHierarchyBuildMsP95: 1100,
      singleNodeRebuildMeasured: false,
      singleNodeRebuildMsMin: 10,
      singleNodeRebuildMsP50: 12,
      singleNodeRebuildMsP95: 45,
      weldMsP95: 0,
      simplifyMsP95: 0,
      validationMsP95: 0,
      slowestNodes: [],
    };

    const result = runGateA5(new Map(), config, metrics, "test");
    expect(result.status).toBe("warn");
    expect(result.measurements.singleNodeRebuildMeasured).toBe(false);
  });

  it("fails when full build exceeds threshold", () => {
    const config = makeConfig();
    const metrics = {
      fullHierarchyBuildMs: 99999,
      fullHierarchyBuildRuns: 8,
      fullHierarchyWarmupRuns: 3,
      fullHierarchyMeasuredRuns: 5,
      fullHierarchyBuildMsMin: 50000,
      fullHierarchyBuildMsP50: 99999,
      fullHierarchyBuildMsP95: 100000,
      singleNodeRebuildMeasured: false,
      singleNodeRebuildMsMin: 10,
      singleNodeRebuildMsP50: 12,
      singleNodeRebuildMsP95: 45,
      weldMsP95: 0,
      simplifyMsP95: 0,
      validationMsP95: 0,
      slowestNodes: [],
    };

    const result = runGateA5(new Map(), config, metrics, "test");
    expect(result.status).toBe("fail");
  });

  it("measures include fullHierarchyBuildRuns, warmup, and measured counts", () => {
    const config = makeConfig();
    const metrics = {
      fullHierarchyBuildMs: 1000,
      fullHierarchyBuildRuns: 8,
      fullHierarchyWarmupRuns: 3,
      fullHierarchyMeasuredRuns: 5,
      fullHierarchyBuildMsMin: 900,
      fullHierarchyBuildMsP50: 1000,
      fullHierarchyBuildMsP95: 1100,
      singleNodeRebuildMeasured: false,
      singleNodeRebuildMsMin: 10,
      singleNodeRebuildMsP50: 12,
      singleNodeRebuildMsP95: 45,
      weldMsP95: 0,
      simplifyMsP95: 0,
      validationMsP95: 0,
      slowestNodes: [],
    };

    const result = runGateA5(new Map(), config, metrics, "test");
    expect(result.measurements.fullHierarchyBuildRuns).toBe(8);
    expect(result.measurements.fullHierarchyWarmupRuns).toBe(3);
    expect(result.measurements.fullHierarchyMeasuredRuns).toBe(5);
  });
});
