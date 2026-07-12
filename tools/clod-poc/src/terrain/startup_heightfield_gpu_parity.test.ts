import { afterEach, describe, expect, it } from "vitest";
import {
  baseSurfaceHeight,
  resolveTerrainFieldConfig,
  setTerrainFieldConfig,
  setTerrainSurfaceOverride,
} from "./terrain.js";
import { buildStartupHeightfieldRaster, makeStartupHeightfieldSampler } from "./startup_heightfield_raster.js";
import { setTerrainFieldCoreConfig, surfaceHeightCore } from "../gpu/terrain_field_core.js";

function gradient(sample: (x: number, z: number) => number, x: number, z: number): [number, number] {
  const e = 0.5;
  return [sample(x + e, z) - sample(x - e, z), sample(x, z + e) - sample(x, z - e)];
}

describe("startup heightfield CPU/GPU field parity", () => {
  afterEach(() => {
    setTerrainSurfaceOverride(null);
    setTerrainFieldConfig(null);
    setTerrainFieldCoreConfig(null);
  });

  for (const seed of [1, 17, 91]) {
    it(`matches the GPU field-core contract across the raster boundary for seed ${seed}`, () => {
      const config = resolveTerrainFieldConfig({
        seed,
        seaLevel: 18,
        islandShape: {
          enabled: true,
          oceanRim: true,
          worldRadiusM: 8192,
          spacingM: 1500,
          radiusM: 560,
          blendM: 260,
        },
      });
      setTerrainFieldConfig(config);
      setTerrainFieldCoreConfig(config);

      const raster = buildStartupHeightfieldRaster(64);
      expect(raster).not.toBeNull();
      const sampler = makeStartupHeightfieldSampler(raster!);
      const maxCell = raster!.minCell + raster!.res - 1;
      const points = [
        [raster!.minCell, raster!.minCell],
        [0, 0],
        [31, 47],
        [maxCell, maxCell - 3],
        [raster!.minCell - 1, 4],
        [maxCell + 1, 11],
        [maxCell - 0.5, 20.25],
        [maxCell + 0.5, 20.25],
      ] as const;

      for (const [x, z] of points) {
        expect(sampler(x, z)).toBeCloseTo(surfaceHeightCore(x, z, config), 12);
        expect(sampler(x, z)).toBe(baseSurfaceHeight(x, z));
        const cpuGradient = gradient(sampler, x, z);
        const gpuGradient = gradient((sx, sz) => surfaceHeightCore(sx, sz, config), x, z);
        expect(cpuGradient[0]).toBeCloseTo(gpuGradient[0], 12);
        expect(cpuGradient[1]).toBeCloseTo(gpuGradient[1], 12);
      }
    });
  }
});
