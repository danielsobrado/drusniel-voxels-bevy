import { describe, expect, it } from "vitest";
import { getWaterFoamRuntimeDiagnostics } from "./water_foam_diagnostics.js";

describe("water foam runtime diagnostics", () => {
  it("reports the HQ material tier and fixed model contract", () => {
    const result = getWaterFoamRuntimeDiagnostics(new URLSearchParams("waterQuality=high&waterPerf=0"));

    expect(result.modelRevision).toBe(3);
    expect(result.modelName).toBe("coherent-fbm-flow-sun-v3");
    expect(result.qualityTier).toBe("high");
    expect(result.maxCoverage).toBe(0.52);
    expect(result.shadeCoverageFloor).toBe(0.55);
    expect(result.cpuFieldSamples).toBe(0);
  });

  it("reports the forced performance tier", () => {
    const result = getWaterFoamRuntimeDiagnostics(new URLSearchParams("waterQuality=high&waterPerf=1"));
    expect(result.qualityTier).toBe("low");
  });

  it("includes finite sun-atlas diagnostics", () => {
    const result = getWaterFoamRuntimeDiagnostics(new URLSearchParams());

    expect(Number.isFinite(result.sunAtlas.version)).toBe(true);
    expect(Number.isFinite(result.sunAtlas.worldSize)).toBe(true);
    expect(result.sunAtlas.width).toBeGreaterThanOrEqual(1);
    expect(result.sunAtlas.height).toBeGreaterThanOrEqual(1);
  });
});
