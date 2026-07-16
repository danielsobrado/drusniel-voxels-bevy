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
    postProcessCloudsEnabled: true,
    postProcessGtaoEnabled: true,
    postProcessFroxelsEnabled: true,
    postProcessBounceEnabled: true,
    froxelDebugEnabled: false,
    froxelDebugMode: "off",
    godRaysMode: "off",
    treeQualityPreset: "custom",
    treeDistance: 620,
    treeMaxInstances: 9000,
    treeDensity: 1.2,
    treeSpacing: 5.5,
    treeShadowMaxLod: "mid",
    treeWindEnabled: true,
    treeWindStrength: 0.18,
    grassWindStrength: 0.12,
    grassWindSpeed: 1.2,
    treeGustStrength: 0.12,
    treeTrunkSwayStrength: 0.45,
    treeLeafFlutterStrength: 0.18,
    treeFarCheapMaterial: true,
    treeImpostorSwapOnBake: true,
    treeGpuEnabled: false,
    treeGpuFallbackToCpu: true,
    treeGpuForceCpu: true,
    treeGpuShowCounts: true,
    treeGpuReadbackVisibleLists: true,
    treeGpuValidateAgainstCpu: true,
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
      treeShadowMaxLod: "none",
    });

    applyEnvironmentQueryOverrides(state as never, params);

    expect(state.postProcessQualityPreset).toBe("perf");
    expect(state.postProcessRenderScale).toBe(0.75);
    expect(state.treeQualityPreset).toBe("perf");
    expect(state.treeDistance).toBe(360);
    expect(state.treeMaxInstances).toBe(4000);
    expect(state.treeDensity).toBe(0.7);
    expect(state.treeSpacing).toBe(8);
    expect(state.treeShadowMaxLod).toBe("none");
    expect(state.treeWindEnabled).toBe(false);
    expect(state.treeGpuEnabled).toBe(true);
    expect(state.treeGpuFallbackToCpu).toBe(true);
    expect(state.treeGpuForceCpu).toBe(false);
    expect(state.treeGpuShowCounts).toBe(false);
    expect(state.treeGpuReadbackVisibleLists).toBe(false);
    expect(state.treeGpuValidateAgainstCpu).toBe(false);
    expect(state.treeGpuMaxVisible).toBe(12000);
  });

  it("lets explicit tree GPU debug URL flags override preset defaults", () => {
    const state = createState();
    const params = new URLSearchParams({
      quality: "perf",
      treeGpu: "0",
      treeGpuFallback: "0",
      treeGpuForceCpu: "1",
      treeGpuCounts: "1",
      treeGpuReadback: "1",
      treeGpuValidate: "1",
    });

    applyEnvironmentQueryOverrides(state as never, params);

    expect(state.treeGpuEnabled).toBe(false);
    expect(state.treeGpuFallbackToCpu).toBe(false);
    expect(state.treeGpuForceCpu).toBe(true);
    expect(state.treeGpuShowCounts).toBe(true);
    expect(state.treeGpuReadbackVisibleLists).toBe(true);
    expect(state.treeGpuValidateAgainstCpu).toBe(true);
  });

  it("halts animated environment inputs for deterministic diagnostics", () => {
    const state = createState();
    const params = new URLSearchParams({
      clouds: "0",
      froxels: "0",
      treeWind: "0",
      grassWind: "0",
    });

    applyEnvironmentQueryOverrides(state as never, params);

    expect(state.postProcessCloudsEnabled).toBe(false);
    expect(state.postProcessFroxelsEnabled).toBe(false);
    expect(state.treeWindEnabled).toBe(false);
    expect(state.treeWindStrength).toBe(0);
    expect(state.treeGustStrength).toBe(0);
    expect(state.treeTrunkSwayStrength).toBe(0);
    expect(state.treeLeafFlutterStrength).toBe(0);
    expect(state.grassWindStrength).toBe(0);
    expect(state.grassWindSpeed).toBe(0);
  });

  it("enables strict tree GPU mode for fail-loud perf captures", () => {
    const state = createState();
    const params = new URLSearchParams({
      quality: "perf",
      treeGpuStrict: "1",
      treeGpuForceCpu: "1",
    });

    applyEnvironmentQueryOverrides(state as never, params);

    expect(state.treeGpuEnabled).toBe(true);
    expect(state.treeGpuFallbackToCpu).toBe(false);
    expect(state.treeGpuForceCpu).toBe(false);
  });

  it("applies far-material and impostor hot-swap URL toggles", () => {
    const state = createState();

    applyEnvironmentQueryOverrides(state as never, new URLSearchParams({
      treeFarCheapMaterial: "0",
      treeImpostorSwapOnBake: "0",
    }));

    expect(state.treeFarCheapMaterial).toBe(false);
    expect(state.treeImpostorSwapOnBake).toBe(false);
  });

  it("enables tree GPU readback when counts or validation are requested", () => {
    const countsState = createState();
    applyEnvironmentQueryOverrides(countsState as never, new URLSearchParams({ quality: "perf", treeGpuCounts: "1" }));
    expect(countsState.treeGpuShowCounts).toBe(true);
    expect(countsState.treeGpuReadbackVisibleLists).toBe(true);

    const validationState = createState();
    applyEnvironmentQueryOverrides(validationState as never, new URLSearchParams({ quality: "perf", treeGpuValidate: "1" }));
    expect(validationState.treeGpuValidateAgainstCpu).toBe(true);
    expect(validationState.treeGpuReadbackVisibleLists).toBe(true);
  });

  it("ignores invalid tree shadow LOD overrides", () => {
    const state = createState();
    applyEnvironmentQueryOverrides(state as never, new URLSearchParams({ quality: "perf", treeShadowMaxLod: "bad" }));

    expect(state.treeShadowMaxLod).toBe("near");
  });

  it.each(["density", "transmittance", "scatter"])("enables the froxel debug overlay for ?froxelDebug=%s", (mode) => {
    const state = createState();
    applyEnvironmentQueryOverrides(state as never, new URLSearchParams({ froxelDebug: mode }));

    expect(state.froxelDebugMode).toBe(mode);
    expect(state.froxelDebugEnabled).toBe(true);
  });

  it("leaves the froxel debug overlay off without the param, and for an explicit off", () => {
    const untouched = createState();
    applyEnvironmentQueryOverrides(untouched as never, new URLSearchParams());
    expect(untouched.froxelDebugMode).toBe("off");
    expect(untouched.froxelDebugEnabled).toBe(false);

    const disabled = createState();
    disabled.froxelDebugEnabled = true;
    disabled.froxelDebugMode = "scatter";
    applyEnvironmentQueryOverrides(disabled as never, new URLSearchParams({ froxelDebug: "off" }));
    expect(disabled.froxelDebugMode).toBe("off");
    expect(disabled.froxelDebugEnabled).toBe(false);
  });

  it("keeps the froxel debug overlay usable in perf mode, which disables the froxel stage", () => {
    const state = createState();
    applyEnvironmentQueryOverrides(state as never, new URLSearchParams({ fx: "0", froxelDebug: "density" }));

    expect(state.froxelDebugEnabled).toBe(true);
    expect(state.froxelDebugMode).toBe("density");
  });
});
