import { describe, expect, it } from "vitest";
import { HydrologyStreamingAtlas, type HydrologyTileAtlasSource } from "./hydrologyAtlas.js";
import { HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";
import type { HydrologyTile } from "./hydrologyTileSource.js";

function tile(): HydrologyTile {
  const res = 4;
  const count = (res + 1) * (res + 1);
  const floats = () => new Float32Array(count);
  const bodyKind = new Uint8Array(count);
  const bodyId = new Uint32Array(count);
  bodyKind.fill(HYDROLOGY_BODY_RIVER);
  bodyId.fill(42);
  const shoreDistance = floats();
  shoreDistance.fill(2);
  return {
    key: "0,0",
    tileX: 0,
    tileZ: 0,
    res,
    terrainY: floats(),
    waterY: floats(),
    bodyMask: floats(),
    lakeMask: floats(),
    riverMask: floats(),
    flowX: floats(),
    flowZ: floats(),
    flowStrength: floats(),
    riverDepth: floats(),
    moisture: floats(),
    shoreDistance,
    bodyKind,
    bodyId,
  };
}

function source(value: HydrologyTile): HydrologyTileAtlasSource {
  return {
    tileSizeM: 16,
    tileRes: 4,
    atlasTilesPerSide: 1,
    peek: () => value,
    prefetch: () => undefined,
  };
}

describe("hydrology atlas gravel phase isolation", () => {
  it("encodes phase only for the vegetation atlas option", () => {
    const value = tile();
    const raw = new HydrologyStreamingAtlas({ tileSizeM: 16, tileRes: 4, tilesPerSide: 1 });
    const vegetation = new HydrologyStreamingAtlas({
      tileSizeM: 16,
      tileRes: 4,
      tilesPerSide: 1,
      encodeBodyPhaseInKindLane: true,
    });
    raw.update(8, 8, source(value));
    vegetation.update(8, 8, source(value));

    expect(raw.dataB[3]).toBe(HYDROLOGY_BODY_RIVER);
    expect(vegetation.dataB[3]).toBeGreaterThan(HYDROLOGY_BODY_RIVER);
    expect(Math.round(vegetation.dataB[3])).toBe(HYDROLOGY_BODY_RIVER);
  });
});
