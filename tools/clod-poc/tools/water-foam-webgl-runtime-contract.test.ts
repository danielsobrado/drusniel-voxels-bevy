import { describe, expect, it } from "vitest";
import { getWaterFoamRuntimeDiagnostics } from "../src/water/water_foam_diagnostics.js";
import { evaluateWaterFoamWebGlRuntimeContract } from "./water-foam-webgl-runtime-contract.js";

describe("WebGL water foam runtime contract", () => {
  it("accepts the current default foam authority without requiring a sun atlas", () => {
    const diagnostics = getWaterFoamRuntimeDiagnostics(new URLSearchParams("waterQuality=high&waterPerf=0"));
    const result = evaluateWaterFoamWebGlRuntimeContract("high", {
      ...diagnostics,
      sunAtlas: {
        ...diagnostics.sunAtlas,
        valid: 0,
        version: 0,
        width: 1,
        height: 1,
      },
    });

    expect(result.passed).toBe(true);
  });

  it("accepts the low configuration tier when explicitly requested", () => {
    const diagnostics = getWaterFoamRuntimeDiagnostics(new URLSearchParams("waterQuality=low&waterPerf=1"));
    expect(evaluateWaterFoamWebGlRuntimeContract("low", diagnostics).passed).toBe(true);
  });

  it("does not gate the WebGPU-only uncaptured-error counter", () => {
    const diagnostics = getWaterFoamRuntimeDiagnostics(new URLSearchParams("waterQuality=high"));
    const result = evaluateWaterFoamWebGlRuntimeContract("high", {
      ...diagnostics,
      webGpuUncapturedErrors: 3,
    });

    expect(result.passed).toBe(true);
  });

  it("rejects stale foam authority, wrong tier, or CPU sampling", () => {
    const diagnostics = getWaterFoamRuntimeDiagnostics(new URLSearchParams("waterQuality=high"));
    const result = evaluateWaterFoamWebGlRuntimeContract("low", {
      ...diagnostics,
      modelRevision: diagnostics.modelRevision - 1,
      cpuFieldSamples: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/model revision/);
    expect(result.failures.join("\n")).toMatch(/quality tier/);
    expect(result.failures.join("\n")).toMatch(/CPU field samples/);
  });
});
