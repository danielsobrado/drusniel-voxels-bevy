import { describe, expect, it } from "vitest";
import { defaultAzgaarImportConfig } from "./azgaar_map_loader.js";
import {
  importAzgaarFullJson,
  isAzgaarFullJson,
  type AzgaarFullJsonDocument,
} from "./azgaar_json_importer.js";
import { decodeMacroAtlas } from "./azgaar_macro_world_source.js";

function document(): AzgaarFullJsonDocument {
  return {
    info: {
      description: "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
      mapName: "Validation Test",
      width: 100,
      height: 100,
    },
    grid: {
      cellsX: 1,
      cellsY: 1,
      cells: [{ i: 0, h: 50 }],
    },
    pack: {
      cells: [{ i: 0, g: 0, h: 50, biome: 1 }],
    },
  };
}

describe("Azgaar import validation", () => {
  it("rejects empty grids before rasterization", () => {
    const source = document();
    source.grid!.cells = [];

    expect(isAzgaarFullJson(source)).toBe(false);
    expect(() => importAzgaarFullJson(source, defaultAzgaarImportConfig({ atlasLongEdge: 2 })))
      .toThrow(/non-empty grid cells/);
  });

  it("rejects overflowing grid dimensions", () => {
    const source = document();
    source.grid!.cellsX = 0x7fffffff;
    source.grid!.cellsY = 2;

    expect(isAzgaarFullJson(source)).toBe(false);
    expect(() => importAzgaarFullJson(source, defaultAzgaarImportConfig({ atlasLongEdge: 2 })))
      .toThrow(/supported positive grid dimensions/);
  });

  it("rejects invalid tile sizes", () => {
    expect(() => importAzgaarFullJson(document(), defaultAzgaarImportConfig({
      atlasLongEdge: 2,
      tileSize: 0,
    }))).toThrow(/tile size must be positive/);
  });

  it("rejects oversized atlas configs before allocation", () => {
    expect(() => importAzgaarFullJson(document(), defaultAzgaarImportConfig({
      atlasLongEdge: 5000,
    }))).toThrow(/supported raw size limit/);
  });

  it("rejects corrupt payload lengths before decoding", () => {
    const imported = importAzgaarFullJson(
      document(),
      defaultAzgaarImportConfig({ atlasLongEdge: 2 }),
    );
    imported.baseTerrain.atlas.heightData.length = Number.MAX_SAFE_INTEGER;

    expect(() => decodeMacroAtlas(imported.baseTerrain))
      .toThrow(/dimensions do not match its payloads/);
  });

  it("rejects non-canonical base64 instead of relying on permissive Node decoding", () => {
    const imported = importAzgaarFullJson(
      document(),
      defaultAzgaarImportConfig({ atlasLongEdge: 2 }),
    );
    imported.baseTerrain.atlas.heightData.data = "!!!!";

    expect(() => decodeMacroAtlas(imported.baseTerrain))
      .toThrow(/not valid base64/);
  });

  it("rejects RLE payloads larger than the equivalent raw data", () => {
    const imported = importAzgaarFullJson(
      document(),
      defaultAzgaarImportConfig({ atlasLongEdge: 2 }),
    );
    imported.baseTerrain.atlas.heightData = {
      encoding: "base64-rle-u8-v1",
      data: "AQABAwAC",
      length: 4,
    };

    expect(() => decodeMacroAtlas(imported.baseTerrain))
      .toThrow(/exceeds its expected size/);
  });

  it("rejects invalid serialized atlas dimensions", () => {
    const imported = importAzgaarFullJson(
      document(),
      defaultAzgaarImportConfig({ atlasLongEdge: 2 }),
    );
    imported.baseTerrain.atlas.width = 0;

    expect(() => decodeMacroAtlas(imported.baseTerrain))
      .toThrow(/dimensions must be positive safe integers/);
  });

  it("rejects oversized serialized atlas dimensions before decoding", () => {
    const imported = importAzgaarFullJson(
      document(),
      defaultAzgaarImportConfig({ atlasLongEdge: 2 }),
    );
    imported.baseTerrain.atlas.width = 5000;
    imported.baseTerrain.atlas.height = 5000;

    expect(() => decodeMacroAtlas(imported.baseTerrain))
      .toThrow(/supported raw size limit/);
  });
});
