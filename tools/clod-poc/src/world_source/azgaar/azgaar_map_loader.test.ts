import { describe, expect, it } from "vitest";
import {
  createMacroAtlasPayload,
  createAzgaarBiomeDefinitions,
  decodeMacroAtlas,
  defaultAzgaarImportConfig,
  importAzgaarFullJson,
  isAzgaarFullJson,
  azgaarMacroToHeightmapSource,
  AzgaarMacroWorldGenerator,
  decodeAzgaarCartographySource,
  loadAzgaarFullJsonDocument,
} from "./index.js";

function createAzgaarDocument() {
  return {
    info: {
      description: "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
      version: "1.99",
      mapId: "test-map",
      mapName: "Test Realm",
      width: 1000,
      height: 800,
      seed: "abc123",
    },
    grid: {
      cellsX: 2,
      cellsY: 2,
      seed: "abc123",
      cells: [
        { i: 0, h: 0 },
        { i: 1, h: 35 },
        { i: 2, h: 82 },
        { i: 3, h: 45 },
      ],
    },
    pack: {
      cells: [
        { i: 0, g: 0, h: 0, biome: 0, p: [250, 200], v: [0, 1, 2] },
        { i: 1, g: 1, h: 35, biome: 1, p: [750, 200], v: [0, 2, 3] },
        { i: 2, g: 2, h: 82, biome: 2, p: [250, 600], v: [0, 3, 1] },
        { i: 3, g: 3, h: 45, biome: 3, p: [750, 600], v: [1, 3, 2] },
      ],
      vertices: [
        { i: 0, p: [0, 0] },
        { i: 1, p: [1000, 0] },
        { i: 2, p: [1000, 800] },
        { i: 3, p: [0, 800] },
      ],
      states: [{ i: 1, name: "Northreach" }],
      burgs: [{ i: 1, name: "Harborwatch", x: 700, y: 200 }],
      rivers: [{ i: 1, name: "Silverrun" }],
    },
    biomesData: {
      name: ["Marine", "Temperate deciduous forest", "Hot desert", "Wetland"],
    },
    notes: [{ id: "note-1", name: "Ancient ruin" }],
  };
}

describe("azgaar map loader", () => {
  it("detects Azgaar Full JSON documents", () => {
    expect(isAzgaarFullJson(createAzgaarDocument())).toBe(true);
    expect(isAzgaarFullJson({ info: {}, grid: { cells: [] } })).toBe(false);
  });

  it("imports a portable macro source and campaign metadata", () => {
    const config = defaultAzgaarImportConfig({ atlasLongEdge: 4, tileSize: 2 });
    const converted = importAzgaarFullJson(createAzgaarDocument(), config);
    expect(converted.format).toBe("azgaar-imported-v1");
    expect(converted.baseTerrain.kind).toBe("azgaar-macro-v1");
    expect(converted.baseTerrain.atlas.width).toBe(4);
    expect(converted.baseTerrain.atlas.height).toBe(3);
    expect(converted.campaign.source.mapName).toBe("Test Realm");
    expect(converted.campaign.cartography?.kind).toBe("azgaar-cartography-v1");
    expect(converted.campaign.burgs[0]).toMatchObject({ name: "Harborwatch" });
    const cartography = decodeAzgaarCartographySource(
      JSON.parse(JSON.stringify(converted.campaign.cartography)),
    );
    expect([...cartography.cellIds]).toEqual([0, 1, 2, 3]);
  });

  it("adapts macro heights into a HeightmapSource luminance raster", () => {
    const loaded = loadAzgaarFullJsonDocument(createAzgaarDocument(), {
      worldCells: 64,
      config: defaultAzgaarImportConfig({ atlasLongEdge: 4 }),
      heightmap: { detailM: 0, seed: 1 },
    });
    expect(loaded.heightmap.width).toBe(4);
    expect(loaded.heightmap.height).toBe(3);
    expect(loaded.heightmap.worldCells).toBe(64);
    expect(loaded.heightmap.data.length).toBe(12);
    expect(Math.max(...loaded.heightmap.data)).toBeGreaterThan(0.2);
  });

  it("keeps macro generator sampling deterministic", () => {
    const width = 4;
    const height = 2;
    const source = {
      kind: "azgaar-macro-v1" as const,
      version: 1 as const,
      source: { version: null, mapId: "generator-test", mapName: "g", seed: "abc" },
      atlas: {
        width,
        height,
        ...createMacroAtlasPayload({
          heights: Uint8Array.from([0, 40, 80, 0, 0, 40, 80, 0]),
          biomes: Uint8Array.from([0, 4, 6, 0, 0, 4, 6, 0]),
          features: Uint16Array.from([2, 1, 1, 2, 2, 1, 1, 2]),
        }),
      },
      physical: {
        widthMeters: 32,
        heightMeters: 16,
        distanceScale: 1,
        distanceUnit: "km",
      },
      bounds: {
        minCellX: -8,
        minCellZ: -4,
        widthCells: 16,
        heightCells: 8,
      },
      oceanTransitionCells: 4,
      terrain: {
        minHeight: -16,
        maxHeight: 48,
        seaLevel: -1.5,
        verticalExaggeration: 1,
        reliefExponent: 1,
      },
      biomes: createAzgaarBiomeDefinitions(),
      rivers: [],
    };
    const decoded = decodeMacroAtlas(source);
    expect(decoded.heights.length).toBe(8);
    const generator = new AzgaarMacroWorldGenerator(source, {
      seed: 91,
      version: 1,
      heightScale: 12,
      seaLevel: -1.5,
    });
    expect(generator.sampleTile(-7, 0)).toBe(0);
    expect(generator.sampleTile(0, 0)).not.toBe(0);
    expect(generator.sampleHeight(0, 0)).toBe(generator.sampleHeight(0, 0));
    const heightmap = azgaarMacroToHeightmapSource(source, { worldCells: 16, detailM: 0 });
    expect(heightmap.data[1]).toBeCloseTo(0.4, 5);
  });

  it("rejects malformed cartography vertex references", () => {
    const document = createAzgaarDocument();
    (document.pack.cells[0] as { v: number[] }).v[0] = 999;
    expect(() => importAzgaarFullJson(document, defaultAzgaarImportConfig({ atlasLongEdge: 4 })))
      .toThrow(/missing vertex 999/);
  });
});
