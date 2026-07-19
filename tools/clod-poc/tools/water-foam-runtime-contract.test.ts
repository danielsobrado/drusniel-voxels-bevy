import { describe, expect, it } from "vitest";
import type { WaterFoamRuntimeDiagnostics } from "../src/water/water_foam_diagnostics.js";
import { evaluateWaterFoamRuntimeContract } from "./water-foam-runtime-contract.js";

function diagnostics(
  overrides: Partial<WaterFoamRuntimeDiagnostics> = {},
): WaterFoamRuntimeDiagnostics {
  return {
    modelRevision: 3,
    modelName: "coherent-fbm-flow-sun-v3",
    qualityTier: "high",
    maxCoverage: 0.52,
    patternStart: 0.52,
    patternEnd: 0.88,
    shoreDistanceWeight: 0.35,
    riverShoreAttenuation: 0.28,
    shadeCoverageFloor: 0.55,
    rapidEligibility: "speed-times-drop-times-river",
    cpuFieldSamples: 0,
    sunAtlas: {
      valid: 1,
      version: 4,
      originX: 0,
      originZ: 0,
      worldSize: 768,
      width: 192,
      height: 192,
    },
    ...overrides,
  };
}

describe("water foam runtime contract", () => {
  it("accepts the expected HQ runtime", () => {
    expect(evaluateWaterFoamRuntimeContract("high", diagnostics()).passed).toBe(true);
  });

  it("accepts the expected performance runtime", () => {
    const result = evaluateWaterFoamRuntimeContract("low", diagnostics({ qualityTier: "low" }));
    expect(result.passed).toBe(true);
  });

  it("rejects a stale foam model or wrong material tier", () => {
    const result = evaluateWaterFoamRuntimeContract("low", diagnostics({
      modelRevision: 2,
      qualityTier: "high",
    }));

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/model revision/);
    expect(result.failures.join("\n")).toMatch(/quality tier/);
  });

  it("rejects an unavailable sun atlas or CPU sampling", () => {
    const base = diagnostics();
    const result = evaluateWaterFoamRuntimeContract("high", {
      ...base,
      cpuFieldSamples: 1,
      sunAtlas: { ...base.sunAtlas, valid: 0, version: 0, width: 1, height: 1 },
    } as WaterFoamRuntimeDiagnostics);

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/CPU field samples/);
    expect(result.failures.join("\n")).toMatch(/sun atlas valid/);
    expect(result.failures.join("\n")).toMatch(/sun atlas version/);
  });
});
