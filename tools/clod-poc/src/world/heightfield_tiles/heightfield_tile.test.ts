import { afterEach, describe, expect, it } from "vitest";
import {
  baseSurfaceHeight,
  resolveTerrainFieldConfig,
  setTerrainFieldConfig,
} from "../../terrain/terrain_surface.js";
import { tileOriginM, type WorldTileKey } from "../tile_key.js";
import {
  buildHeightfieldTile,
  HEIGHTFIELD_TILE_RES,
  heightfieldTileSample,
} from "./heightfield_tile.js";

afterEach(() => {
  setTerrainFieldConfig(null);
});

function buildForSeed(seed: number, key: WorldTileKey) {
  setTerrainFieldConfig(resolveTerrainFieldConfig({
    seed,
    islandShape: { enabled: true, seed },
  }));
  return buildHeightfieldTile(key, { sampleHeight: baseSurfaceHeight, sourceRevision: 0 });
}

describe("buildHeightfieldTile", () => {
  it.each([
    { seed: 1, key: { x: 0, z: 0 } },
    { seed: 2, key: { x: -1, z: 0 } },
    { seed: 3, key: { x: 0, z: -1 } },
  ])("stores the authoritative f32 quantization of the procedural field for seed $seed at $key", ({ seed, key }) => {
    const tile = buildForSeed(seed, key);
    const origin = tileOriginM(key);
    const probes = [
      [0, 0],
      [1, 1],
      [31, 197],
      [128, 128],
      [255, 7],
      [256, 256],
    ] as const;

    expect(tile.res).toBe(HEIGHTFIELD_TILE_RES);
    for (const [localX, localZ] of probes) {
      expect(heightfieldTileSample(tile, localX, localZ)).toBe(
        Math.fround(baseSurfaceHeight(origin.x + localX, origin.z + localZ)),
      );
    }
  });

  it("builds exact shared borders for positive and negative neighbors", () => {
    setTerrainFieldConfig(resolveTerrainFieldConfig({ seed: 7 }));
    const center = buildHeightfieldTile({ x: 0, z: 0 }, { sampleHeight: baseSurfaceHeight });
    const west = buildHeightfieldTile({ x: -1, z: 0 }, { sampleHeight: baseSurfaceHeight });
    const north = buildHeightfieldTile({ x: 0, z: -1 }, { sampleHeight: baseSurfaceHeight });

    for (let i = 0; i < HEIGHTFIELD_TILE_RES; i++) {
      expect(heightfieldTileSample(west, HEIGHTFIELD_TILE_RES - 1, i)).toBe(
        heightfieldTileSample(center, 0, i),
      );
      expect(heightfieldTileSample(north, i, HEIGHTFIELD_TILE_RES - 1)).toBe(
        heightfieldTileSample(center, i, 0),
      );
    }
  });

  it("is deterministic", () => {
    setTerrainFieldConfig(resolveTerrainFieldConfig({ seed: 11 }));
    const first = buildHeightfieldTile({ x: -2, z: 3 }, { sampleHeight: baseSurfaceHeight }, 4);
    const second = buildHeightfieldTile({ x: -2, z: 3 }, { sampleHeight: baseSurfaceHeight }, 4);

    expect(second.key).toEqual(first.key);
    expect(second.res).toBe(first.res);
    expect(second.sourceRevision).toBe(first.sourceRevision);
    expect(second.heights).toEqual(first.heights);
  });

  it("rejects invalid source revisions", () => {
    expect(() => buildHeightfieldTile({ x: 0, z: 0 }, { sampleHeight: () => 0 }, -1)).toThrow(
      /sourceRevision/,
    );
  });
});
