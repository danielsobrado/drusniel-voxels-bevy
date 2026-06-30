import { describe, expect, it } from "vitest";
import { applyTreeQualityPreset, type TreeQualityPresetState } from "./tree_quality_presets.js";

function createState(): TreeQualityPresetState {
  return {
    treeDistance: 620,
    treeMaxInstances: 9000,
    treeDensity: 1.2,
    treeSpacing: 5.5,
    treeGpuEnabled: false,
    treeGpuForceCpu: true,
    treeGpuShowCounts: true,
    treeGpuReadbackVisibleLists: true,
    treeGpuValidateAgainstCpu: true,
    treeGpuMaxVisible: 50_000,
  };
}

describe("tree quality presets", () => {
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
      treeGpuEnabled: true,
      treeGpuForceCpu: false,
      treeGpuShowCounts: false,
      treeGpuReadbackVisibleLists: false,
      treeGpuValidateAgainstCpu: false,
      treeGpuMaxVisible: 16_000,
    });
  });
});
