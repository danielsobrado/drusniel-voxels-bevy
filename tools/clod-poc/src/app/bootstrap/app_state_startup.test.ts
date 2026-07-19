import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClodAppState: vi.fn((_params: Record<string, unknown>) => ({
    marker: "state",
    normalDivergence: true,
    grassShaderMode: "webgpu-ring-v1",
  })),
  applyEnvironmentQueryOverrides: vi.fn(),
}));

vi.mock("../clod_app_state.js", () => ({
  createClodAppState: mocks.createClodAppState,
}));
vi.mock("../state/environment_query_overrides.js", () => ({
  applyEnvironmentQueryOverrides: mocks.applyEnvironmentQueryOverrides,
}));

import { runAppStateStartup } from "./app_state_startup.js";

function input(stagedImport: unknown, isWebGpu = true) {
  return {
    searchParams: new URLSearchParams("clodPerf=1&grass=0&postProcess=0&treeGpu=1&weather=storm"),
    clodRuntime: { digging: { holdIntervalMs: 180 } },
    cfg: {},
    stagedImport,
    isWebGpu,
    maxAnisotropy: 8,
    queries: {
      queryPerfMode: true,
      queryWebGpuSelection: true,
      queryMaterialTiers: true,
      queryGrassPerfScene: true,
      queryTreePerfScene: true,
      queryForestFloorScene: true,
      queryTreeGpuRing: true,
      queryFarShell: true,
      queryLongViewScene: true,
      queryGrassRingGrid: 512,
      queryGrassRingCell: 0.8,
      queryTerrainMaterialSource: "debug_flat",
      textureMipmapsEnabled: true,
    },
    configs: {
      grassConfig: {},
      stoneConfig: {},
      treeConfig: {},
      understoryConfig: {},
      forestLightingConfig: {},
      waterConfig: {},
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClodAppState.mockImplementation((_params: Record<string, unknown>) => ({
    marker: "state",
    normalDivergence: true,
    grassShaderMode: "webgpu-ring-v1",
  }));
});

describe("app state startup archive precedence", () => {
  it("removes state-changing query presets for imported projects", () => {
    const result = runAppStateStartup(input({ manifest: {} }));

    const params = mocks.createClodAppState.mock.calls[0]![0];
    expect((params.searchParams as URLSearchParams).toString()).toBe("");
    expect(params.isWebGpu).toBe(false);
    expect(params.queryPerfMode).toBe(false);
    expect(params.queryGrassPerfScene).toBe(false);
    expect(params.queryTreePerfScene).toBe(false);
    expect(params.queryForestFloorScene).toBe(false);
    expect(params.queryTreeGpuRing).toBe(false);
    expect(params.queryTerrainMaterialSource).toBeNull();
    expect(params.queryWebGpuSelection).toBe(true);
    expect(params.queryFarShell).toBe(true);
    expect(result.state.normalDivergence).toBe(false);
    expect(result.state.grassShaderMode).toBe("webgpu-ring-v1");
    expect(mocks.applyEnvironmentQueryOverrides).not.toHaveBeenCalled();
  });

  it("downgrades an imported GPU grass mode when the renderer is WebGL", () => {
    const result = runAppStateStartup(input({ manifest: {} }, false));
    expect(result.state.grassShaderMode).toBe("terrain-patch-v2");
  });

  it("keeps query overrides for normal non-import startup", () => {
    const source = input(null);
    runAppStateStartup(source);

    const params = mocks.createClodAppState.mock.calls[0]![0];
    expect(params.searchParams).toBe(source.searchParams);
    expect(params.isWebGpu).toBe(true);
    expect(params.queryPerfMode).toBe(true);
    expect(params.queryTerrainMaterialSource).toBe("debug_flat");
    expect(mocks.applyEnvironmentQueryOverrides).toHaveBeenCalledOnce();
  });
});
