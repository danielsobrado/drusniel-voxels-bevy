import { afterEach, describe, expect, it } from "vitest";
import {
  baseSurfaceHeight,
  setTerrainFieldConfig,
  setTerrainSurfaceOverride,
} from "../terrain/terrain.js";
import {
  STARTUP_HEIGHTFIELD_PADDING_CELLS,
  buildStartupHeightfieldRaster,
} from "../terrain/startup_heightfield_raster.js";
import {
  proceduralHeightfieldSampler,
  startupRasterHeightfieldSampler,
} from "./heightfield_sampler.js";

const WORLD_CELLS = 32;

function requireRaster() {
  const raster = buildStartupHeightfieldRaster(WORLD_CELLS);
  expect(raster).not.toBeNull();
  return raster!;
}

describe("heightfield sampler contract", () => {
  afterEach(() => {
    setTerrainSurfaceOverride(null);
    setTerrainFieldConfig(null);
  });

  it("wraps the procedural field without changing values", () => {
    setTerrainFieldConfig({ seed: 37 });
    const sampler = proceduralHeightfieldSampler(4);

    expect(sampler.kind).toBe("procedural");
    expect(sampler.domain).toBeNull();
    expect(sampler.sourceRevision).toBe(4);
    for (const [x, z] of [[0, 0], [-257, 511], [16.25, -9.75]] as const) {
      expect(sampler.sampleHeight(x, z)).toBe(baseSurfaceHeight(x, z));
    }
  });

  it("keeps startup raster and procedural values bit-identical across seeds", () => {
    for (const seed of [0, 17, 1_337]) {
      setTerrainFieldConfig({ seed });
      const raster = requireRaster();
      const sampler = startupRasterHeightfieldSampler(raster, seed);

      expect(sampler.kind).toBe("startup_raster");
      expect(sampler.sourceRevision).toBe(seed);
      expect(sampler.domain).toEqual({
        minX: -STARTUP_HEIGHTFIELD_PADDING_CELLS,
        minZ: -STARTUP_HEIGHTFIELD_PADDING_CELLS,
        maxX: WORLD_CELLS + STARTUP_HEIGHTFIELD_PADDING_CELLS + 1,
        maxZ: WORLD_CELLS + STARTUP_HEIGHTFIELD_PADDING_CELLS + 1,
      });

      for (const [x, z] of [
        [-STARTUP_HEIGHTFIELD_PADDING_CELLS, -STARTUP_HEIGHTFIELD_PADDING_CELLS],
        [0, 0],
        [7, 21],
        [WORLD_CELLS, WORLD_CELLS],
        [WORLD_CELLS + STARTUP_HEIGHTFIELD_PADDING_CELLS, 3],
        [4.25, 9.6],
        [-1.5, 3.75],
        [WORLD_CELLS + STARTUP_HEIGHTFIELD_PADDING_CELLS + 1, 10],
        [-STARTUP_HEIGHTFIELD_PADDING_CELLS - 1, 4],
      ] as const) {
        expect(sampler.sampleHeight(x, z)).toBe(baseSurfaceHeight(x, z));
      }
    }
  });
});
