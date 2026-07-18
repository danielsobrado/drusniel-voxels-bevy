import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedSavedWorld } from "../../save/save_service.js";

const mocks = vi.hoisted(() => ({
  emitAudio: vi.fn(),
  initSaveRuntime: vi.fn(),
  installGuard: vi.fn(),
  readSavedWorldForStartup: vi.fn(),
  seedOverrideFromQuery: vi.fn(),
  replaceVoxelEdits: vi.fn(),
}));

vi.mock("../../audio/index.js", () => ({ emitAudio: mocks.emitAudio }));
vi.mock("../../save/save_runtime.js", () => ({ initSaveRuntime: mocks.initSaveRuntime }));
vi.mock("../../save/saved_world_startup_compatibility.js", () => ({
  installSavedWorldManifestCompatibilityGuard: mocks.installGuard,
}));
vi.mock("../../save/saved_world_startup_reader.js", () => ({
  readSavedWorldForStartup: mocks.readSavedWorldForStartup,
}));
vi.mock("../../save/save_service.js", () => ({
  seedOverrideFromQuery: mocks.seedOverrideFromQuery,
}));
vi.mock("../../terrain/terrain.js", () => ({ replaceVoxelEdits: mocks.replaceVoxelEdits }));

import { loadSavedWorldStartup, type SaveWorldStartupDom } from "./save_world_startup.js";

function loadedWorld(): LoadedSavedWorld {
  return {
    saveId: "save-1",
    manifest: {
      schemaVersion: 2,
      saveId: "save-1",
      worldId: "ephemeral:1",
      seed: 1,
      proceduralProfile: "continent-v1",
      regionSizeM: 512,
      chunkSizeM: 16,
      regionKeys: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      worldManifest: {
        worldId: "ephemeral:1",
        seed: 1,
        generatorVersion: "world-modes-v9-feature-stamps",
        terrainSourceHash: "hash",
        mode: "finite",
        sizeM: { x: 4096, z: 4096 },
        seaLevelM: 18,
        startupWorld: { pages: 4, cells: 4096 },
        artifacts: {},
      },
    },
    metadata: {
      schemaVersion: 2,
      cities: [],
      districts: [],
      roads: [],
      caveEntrances: [],
      caveSystems: [],
      criticalPaths: [],
      revision: 0,
    },
    regions: [],
    voxelSnapshot: { revision: 2, deltas: [] },
    voxelDeltaCount: 0,
    propInstanceCount: 0,
    criticalPathValidation: { errors: [], warnings: [], touchedCriticalPathIds: [], durationMs: 0 },
    loadMs: 1,
  };
}

function dom(): SaveWorldStartupDom {
  return {
    buildProgress: { hidden: true } as HTMLElement,
    buildProgressPhase: { textContent: "" } as HTMLElement,
    buildProgressPercent: { textContent: "" } as HTMLElement,
    buildProgressBar: { value: 0 } as HTMLProgressElement,
    info: { textContent: "" } as HTMLElement,
  };
}

describe("saved world startup activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {});
    mocks.readSavedWorldForStartup.mockResolvedValue(loadedWorld());
    mocks.seedOverrideFromQuery.mockReturnValue(undefined);
    mocks.installGuard.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates runtime replacement before mutating voxel authority and removes the guard", async () => {
    const failure = new Error("active runtime is dirty");
    const dispose = vi.fn();
    mocks.installGuard.mockReturnValue(dispose);
    mocks.initSaveRuntime.mockImplementation(() => { throw failure; });
    const targetDom = dom();

    await expect(loadSavedWorldStartup(new URLSearchParams("save=save-1"), targetDom))
      .rejects.toBe(failure);

    expect(mocks.installGuard).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.replaceVoxelEdits).not.toHaveBeenCalled();
    expect(targetDom.info.textContent).toContain("active runtime is dirty");
  });

  it("activates manifest guard, runtime, and voxel authority in that order", async () => {
    const order: string[] = [];
    const dispose = vi.fn();
    mocks.installGuard.mockImplementation(() => {
      order.push("guard");
      return dispose;
    });
    mocks.initSaveRuntime.mockImplementation(() => { order.push("runtime"); });
    mocks.replaceVoxelEdits.mockImplementation(() => { order.push("voxels"); });

    const result = await loadSavedWorldStartup(new URLSearchParams("save=save-1"), dom());

    expect(result?.saveId).toBe("save-1");
    expect(order).toEqual(["guard", "runtime", "voxels"]);
    expect(dispose).not.toHaveBeenCalled();
  });
});
