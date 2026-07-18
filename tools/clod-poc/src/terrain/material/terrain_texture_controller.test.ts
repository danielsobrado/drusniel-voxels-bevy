import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadImportedResources: vi.fn(),
  disposeImportedResources: vi.fn(),
  loadTexture: vi.fn(),
  configureNormal: vi.fn(),
}));

vi.mock("./terrain_texture_import_transaction.js", () => ({
  loadImportedTerrainTextureResources: mocks.loadImportedResources,
  disposeImportedTerrainTextureResources: mocks.disposeImportedResources,
}));
vi.mock("./texture_loader.js", () => ({
  loadTerrainTextureUrl: mocks.loadTexture,
  configureNormalTexture: mocks.configureNormal,
}));
vi.mock("./terrain_builtin_textures.js", () => ({
  BUILTIN_TERRAIN_TEXTURES: [
    { id: "grass", label: "Grass", url: "builtin:grass" },
    { id: "rock", label: "Rock", url: "builtin:rock" },
  ],
  DEFAULT_TERRAIN_TEXTURE_PRESETS: [
    { id: "grass", scale: 1, heightMin: 0, heightMax: 50 },
    { id: "rock", scale: 1, heightMin: 50, heightMax: 100 },
  ],
}));

import { createTerrainTextureController } from "./terrain_texture_controller.js";

const canvasContext = {
  save: vi.fn(),
  clearRect: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  drawImage: vi.fn(),
  restore: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4 * 4 * 4) })),
};

function controller(stagedImport: unknown = null) {
  return createTerrainTextureController({
    textureArraySize: 4,
    textureMipmapsEnabled: false,
    maxAnisotropy: 1,
    textureLoadOptions: { textureMipmapsEnabled: false, maxAnisotropy: 1 },
    stagedImport,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", {
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => canvasContext),
    })),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("terrain texture controller project imports", () => {
  it("preserves the exact imported slot count and empty ownership", () => {
    const textureController = controller({
      manifest: {
        textures: [
          { index: 0, source: "empty", name: "empty", selectedId: "", scale: 1, heightMin: 0, heightMax: 10 },
          { index: 1, source: "builtin", name: "Rock", selectedId: "rock", scale: 2, heightMin: 10, heightMax: 20 },
          { index: 2, source: "empty", name: "empty", selectedId: "empty", scale: 3, heightMin: 20, heightMax: 30 },
          { index: 3, source: "empty", name: "empty", selectedId: "", scale: 4, heightMin: 30, heightMax: 40 },
          { index: 4, source: "empty", name: "empty", selectedId: "", scale: 5, heightMin: 40, heightMax: 50 },
          { index: 5, source: "empty", name: "empty", selectedId: "", scale: 6, heightMin: 50, heightMax: 60 },
        ],
      },
      customTextures: new Map(),
    });

    expect(textureController.slots).toHaveLength(6);
    expect(textureController.projectTextureMetadata().map((slot) => slot.source)).toEqual([
      "empty", "builtin", "empty", "empty", "empty", "empty",
    ]);
  });

  it("does not mutate slots when resource acquisition fails", async () => {
    const textureController = controller({
      manifest: {
        textures: [
          { index: 0, source: "custom", name: "Soil", selectedId: "custom", scale: 1, heightMin: 0, heightMax: 100, customPath: "textures/soil.png" },
        ],
      },
      customTextures: new Map([["textures/soil.png", new Uint8Array([1])]]),
    });
    mocks.loadImportedResources.mockRejectedValue(new Error("decode failed"));

    await expect(textureController.restoreStagedImport({ setPhase: vi.fn() })).rejects.toThrow("decode failed");

    expect(textureController.slots[0]?.texture).toBeNull();
    expect(textureController.slots[0]?.selectedId).toBe("custom");
  });

  it("does not rebuild data arrays for scale or height-band changes", () => {
    const textureController = controller();
    const texture = new THREE.Texture({} as TexImageSource);
    textureController.setTextureSlot(0, texture, "Soil", "blob:soil", new Uint8Array([1]), "image/png", ".png");

    textureController.ensureTextureArrays("external_pbr");
    const first = textureController.getAlbedoArray();
    expect(first).not.toBeNull();

    textureController.slots[0]!.scale = 4;
    textureController.slots[0]!.heightMin = 10;
    textureController.slots[0]!.heightMax = 80;
    textureController.ensureTextureArrays("external_pbr");

    expect(textureController.getAlbedoArray()).toBe(first);
  });

  it("releases data arrays when external PBR is no longer active", () => {
    const textureController = controller();
    textureController.setTextureSlot(
      0,
      new THREE.Texture({} as TexImageSource),
      "Soil",
      "blob:soil",
      new Uint8Array([1]),
      "image/png",
      ".png",
    );
    textureController.ensureTextureArrays("external_pbr");
    const array = textureController.getAlbedoArray();
    expect(array).not.toBeNull();
    const dispose = vi.spyOn(array!, "dispose");

    textureController.ensureTextureArrays("procedural");

    expect(dispose).toHaveBeenCalledOnce();
    expect(textureController.getAlbedoArray()).toBeNull();
    expect(textureController.getNormalArray()).toBeNull();
  });
});
