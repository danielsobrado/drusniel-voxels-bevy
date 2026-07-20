import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneUnderstorySettings } from "../../understory/understory_config_defaults.js";

const mocks = vi.hoisted(() => ({
  dressingSystem: {
    enabled: true,
    update: vi.fn(),
  },
  createDressingIntegration: vi.fn(),
}));
mocks.createDressingIntegration.mockReturnValue(mocks.dressingSystem);

vi.mock("../../ecology/dressing/index.js", () => ({
  createDressingIntegration: mocks.createDressingIntegration,
}));

import { runUnderstoryStartup } from "./understory_startup.js";

describe("understory dressing startup", () => {
  beforeEach(() => {
    mocks.createDressingIntegration.mockClear();
  });

  it("forwards authoritative world identity instead of deriving it from query text", () => {
    const scene = new THREE.Scene();
    const result = runUnderstoryStartup({
      scene,
      state: {} as never,
      lod0Nodes: [],
      worldCells: 512,
      worldSeed: 0xf000_0001,
      unboundedWorld: true,
      understoryConfig: cloneUnderstorySettings(),
      isWebGpu: false,
      hydrologySystem: null,
      rendererWebGpuDevice: null,
      gpuBackend: null,
      currentLighting: () => ({}) as never,
      statControllers: {
        stoneTotal: null,
        stoneClassSummary: null,
        stoneVisible: null,
        treeTotal: null,
        treeVisiblePatches: null,
        treeLodSummary: null,
        treeGpuSummary: null,
        understoryTotal: null,
        understoryVisiblePatches: null,
        understoryClassSummary: null,
        understoryGpuSummary: null,
        forestLightingStats: null,
      },
      searchParams: new URLSearchParams("seed=1&scene=default"),
    });

    expect(mocks.createDressingIntegration).toHaveBeenCalledWith(expect.objectContaining({
      worldSeed: 0xf000_0001,
      unboundedWorld: true,
      enabled: true,
    }));
    result.understorySystem.dispose();
  });

  it("keeps tree performance scenes free of dressing unless explicitly enabled", () => {
    const common = {
      scene: new THREE.Scene(),
      state: {} as never,
      lod0Nodes: [],
      worldCells: 512,
      worldSeed: 1,
      unboundedWorld: false,
      understoryConfig: cloneUnderstorySettings(),
      isWebGpu: false,
      hydrologySystem: null,
      rendererWebGpuDevice: null,
      gpuBackend: null,
      currentLighting: () => ({}) as never,
      statControllers: {} as never,
    };

    const isolated = runUnderstoryStartup({
      ...common,
      searchParams: new URLSearchParams("scene=trees-perf"),
    });
    expect(mocks.createDressingIntegration).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    isolated.understorySystem.dispose();

    const optedIn = runUnderstoryStartup({
      ...common,
      searchParams: new URLSearchParams("scene=trees-perf&dressing=1"),
    });
    expect(mocks.createDressingIntegration).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    optedIn.understorySystem.dispose();
  });
});
