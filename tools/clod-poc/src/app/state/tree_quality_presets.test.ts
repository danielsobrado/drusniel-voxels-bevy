import { describe, expect, it } from "vitest";
import { applyTreeQualityPreset, isTreeShadowMaxLod, type TreeQualityPresetState } from "./tree_quality_presets.js";

function createState(): TreeQualityPresetState {
  return {
    treeDistance: 620,
    treeMaxInstances: 9000,
    treeDensity: 1.2,
    treeSpacing: 5.5,
    treeShadowMaxLod: "mid",
    treeGpuEnabled: false,
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
      treeDistance: 300,
      treeMaxInstances: 3500,
      treeDensity: 0.55,
      treeSpacing: 9,
      treeShadowMaxLod: "near",
      treeGpuEnabled: true,
      treeGpuForceCpu: false,
      treeGpuShowCounts: false,
      treeGpuReadbackVisibleLists: false,
      treeGpuValidateAgainstCpu: false,
      treeGpuMaxVisible: 16_000,
    });
  });
});
