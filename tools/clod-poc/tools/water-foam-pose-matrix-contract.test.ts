import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MATRIX_SOURCE = readFileSync(new URL("./water-foam-quality-matrix.ts", import.meta.url), "utf8");
const RUNNER_SOURCE = readFileSync(new URL("./water-foam-visual-acceptance.ts", import.meta.url), "utf8");

describe("water foam quality matrix pose contract", () => {
  it("makes the first quality tier the canonical pose authority", () => {
    expect(MATRIX_SOURCE).toContain("canonicalReportPath = reportPath");
    expect(MATRIX_SOURCE).toContain("canonicalPoses = poses");
  });

  it("passes the canonical report to following tiers", () => {
    expect(MATRIX_SOURCE).toContain("--pose-report=${canonicalReportPath}");
    expect(RUNNER_SOURCE).toContain('args["pose-report"]');
    expect(RUNNER_SOURCE).toContain("extractWaterFoamAcceptancePoses");
  });

  it("fails the matrix when quality-tier poses drift", () => {
    expect(MATRIX_SOURCE).toContain("assertWaterFoamAcceptancePosesMatch");
    expect(MATRIX_SOURCE).toContain("report.passed && report.poseParity");
  });
});
