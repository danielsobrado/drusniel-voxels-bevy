import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ISLAND_SHAPE_CONFIG } from "../world_source/island_shape.js";

const mocks = vi.hoisted(() => ({
  emitAudio: vi.fn(),
  createArchive: vi.fn(),
  parseArchive: vi.fn(),
  stageImport: vi.fn(),
  validateConfig: vi.fn((value: unknown) => value),
  validateSessionState: vi.fn((value: unknown) => value),
  validateTextures: vi.fn(),
  getVoxelEditSnapshot: vi.fn(),
  mapSessionState: vi.fn(),
  mapWaterState: vi.fn(),
  mapWeatherState: vi.fn(),
}));

vi.mock("../audio/index.js", () => ({ emitAudio: mocks.emitAudio }));
vi.mock("../project/voxel_project_archive.js", () => ({
  VOXEL_PROJECT_SCHEMA_VERSION: 4,
  createVoxelProjectArchive: mocks.createArchive,
  isCurrentVoxelProjectManifest: (manifest: { schemaVersion?: number }) => manifest.schemaVersion === 4,
  parseVoxelProjectArchive: mocks.parseArchive,
  stageVoxelProjectImport: mocks.stageImport,
}));
vi.mock("./project_archive_config.js", () => ({ validateProjectArchiveConfig: mocks.validateConfig }));
vi.mock("./project_archive_session_state.js", () => ({ validateProjectSessionState: mocks.validateSessionState }));
vi.mock("../terrain/terrain.js", () => ({ getVoxelEditSnapshot: mocks.getVoxelEditSnapshot }));
vi.mock("./project_state_mapper.js", () => ({
  mapProjectSessionState: mocks.mapSessionState,
  mapProjectWaterArchiveState: mocks.mapWaterState,
  mapProjectWeatherArchiveState: mocks.mapWeatherState,
}));
vi.mock("./project_texture_validator.js", () => ({
  validateProjectArchiveTextures: mocks.validateTextures,
}));

import { createProjectArchiveController } from "./project_archive_controller.js";

class FakeButton extends EventTarget {
  disabled = false;
  click = vi.fn();
}

class FakeInput extends EventTarget {
  files: FileList | null = null;
  value = "";
  click = vi.fn();
}

class FakeElement extends EventTarget {
  hidden = false;
  textContent = "";
}

class FakeProgress extends FakeElement {
  value = 0;
}

function fileList(file: File): FileList {
  return [file] as unknown as FileList;
}

function projectFile(): File {
  return {
    size: 3,
    arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
  } as unknown as File;
}

function createHarness(beforeImportNavigation: () => Promise<void>) {
  const importButton = new FakeButton();
  const exportButton = new FakeButton();
  const projectImportInput = new FakeInput();
  const buildProgress = new FakeElement();
  const buildProgressPhase = new FakeElement();
  const buildProgressPercent = new FakeElement();
  const buildProgressBar = new FakeProgress();
  const setBuildStatus = vi.fn();
  const setLastArchiveSummary = vi.fn();
  const updateInfo = vi.fn();
  const updateOverlay = vi.fn();

  const controller = createProjectArchiveController({
    importButton: importButton as unknown as HTMLButtonElement,
    exportButton: exportButton as unknown as HTMLButtonElement,
    projectImportInput: projectImportInput as unknown as HTMLInputElement,
    buildProgress: buildProgress as unknown as HTMLElement,
    buildProgressPhase: buildProgressPhase as unknown as HTMLElement,
    buildProgressPercent: buildProgressPercent as unknown as HTMLElement,
    buildProgressBar: buildProgressBar as unknown as HTMLProgressElement,
    getState: () => ({}) as never,
    getWorldSize: () => 8,
    getConfig: () => ({}) as never,
    getWorldIdentity: () => ({
      scene: "infinite-islands",
      generatorVersion: "test-generator",
      terrainField: {
        seed: 73,
        seaLevel: 18,
        islandShape: { ...DEFAULT_ISLAND_SHAPE_CONFIG, enabled: true, seed: 73 },
      },
      generatorQuery: { water: "1", hydroUnified: "1" },
    }),
    getNodesByLevel: () => new Map(),
    getProps: () => [],
    textureController: {
      slots: [],
      projectTextureMetadata: () => [],
    } as never,
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3() } as never,
    flushAncestors: vi.fn(async () => {}),
    beforeImportNavigation,
    setBuildStatus,
    updateOverlay,
    setLastArchiveSummary,
    updateInfo,
  });
  controller.bindImportExportButtons();

  return {
    importButton,
    exportButton,
    projectImportInput,
    setLastArchiveSummary,
  };
}

describe("project archive import handoff", () => {
  const contents = {
    manifest: {
      schemaVersion: 4,
      worldSize: 16,
      config: {},
      state: {},
      world: {
        scene: "continent",
        generatorVersion: "test-generator",
        terrainField: {
          seed: 73,
          seaLevel: 21,
          islandShape: { ...DEFAULT_ISLAND_SHAPE_CONFIG, seed: 73, seaLevel: 21 },
        },
        generatorQuery: { continentHydrology: "1" },
      },
    },
    customTextures: new Map(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateConfig.mockImplementation((value: unknown) => value);
    mocks.validateSessionState.mockImplementation((value: unknown) => value);
    vi.stubGlobal("window", { alert: vi.fn() });
    vi.stubGlobal("location", { search: "?save=save-a&seed=9&hud=1" });
    mocks.parseArchive.mockResolvedValue(contents);
    mocks.validateTextures.mockResolvedValue(undefined);
    mocks.stageImport.mockResolvedValue("import-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates, checkpoints, stages, and replaces stale world ownership in order", async () => {
    const beforeImportNavigation = vi.fn(async () => {});
    const harness = createHarness(beforeImportNavigation);
    harness.projectImportInput.files = fileList(projectFile());

    harness.projectImportInput.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(mocks.stageImport).toHaveBeenCalledOnce());
    expect(mocks.validateConfig).toHaveBeenCalledOnce();
    expect(mocks.validateSessionState).toHaveBeenCalledOnce();
    expect(beforeImportNavigation).toHaveBeenCalledOnce();
    expect(mocks.validateSessionState.mock.invocationCallOrder[0])
      .toBeLessThan(beforeImportNavigation.mock.invocationCallOrder[0]!);
    expect(beforeImportNavigation.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.stageImport.mock.invocationCallOrder[0]!);
    expect(location.search).toBe("?seed=73&hud=1&scene=continent&seaLevel=21&world=16&import=import-token");
    expect(mocks.emitAudio).toHaveBeenCalledWith("project.import.success");
  });

  it("does not stage or navigate when the checkpoint fails", async () => {
    const beforeImportNavigation = vi.fn(async () => {
      throw new Error("checkpoint failed");
    });
    const harness = createHarness(beforeImportNavigation);
    harness.projectImportInput.files = fileList(projectFile());

    harness.projectImportInput.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledOnce());
    expect(mocks.stageImport).not.toHaveBeenCalled();
    expect(location.search).toBe("?save=save-a&seed=9&hud=1");
    expect(harness.importButton.disabled).toBe(false);
    expect(harness.exportButton.disabled).toBe(false);
    expect(harness.setLastArchiveSummary).toHaveBeenCalledWith("Project import failed: checkpoint failed");
    expect(mocks.emitAudio).toHaveBeenCalledWith("project.import.error");
  });
});
