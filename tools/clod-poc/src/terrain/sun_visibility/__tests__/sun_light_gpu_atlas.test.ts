import { afterEach, describe, expect, it } from "vitest";
import { LIGHT_SAMPLE, type LightTile } from "../light_builder.js";
import {
  getSunLightGpuAtlas,
  invalidateSunLightGpuAtlas,
  sampleSunLightGpuAtlas,
  updateSunLightGpuAtlas,
} from "../sun_light_gpu_atlas.js";
import { parseSunLightOptions } from "../sun_light_options.js";

afterEach(() => {
  invalidateSunLightGpuAtlas();
});

describe("sun light gpu atlas", () => {
  it("re-invalidating an already invalid atlas is a no-op", () => {
    const state = getSunLightGpuAtlas();
    invalidateSunLightGpuAtlas();
    const version = state.version;
    invalidateSunLightGpuAtlas();
    invalidateSunLightGpuAtlas();
    expect(state.version).toBe(version);
    expect(state.valid).toBe(0);
  });

  it("update bumps the version and a later invalidate bumps it once", () => {
    const state = getSunLightGpuAtlas();
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 4 },
      build: { material_tile_radius: 1 },
    });
    const version = state.version;
    updateSunLightGpuAtlas({ tileX: 0, tileZ: 0, lod: 0 }, [], options);
    expect(state.version).toBe(version + 1);
    expect(state.valid).toBe(1);
    invalidateSunLightGpuAtlas();
    expect(state.version).toBe(version + 2);
    expect(state.valid).toBe(0);
    invalidateSunLightGpuAtlas();
    expect(state.version).toBe(version + 2);
  });

  it("samples lit and shaded texels and fails closed for missing or outside cells", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 2 },
      build: { material_tile_radius: 0 },
    });
    const tile: LightTile = {
      key: { tileX: 0, tileZ: 0, lod: 0 },
      sunBin: {} as LightTile["sunBin"],
      terrainRevision: 7,
      resolution: 2,
      values: new Uint8Array([
        LIGHT_SAMPLE.lit,
        LIGHT_SAMPLE.shaded,
        LIGHT_SAMPLE.missing,
        LIGHT_SAMPLE.lit,
      ]),
      builtAtFrame: 9,
    };

    updateSunLightGpuAtlas(tile.key, [tile], options);
    const revision = getSunLightGpuAtlas().version;

    expect(sampleSunLightGpuAtlas(8, 8)).toEqual({
      visibility: 1,
      valid: true,
      revision,
      cellSizeM: 16,
    });
    expect(sampleSunLightGpuAtlas(24, 8)).toEqual({
      visibility: 0,
      valid: true,
      revision,
      cellSizeM: 16,
    });
    expect(sampleSunLightGpuAtlas(8, 24)).toEqual({
      visibility: 1,
      valid: false,
      revision,
      cellSizeM: 16,
    });
    expect(sampleSunLightGpuAtlas(-1, 8)).toEqual({
      visibility: 1,
      valid: false,
      revision,
      cellSizeM: 16,
    });
  });
});
