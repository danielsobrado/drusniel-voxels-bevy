import { describe, expect, it } from "vitest";
import {
  getTerrainLayerAverageAlbedo,
  recordTerrainLayerAverageAlbedos,
  terrainLayerAverageAlbedoRevision,
} from "./terrain_layer_average_albedo.js";

describe("terrain layer average albedo", () => {
  it("averages baked layers in linear space and bumps the revision", () => {
    const layerSize = 2;
    // One layer, all texels sRGB 128 -> linear ~0.2158.
    const albedo = new Uint8Array(layerSize * layerSize * 4).fill(128);
    const before = terrainLayerAverageAlbedoRevision();
    recordTerrainLayerAverageAlbedos(["grass"], albedo, layerSize);
    expect(terrainLayerAverageAlbedoRevision()).toBe(before + 1);
    const [r, g, b] = getTerrainLayerAverageAlbedo("grass");
    expect(r).toBeCloseTo(0.2158, 3);
    expect(g).toBeCloseTo(0.2158, 3);
    expect(b).toBeCloseTo(0.2158, 3);
  });

  it("falls back to the sRGB-decoded recipe base colour for non-resident layers", () => {
    const [r, g, b] = getTerrainLayerAverageAlbedo("swamp-muck");
    // swamp-muck base_color [0.12, 0.16, 0.10] decoded sRGB->linear.
    expect(r).toBeCloseTo(0.0137, 3);
    expect(g).toBeCloseTo(0.0219, 3);
    expect(b).toBeCloseTo(0.0100, 3);
  });
});
