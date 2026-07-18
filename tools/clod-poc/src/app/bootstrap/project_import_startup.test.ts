import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TERRAIN_SOURCE_VERSION } from "../../cache/terrainSource.js";
import { DEFAULT_ISLAND_SHAPE_CONFIG } from "../../world_source/island_shape.js";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  loadSavedWorldStartup: vi.fn(),
  emitAudio: vi.fn(),
  confirmRecoveryToken: vi.fn(),
  validateConfig: vi.fn((value: unknown) => value),
  validateSessionState: vi.fn((value: unknown) => value),
  validateWaterState: vi.fn((value: unknown) => value),
  validateWeatherState: vi.fn((value: unknown) => value),
}));

vi.mock("../../audio/index.js", () => ({ emitAudio: mocks.emitAudio }));
vi.mock("../../project/project_archive_config.js", () => ({ validateProjectArchiveConfig: mocks.validateConfig }));
vi.mock("../../project/project_archive_environment_state.js", () => ({
  validateProjectWaterArchiveState: mocks.validateWaterState,
  validateProjectWeatherArchiveState: mocks.validateWeatherState,
}));
vi.mock("../../project/project_import_recovery.js", () => ({
  confirmProjectImportRecoveryToken: mocks.confirmRecoveryToken,
}));
vi.mock("../../project/project_archive_session_state.js", () => ({ validateProjectSessionState: mocks.validateSessionState }));
vi.mock("../../project/voxel_project_archive.js", () => ({
  consumeStagedVoxelProjectImport: mocks.consume,
  isCurrentVoxelProjectManifest: (manifest: { schemaVersion?: number }) => manifest.schemaVersion === 4,
}));
vi.mock("./save_world_startup.js", () => ({ loadSavedWorldStartup: mocks.loadSavedWorldStartup }));

import { loadStagedProjectImport } from "./project_import_startup.js";

function dom() {
  return {
    buildProgress: { hidden: true } as HTMLElement,
    buildProgressPhase: { textContent: "" } as HTMLElement,
    buildProgressPercent: { textContent: "" } as HTMLElement,
    buildProgressBar: { value: 0 } as HTMLProgressElement,
    info: { textContent: "" } as HTMLElement,
  };
}

function currentContents(generatorVersion = TERRAIN_SOURCE_VERSION) {
  return {
    manifest: {
      schemaVersion: 4,
      config: {},
      state: {},
      water: {},
      weather: {},
      props: [{ id: "prop-1" }],
      world: {
        scene: "infinite-islands",
        generatorVersion,
        terrainField: {
          seed: 73,
          seaLevel: 21,
          islandShape: {
            ...DEFAULT_ISLAND_SHAPE_CONFIG,
            enabled: true,
            oceanRim: true,
            seed: 73,
            seaLevel: 21,
            worldRadiusM: 12_000,
            spacingM: 1700,
            radiusM: 620,
            blendM: 280,
          },
        },
        generatorQuery: {
          water: "1",
          quality: "perf",
          hydroUnified: "1",
          continentHydrology: "0",
        },
      },
    },
    customTextures: new Map(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validateConfig.mockImplementation((value: unknown) => value);
  mocks.validateSessionState.mockImplementation((value: unknown) => value);
  mocks.validateWaterState.mockImplementation((value: unknown) => value);
  mocks.validateWeatherState.mockImplementation((value: unknown) => value);
  vi.stubGlobal("location", { pathname: "/", hash: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project import startup", () => {
  it("validates the staged payload and restores complete world and prop authority", async () => {
    mocks.consume.mockResolvedValue(currentContents());
    const params = new URLSearchParams(
      "import=token&seed=1&scene=default&hud=1&waterEnabled=0&waterHq=0&customProps=0",
    );

    const result = await loadStagedProjectImport(params, dom());

    expect(result).not.toBeNull();
    expect(mocks.confirmRecoveryToken).toHaveBeenCalledWith("token");
    expect(mocks.validateConfig).toHaveBeenCalledOnce();
    expect(mocks.validateSessionState).toHaveBeenCalledOnce();
    expect(mocks.validateWaterState).toHaveBeenCalledOnce();
    expect(mocks.validateWeatherState).toHaveBeenCalledOnce();
    expect(params.get("import")).toBeNull();
    expect(params.get("scene")).toBe("infinite-islands");
    expect(params.get("seed")).toBe("73");
    expect(params.get("seaLevel")).toBe("21");
    expect(params.get("islands")).toBe("1");
    expect(params.get("oceanRim")).toBe("1");
    expect(params.get("worldRadius")).toBe("12000");
    expect(params.get("islandSpacing")).toBe("1700");
    expect(params.get("islandRadius")).toBe("620");
    expect(params.get("islandBlend")).toBe("280");
    expect(params.get("water")).toBe("1");
    expect(params.get("quality")).toBe("perf");
    expect(params.get("hydroUnified")).toBe("1");
    expect(params.get("continentHydrology")).toBe("0");
    expect(params.get("customProps")).toBe("1");
    expect(params.get("waterEnabled")).toBeNull();
    expect(params.get("waterHq")).toBeNull();
    expect(params.get("hud")).toBe("1");
    expect(mocks.emitAudio).toHaveBeenCalledWith("project.import.success");
  });

  it("fails bootstrap for an incompatible terrain version", async () => {
    mocks.consume.mockResolvedValue(currentContents("future-generator"));
    const params = new URLSearchParams("import=token&seed=1");
    const elements = dom();

    await expect(loadStagedProjectImport(params, elements)).rejects.toThrow(/incompatible/i);

    expect(elements.info.textContent).toMatch(/incompatible/i);
    expect(params.get("seed")).toBe("1");
    expect(params.get("import")).toBeNull();
    expect(mocks.emitAudio).toHaveBeenCalledWith("project.import.error");
  });

  it("keeps explicit URL identity but pins empty props for a legacy v3 archive", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.consume.mockResolvedValue({
      manifest: { schemaVersion: 3, config: {}, state: {}, water: {}, weather: {}, props: [] },
      customTextures: new Map(),
    });
    const params = new URLSearchParams("import=token&seed=9&scene=continent&customProps=1");

    const result = await loadStagedProjectImport(params, dom());

    expect(result).not.toBeNull();
    expect(params.get("seed")).toBe("9");
    expect(params.get("scene")).toBe("continent");
    expect(params.get("customProps")).toBe("0");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
