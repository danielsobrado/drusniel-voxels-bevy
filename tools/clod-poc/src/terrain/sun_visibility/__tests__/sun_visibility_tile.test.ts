import { describe, expect, it } from "vitest";
import { sunVisibilityTileBounds, sunVisibilityTileCellCenter, worldToSunVisibilityTile } from "../sun_visibility_tile.js";

const tileConfig = { sizeWorld: 128, resolution: 32 };

describe("sun visibility tile mapping", () => {
  it("maps positive world coordinates", () => {
    expect(worldToSunVisibilityTile(129, 255, tileConfig)).toEqual({ tileX: 1, tileZ: 1, lod: 0 });
  });

  it("maps negative world coordinates with floor semantics", () => {
    expect(worldToSunVisibilityTile(-1, -129, tileConfig)).toEqual({ tileX: -1, tileZ: -2, lod: 0 });
  });

  it("returns deterministic bounds", () => {
    expect(sunVisibilityTileBounds({ tileX: -1, tileZ: 2, lod: 0 }, tileConfig)).toEqual({
      minX: -128,
      minZ: 256,
      maxX: 0,
      maxZ: 384,
    });
  });

  it("returns cell centers", () => {
    expect(sunVisibilityTileCellCenter({ tileX: 0, tileZ: 0, lod: 0 }, 0, 0, tileConfig)).toEqual({ x: 2, z: 2 });
  });
});
