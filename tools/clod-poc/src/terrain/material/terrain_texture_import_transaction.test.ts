import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTexture: vi.fn(),
  configureNormal: vi.fn(),
}));

vi.mock("./texture_loader.js", () => ({
  loadTerrainTextureUrl: mocks.loadTexture,
  configureNormalTexture: mocks.configureNormal,
}));
vi.mock("./terrain_builtin_textures.js", () => ({
  BUILTIN_TERRAIN_TEXTURES: [
    { id: "rock", label: "Rock", url: "builtin:rock", normalUrl: "builtin:rock-normal" },
  ],
}));

import {
  disposeImportedTerrainTextureResources,
  loadImportedTerrainTextureResources,
} from "./terrain_texture_import_transaction.js";

function texture() {
  return { dispose: vi.fn() };
}

function customSlot(index: number, normal = false) {
  return {
    index,
    source: "custom",
    name: `custom-${index}`,
    selectedId: "custom",
    scale: 1,
    heightMin: 0,
    heightMax: 100,
    customPath: `textures/${index}.png`,
    mimeType: "image/png",
    normalPath: normal ? `textures/${index}-normal.png` : undefined,
    normalMimeType: normal ? "image/png" : undefined,
  };
}

let blobIndex = 0;

beforeEach(() => {
  vi.clearAllMocks();
  blobIndex = 0;
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:${++blobIndex}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("imported terrain texture transaction", () => {
  it("releases earlier resources when a later texture fails", async () => {
    const first = texture();
    mocks.loadTexture
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(null);

    await expect(loadImportedTerrainTextureResources({
      manifest: [customSlot(0), customSlot(1)],
      customTextures: new Map([
        ["textures/0.png", new Uint8Array([1])],
        ["textures/1.png", new Uint8Array([2])],
      ]),
      options: { textureMipmapsEnabled: false, maxAnisotropy: 1 },
      progress: { setPhase: vi.fn() },
    })).rejects.toThrow(/could not decode textures\/1\.png/i);

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:2");
  });

  it("keeps successful resources until ownership is explicitly released", async () => {
    const albedo = texture();
    const normal = texture();
    mocks.loadTexture
      .mockResolvedValueOnce(albedo)
      .mockResolvedValueOnce(normal);

    const resources = await loadImportedTerrainTextureResources({
      manifest: [customSlot(0, true)],
      customTextures: new Map([
        ["textures/0.png", new Uint8Array([1])],
        ["textures/0-normal.png", new Uint8Array([2])],
      ]),
      options: { textureMipmapsEnabled: true, maxAnisotropy: 8 },
      progress: { setPhase: vi.fn() },
    });

    expect(resources).toHaveLength(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(mocks.configureNormal).toHaveBeenCalledWith(normal, {
      textureMipmapsEnabled: true,
      maxAnisotropy: 8,
    });

    disposeImportedTerrainTextureResources(resources);
    expect(albedo.dispose).toHaveBeenCalledOnce();
    expect(normal.dispose).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:2");
  });

  it("cleans the albedo when declared normal bytes are missing", async () => {
    const albedo = texture();
    mocks.loadTexture.mockResolvedValueOnce(albedo);

    await expect(loadImportedTerrainTextureResources({
      manifest: [customSlot(0, true)],
      customTextures: new Map([["textures/0.png", new Uint8Array([1])]]),
      options: { textureMipmapsEnabled: false, maxAnisotropy: 1 },
      progress: { setPhase: vi.fn() },
    })).rejects.toThrow(/missing textures\/0-normal\.png/i);

    expect(albedo.dispose).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
  });

  it("loads built-in albedo and normal as one owned resource", async () => {
    const albedo = texture();
    const normal = texture();
    mocks.loadTexture
      .mockResolvedValueOnce(albedo)
      .mockResolvedValueOnce(normal);

    const resources = await loadImportedTerrainTextureResources({
      manifest: [{
        index: 0,
        source: "builtin",
        name: "Rock",
        selectedId: "rock",
        scale: 1,
        heightMin: 0,
        heightMax: 100,
      }],
      customTextures: new Map(),
      options: { textureMipmapsEnabled: false, maxAnisotropy: 1 },
      progress: { setPhase: vi.fn() },
    });

    expect(resources[0]?.previewUrl).toBe("builtin:rock");
    expect(resources[0]?.normalPreviewUrl).toBe("builtin:rock-normal");
    expect(resources[0]?.revokePreviewUrl).toBe(false);
    expect(resources[0]?.revokeNormalPreviewUrl).toBe(false);
  });
});
