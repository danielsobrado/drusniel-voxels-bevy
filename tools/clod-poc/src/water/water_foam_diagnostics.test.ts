import { describe, expect, it } from "vitest";
import { publishWaterFoamDistanceFade } from "./water_foam_distance.js";
import { getWaterFoamRuntimeDiagnostics } from "./water_foam_diagnostics.js";

describe("water foam runtime diagnostics", () => {
  it("reports the HQ material tier and v4 model contract", () => {
    publishWaterFoamDistanceFade({ detailFadeStartM: 120, detailFadeEndM: 320 });
    const result = getWaterFoamRuntimeDiagnostics(new URLSearchParams("waterQuality=high&waterPerf=0"));

    expect(result.modelRevision).toBe(4);
    expect(result.modelName).toBe("coherent-fbm-flow-sun-distance-v4");
    expect(result.qualityTier).toBe("high");
    expect(result.maxCoverage).toBe(0.52);
    expect(result.shadeCoverageFloor).toBe(0.55);
    expect(result.cpuFieldSamples).toBe(0);
    expect(result.distanceFade).toMatchObject({
      valid: true,
      startM: 120,
      endM: 320,
      authority: "camera-distance-shared",
    });
    expect(result.distanceFade.version).toBeGreaterThanOrEqual(1);
  });

  it("reports the forced performance tier", () => {
    const result = getWaterFoamRuntimeDiagnostics(new URLSearchParams("waterPerf=1"));
    expect(result.qualityTier).toBe("low");
  });

  it("reports an explicit high-tier override in performance mode", () => {
    const result = getWaterFoamRuntimeDiagnostics(new URLSearchParams("waterQuality=high&waterPerf=1"));
    expect(result.qualityTier).toBe("high");
  });

  it("includes finite sun-atlas diagnostics", () => {
    const result = getWaterFoamRuntimeDiagnostics(new URLSearchParams());

    expect(Number.isFinite(result.sunAtlas.version)).toBe(true);
    expect(Number.isFinite(result.sunAtlas.worldSize)).toBe(true);
    expect(result.sunAtlas.width).toBeGreaterThanOrEqual(1);
    expect(result.sunAtlas.height).toBeGreaterThanOrEqual(1);
  });
});
