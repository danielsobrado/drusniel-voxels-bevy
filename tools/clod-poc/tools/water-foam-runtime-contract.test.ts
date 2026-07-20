import { describe, expect, it } from "vitest";
import type { WaterFoamRuntimeDiagnostics } from "../src/water/water_foam_diagnostics.js";
import { evaluateWaterFoamRuntimeContract } from "./water-foam-runtime-contract.js";

function diagnostics(
  overrides: Partial<WaterFoamRuntimeDiagnostics> = {},
): WaterFoamRuntimeDiagnostics {
  return {
    modelRevision: 5,
    modelName: "coherent-fbm-flow-sun-distance-v5",
    qualityTier: "high",
    maxCoverage: 0.68,
    patternStart: 0.42,
    patternEnd: 0.85,
    shoreDistanceWeight: 0.35,
    riverShoreAttenuation: 0.28,
    shadeCoverageFloor: 0.55,
    rapidEligibility: "speed-times-drop-times-river",
    cpuFieldSamples: 0,
    webGpuUncapturedErrors: 0,
    distanceFade: {
      valid: true,
      version: 2,
      startM: 120,
      endM: 320,
      authority: "camera-distance-shared",
    },
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
    expect(evaluateWaterFoamRuntimeContract("low", diagnostics({ qualityTier: "low" })).passed).toBe(true);
  });

  it("rejects a stale model or wrong tier", () => {
    const result = evaluateWaterFoamRuntimeContract("low", diagnostics({ modelRevision: 4, qualityTier: "high" }));

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/model revision/);
    expect(result.failures.join("\n")).toMatch(/quality tier/);
  });

  it("rejects an unavailable or invalid distance fade", () => {
    const base = diagnostics();
    const result = evaluateWaterFoamRuntimeContract("high", {
      ...base,
      distanceFade: {
        ...base.distanceFade,
        valid: false,
        version: 0,
        startM: 320,
        endM: 120,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/distance fade valid/);
    expect(result.failures.join("\n")).toMatch(/distance fade version/);
    expect(result.failures.join("\n")).toMatch(/distance fade end/);
  });

  it("rejects an unavailable sun atlas or CPU sampling", () => {
    const base = diagnostics();
    const result = evaluateWaterFoamRuntimeContract("high", {
      ...base,
      cpuFieldSamples: 1,
      sunAtlas: { ...base.sunAtlas, valid: 0, version: 0, width: 1, height: 1 },
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/CPU field samples/);
    expect(result.failures.join("\n")).toMatch(/sun atlas valid/);
  });

  it("rejects any session-cumulative WebGPU uncaptured error", () => {
    const result = evaluateWaterFoamRuntimeContract("high", diagnostics({
      webGpuUncapturedErrors: 1,
    }));

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/WebGPU uncaptured errors 1 did not equal 0/);
  });
});
