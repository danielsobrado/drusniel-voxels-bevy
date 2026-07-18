import { describe, expect, it } from "vitest";
import {
  applyTreeQualityPreset,
  type TreeQualityPresetState,
} from "../../app/state/tree_quality_presets.js";
import {
  TREE_DISTANCE_GUI_MAX_M,
  TREE_GPU_VISIBLE_GUI_MAX,
} from "./vegetation_gui.js";

function state(): TreeQualityPresetState {
  return {
    treeQualityPreset: "custom",
    treeDistance: 0,
    treeMaxInstances: 0,
    treeDensity: 0,
    treeSpacing: 1,
    treeShadowMaxLod: "none",
    treeWindEnabled: false,
    treeWindStrength: 0,
    treeGustStrength: 0,
    treeTrunkSwayStrength: 0,
    treeLeafFlutterStrength: 0,
    treeGpuEnabled: false,
    treeGpuFallbackToCpu: false,
    treeGpuForceCpu: false,
    treeGpuShowCounts: false,
    treeGpuReadbackVisibleLists: false,
    treeGpuValidateAgainstCpu: false,
    treeGpuMaxVisible: 0,
  };
}

describe("vegetation GUI tree limits", () => {
  it("contains every production tree preset", () => {
    for (const preset of ["ultra", "balanced", "perf", "potato"] as const) {
      const current = state();
      applyTreeQualityPreset(current, preset);
      expect(current.treeDistance).toBeLessThanOrEqual(TREE_DISTANCE_GUI_MAX_M);
      expect(current.treeGpuMaxVisible).toBeLessThanOrEqual(TREE_GPU_VISIBLE_GUI_MAX);
    }
  });
});
