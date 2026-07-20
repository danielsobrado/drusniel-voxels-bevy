import { describe, expect, it } from "vitest";
import { applyScenePresets, clampTreeRuntimeState, type ClodAppState, type CreateClodAppStateParams } from "./index.js";

function treePerfParams(search = "scene=trees-perf"): CreateClodAppStateParams {
  return {
    searchParams: new URLSearchParams(search),
    queryTreePerfScene: true,
    isWebGpu: true,
    queryPerfMode: false,
    queryGrassPerfScene: false,
    queryForestFloorScene: false,
  } as CreateClodAppStateParams;
}

function state(): ClodAppState {
  return {
    waterEnabled: true,
    normalDivergence: true,
  } as ClodAppState;
}

describe("scene presets", () => {
  it("preserves the balanced tree preset's outer impostor band", () => {
    const current = {
      treeDistance: 900,
      treeMaxInstances: 9000,
      treeGpuMaxVisible: 128000,
      treeSpacing: 7,
      treeShadowMaxLod: "impostor",
    } as ClodAppState;

    clampTreeRuntimeState(current);

    expect(current.treeDistance).toBe(900);
    expect(current.treeMaxInstances).toBe(9000);
  });

  it("isolates the tree performance scene from water by default", () => {
    const current = state();

    applyScenePresets(current, treePerfParams());

    expect(current.waterEnabled).toBe(false);
  });

  it("allows an explicit water query to override tree-scene isolation", () => {
    const current = state();

    applyScenePresets(current, treePerfParams("scene=trees-perf&water=1"));

    expect(current.waterEnabled).toBe(true);
  });
});
