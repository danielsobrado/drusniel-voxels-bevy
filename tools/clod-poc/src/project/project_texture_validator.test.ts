import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_TEXTURE_MAX_DIMENSION,
  validateProjectArchiveTextures,
} from "./project_texture_validator.js";
import type { VoxelProjectArchiveContents } from "./voxel_project_archive.js";

let nextWidth = 1024;
let nextHeight = 1024;
let assignedSources = 0;

class FakeImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    assignedSources += 1;
    this.naturalWidth = nextWidth;
    this.naturalHeight = nextHeight;
    queueMicrotask(() => this.onload?.());
  }
}

function contents(): VoxelProjectArchiveContents {
  return {
    manifest: {
      schemaVersion: 3,
      kind: "drusniel-clod-project",
      exportedAt: "2026-07-18T00:00:00.000Z",
      worldSize: 4,
      config: {} as never,
      state: {} as never,
      water: {} as never,
      weather: {} as never,
      voxelTerrainEdits: { revision: 0, deltas: [] },
      props: [],
      textures: [{
        index: 0,
        source: "custom",
        name: "soil",
        selectedId: "custom",
        scale: 1,
        heightMin: 0,
        heightMax: 100,
        customPath: "textures/soil.png",
        mimeType: "image/png",
        normalPath: "textures/soil-normal.png",
        normalMimeType: "image/png",
      }],
      camera: { position: [0, 0, 0], target: [0, 0, 0] },
    },
    customTextures: new Map([
      ["textures/soil.png", new Uint8Array([1])],
      ["textures/soil-normal.png", new Uint8Array([2])],
    ]),
  };
}

beforeEach(() => {
  nextWidth = 1024;
  nextHeight = 1024;
  assignedSources = 0;
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:test"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("project archive texture validation", () => {
  it("decodes and bounds both custom albedo and normal maps", async () => {
    await expect(validateProjectArchiveTextures(contents())).resolves.toBeUndefined();
    expect(assignedSources).toBe(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("accepts decodable image payloads when the browser supplied no MIME type", async () => {
    const input = contents();
    input.manifest.textures[0]!.mimeType = "application/octet-stream";
    input.manifest.textures[0]!.normalMimeType = "application/octet-stream";
    await expect(validateProjectArchiveTextures(input)).resolves.toBeUndefined();
    expect(assignedSources).toBe(2);
  });

  it("rejects decoded images above the dimension budget", async () => {
    nextWidth = PROJECT_TEXTURE_MAX_DIMENSION + 1;
    await expect(validateProjectArchiveTextures(contents())).rejects.toThrow(/dimension limit/i);
  });

  it("rejects unsupported MIME types before decoding", async () => {
    const input = contents();
    input.manifest.textures[0]!.mimeType = "text/html";
    await expect(validateProjectArchiveTextures(input)).rejects.toThrow(/unsupported MIME type/i);
    expect(assignedSources).toBe(0);
  });

  it("requires normal-map bytes declared by the manifest", async () => {
    const input = contents();
    input.customTextures.delete("textures/soil-normal.png");
    await expect(validateProjectArchiveTextures(input)).rejects.toThrow(/soil-normal\.png/i);
  });
});
