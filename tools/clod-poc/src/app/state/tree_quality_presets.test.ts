import { describe, expect, it } from "vitest";
import {
  applyTreeQualityPreset,
  isTreeShadowMaxLod,
  treeImpostorBakeAgeLayersForQualityPreset,
  treeImpostorStartFractionForQualityPreset,
  treeImpostorTileResolutionForQualityPreset,
  treeLodBudgetsForQualityPreset,
  type TreeQualityPresetState,
} from "./tree_quality_presets.js";

function createState(): TreeQualityPresetState {
  return {
    treeQualityPreset: "custom",
    treeDistance: 620,
    treeMaxInstances: 9000,
    treeDensity: 1.2,
    treeSpacing: 5.5,
    treeShadowMaxLod: "mid",
    treeWindEnabled: true,
    treeWindStrength: 0.18,
    treeGustStrength: 0.12,
    treeTrunkSwayStrength: 0.45,
    treeLeafFlutterStrength: 0.18,
    treeGpuEnabled: false,
    treeGpuFallbackToCpu: false,
    treeGpuForceCpu: true,
    treeGpuShowCounts: true,
    treeGpuReadbackVisibleLists: true,
    treeGpuValidateAgainstCpu: true,
    treeGpuMaxVisible: 50_000,
  };
}

describe("tree quality presets", () => {
  it("validates shadow LOD values", () => {
    expect(isTreeShadowMaxLod("none")).toBe(true);
    expect(isTreeShadowMaxLod("near")).toBe(true);
    expect(isTreeShadowMaxLod("mid")).toBe(true);
    expect(isTreeShadowMaxLod("far")).toBe(true);
    expect(isTreeShadowMaxLod("impostor")).toBe(true);
    expect(isTreeShadowMaxLod("bad")).toBe(false);
    expect(isTreeShadowMaxLod(null)).toBe(false);
  });

  it("does not change tree values for custom", () => {
    const state = createState();
    applyTreeQualityPreset(state, "custom");
    expect(state).toEqual(createState());
  });

  it("applies perf values and disables debug GPU readbacks", () => {
    const state = createState();
    applyTreeQualityPreset(state, "perf");
    expect(state).toEqual({
      treeQualityPreset: "perf",
      treeDistance: 500,
      treeMaxInstances: 5000,
      treeDensity: 0.55,
      treeSpacing: 9,
      treeShadowMaxLod: "far",
      treeWindEnabled: false,
      treeWindStrength: 0,
      treeGustStrength: 0,
      treeTrunkSwayStrength: 0,
      treeLeafFlutterStrength: 0,
      treeGpuEnabled: true,
      treeGpuFallbackToCpu: true,
      treeGpuForceCpu: false,
      treeGpuShowCounts: false,
      treeGpuReadbackVisibleLists: false,
      treeGpuValidateAgainstCpu: false,
      treeGpuMaxVisible: 40_000,
    });
  });

  it("returns smaller geometry budgets for lower presets", () => {
    const fallback = {
      nearMaxVertices: 260_000,
      midMaxVertices: 90_000,
      farMaxVertices: 40_000,
      impostorMaxVertices: 240,
    };

    expect(treeLodBudgetsForQualityPreset("custom", fallback)).toBe(fallback);
    expect(treeLodBudgetsForQualityPreset("perf", fallback).nearMaxVertices).toBeLessThan(fallback.nearMaxVertices);
    expect(treeLodBudgetsForQualityPreset("potato", fallback).nearMaxVertices)
      .toBeLessThan(treeLodBudgetsForQualityPreset("perf", fallback).nearMaxVertices);
  });

  it("binds impostor tile size to the canonical quality token", () => {
    expect(treeImpostorTileResolutionForQualityPreset("ultra", 17)).toBe(160);
    expect(treeImpostorTileResolutionForQualityPreset("balanced", 17)).toBe(128);
    expect(treeImpostorTileResolutionForQualityPreset("perf", 17)).toBe(64);
    expect(treeImpostorTileResolutionForQualityPreset("potato", 17)).toBe(48);
    expect(treeImpostorTileResolutionForQualityPreset("custom", 17)).toBe(17);
  });

  it("keeps high-quality far geometry to the intended billboard seam", () => {
    expect(treeImpostorStartFractionForQualityPreset("ultra", 1200, 0.1)).toBeCloseTo(460 / 1200);
    expect(treeImpostorStartFractionForQualityPreset("balanced", 900, 0.1)).toBeCloseTo(420 / 900);
    expect(treeImpostorStartFractionForQualityPreset("perf", 500, 0.1)).toBeCloseTo(300 / 500);
    expect(treeImpostorStartFractionForQualityPreset("potato", 240, 0.1)).toBeCloseTo(140 / 240);
    expect(treeImpostorStartFractionForQualityPreset("custom", 900, 0.37)).toBe(0.37);
  });

  it("spends preset memory on sharper mature pages", () => {
    expect(treeImpostorBakeAgeLayersForQualityPreset("ultra", true)).toBe(false);
    expect(treeImpostorBakeAgeLayersForQualityPreset("balanced", true)).toBe(false);
    expect(treeImpostorBakeAgeLayersForQualityPreset("custom", true)).toBe(true);
  });
});
