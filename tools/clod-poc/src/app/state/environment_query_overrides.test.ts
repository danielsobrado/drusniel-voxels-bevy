import { describe, expect, it } from "vitest";
import { applyEnvironmentQueryOverrides } from "./environment_query_overrides.js";

function createState() {
  return {
    sunElevationDeg: 45,
    sunAzimuthDeg: 120,
    sunIntensity: 1,
    skyIntensity: 1,
    groundIntensity: 1,
    exposure: 1,
    hazeIntensity: 0.2,
    profileEnabled: false,
    postProcessQualityPreset: "custom",
    postProcessEnabled: true,
    postProcessDebugMode: "output",
    postProcessToneMapping: "aces",
    postProcessRenderScale: 1,
    postProcessExposure: 1,
    postProcessContrast: 1,
    postProcessSaturation: 1,
    postProcessVignette: 0,
    postProcessBloomEnabled: true,
    postProcessFxaaEnabled: true,
    postProcessTaaEnabled: false,
    postProcessTaaJitterEnabled: true,
    postProcessTaaHistoryClampEnabled: true,
    postProcessContactShadowsEnabled: false,
    postProcessClarityEnabled: true,
    postProcessAerialPerspectiveEnabled: true,
    godRaysMode: "off",
    treeDistance: 620,
    treeMaxInstances: 9000,
    treeDensity: 1.2,
    treeSpacing: 5.5,
    treeGpuMaxVisible: 50_000,
  };
}

describe("environment query overrides", () => {
  it("applies finite lighting overrides", () => {
    const state = createState();
    const params = new URLSearchParams({
      sunElevationDeg: "8",
      sunAzimuthDeg: "-122",
      sunIntensity: "2.5",
      skyIntensity: "0.7",
      groundIntensity: "0.4",
      exposure: "1.2",
      hazeIntensity: "0.9",
    });

    applyEnvironmentQueryOverrides(state as never, params);

    expect(state.sunElevationDeg).toBe(8);
    expect(state.sunAzimuthDeg).toBe(238);
    expect(state.sunIntensity).toBe(2.5);
    expect(state.skyIntensity).toBe(0.7);
    expect(state.groundIntensity).toBe(0.4);
    expect(state.exposure).toBe(1.2);
    expect(state.hazeIntensity).toBe(0.9);
  });

  it("clamps unsafe values and ignores non-finite values", () => {
    const state = createState();
    const params = new URLSearchParams({
      sunElevationDeg: "200",
      sunAzimuthDeg: "725",
      sunIntensity: "-5",
      exposure: "bad",
    });

    applyEnvironmentQueryOverrides(state as never, params);

    expect(state.sunElevationDeg).toBe(90);
    expect(state.sunAzimuthDeg).toBe(5);
    expect(state.sunIntensity).toBe(0);
    expect(state.exposure).toBe(1);
  });

  it("applies quality preset tree settings and then manual tree overrides", () => {
    const state = createState();
    const params = new URLSearchParams({
      quality: "perf",
      treeRing: "360",
      treeMax: "4000",
      treeDensity: "0.7",
      treeSpacing: "8",
      treeGpuMax: "12000",
    });

    applyEnvironmentQueryOverrides(state as never, params);

    expect(state.postProcessQualityPreset).toBe("perf");
    expect(state.postProcessRenderScale).toBe(0.75);
    expect(state.treeDistance).toBe(360);
    expect(state.treeMaxInstances).toBe(4000);
    expect(state.treeDensity).toBe(0.7);
    expect(state.treeSpacing).toBe(8);
    expect(state.treeGpuMaxVisible).toBe(12000);
  });
});
