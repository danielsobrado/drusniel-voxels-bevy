import { describe, expect, it } from "vitest";
import { getSunLightGpuAtlas, invalidateSunLightGpuAtlas, updateSunLightGpuAtlas } from "../sun_light_gpu_atlas.js";
import { parseSunLightOptions } from "../sun_light_options.js";

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
});
