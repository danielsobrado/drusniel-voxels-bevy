import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MATRIX_SOURCE = readFileSync(new URL("./water-foam-quality-matrix.ts", import.meta.url), "utf8");

describe("water foam cross-tier matrix contract", () => {
  it("extracts metrics from both quality reports", () => {
    expect(MATRIX_SOURCE).toContain("extractWaterFoamAcceptanceMetrics");
    expect(MATRIX_SOURCE).toContain('metricsByQuality.get("high")');
    expect(MATRIX_SOURCE).toContain('metricsByQuality.get("low")');
  });

  it("fails the matrix when direct quality parity fails", () => {
    expect(MATRIX_SOURCE).toContain("evaluateWaterFoamQualityParity");
    expect(MATRIX_SOURCE).toContain("&& qualityParity.passed");
    expect(MATRIX_SOURCE).toContain("cross-tier:");
  });
});
