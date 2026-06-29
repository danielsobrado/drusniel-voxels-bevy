import { describe, expect, it } from "vitest";
import {
  computeTreeImpostorPerfSpeedup,
  defaultTreeImpostorAcceptanceThresholds,
  evaluateTreeImpostorAcceptance,
  type TreeImpostorPerfSample,
  type TreeImpostorVisualSample,
} from "./tree_impostor_acceptance.js";

function passingVisualSample(): TreeImpostorVisualSample {
  return {
    luminanceMean: 0.5,
    luminanceStdDev: 0.08,
    maxViewBlendDelta: 0.05,
    nearImpostorColorDelta: 0.08,
    boundaryHoleRatio: 0,
    boundaryDoubleDrawRatio: 0,
  };
}

function passingPerfSample(): TreeImpostorPerfSample {
  return {
    baselineFrameMsP95: 18,
    impostorFrameMsP95: 12,
  };
}

describe("tree impostor acceptance metrics", () => {
  it("passes for lit, stable, faster impostor samples", () => {
    const report = evaluateTreeImpostorAcceptance(passingVisualSample(), passingPerfSample());

    expect(report.status).toBe("pass");
    expect(report.failures).toHaveLength(0);
    expect(report.measurements.perfSpeedup).toBeCloseTo(1.5);
  });

  it("fails flat impostor lighting", () => {
    const visual = { ...passingVisualSample(), luminanceStdDev: 0.005 };
    const report = evaluateTreeImpostorAcceptance(visual, passingPerfSample());

    expect(report.status).toBe("fail");
    expect(report.failures.map((failure) => failure.code)).toContain("TREE_IMPOSTOR_FLAT_LIGHTING");
  });

  it("fails view-blend popping", () => {
    const visual = { ...passingVisualSample(), maxViewBlendDelta: 0.4 };
    const report = evaluateTreeImpostorAcceptance(visual, passingPerfSample());

    expect(report.status).toBe("fail");
    expect(report.failures.map((failure) => failure.code)).toContain("TREE_IMPOSTOR_VIEW_BLEND_POP");
  });

  it("fails near mesh versus impostor color mismatch", () => {
    const visual = { ...passingVisualSample(), nearImpostorColorDelta: 0.5 };
    const report = evaluateTreeImpostorAcceptance(visual, passingPerfSample());

    expect(report.status).toBe("fail");
    expect(report.failures.map((failure) => failure.code)).toContain("TREE_IMPOSTOR_NEAR_COLOR_MISMATCH");
  });

  it("fails holes or double draw at the far-to-impostor boundary", () => {
    const visual = { ...passingVisualSample(), boundaryHoleRatio: 0.001, boundaryDoubleDrawRatio: 0.002 };
    const report = evaluateTreeImpostorAcceptance(visual, passingPerfSample());

    expect(report.status).toBe("fail");
    expect(report.failures.map((failure) => failure.code)).toContain("TREE_IMPOSTOR_BOUNDARY_HOLES");
    expect(report.failures.map((failure) => failure.code)).toContain("TREE_IMPOSTOR_BOUNDARY_DOUBLE_DRAW");
  });

  it("fails if the impostor path is not faster than baseline", () => {
    const report = evaluateTreeImpostorAcceptance(passingVisualSample(), {
      baselineFrameMsP95: 12,
      impostorFrameMsP95: 12,
    });

    expect(report.status).toBe("fail");
    expect(report.failures.map((failure) => failure.code)).toContain("TREE_IMPOSTOR_PERF_REGRESSION");
  });

  it("uses stable default thresholds for TREE-11", () => {
    const thresholds = defaultTreeImpostorAcceptanceThresholds();

    expect(thresholds.minLightVariation).toBeGreaterThan(0);
    expect(thresholds.maxViewBlendDelta).toBeGreaterThan(0);
    expect(thresholds.maxNearColorDelta).toBeGreaterThan(0);
    expect(thresholds.minPerfSpeedup).toBeGreaterThan(1);
    expect(thresholds.maxBoundaryHoleRatio).toBe(0);
    expect(thresholds.maxBoundaryDoubleDrawRatio).toBe(0);
  });

  it("guards invalid perf samples", () => {
    expect(computeTreeImpostorPerfSpeedup({ baselineFrameMsP95: 0, impostorFrameMsP95: 12 })).toBe(0);
    expect(computeTreeImpostorPerfSpeedup({ baselineFrameMsP95: 12, impostorFrameMsP95: 0 })).toBe(0);
    expect(computeTreeImpostorPerfSpeedup({ baselineFrameMsP95: Number.NaN, impostorFrameMsP95: 12 })).toBe(0);
  });
});
