import { describe, expect, it } from "vitest";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import { HydrologySystem } from "./hydrologySystem.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

const sampler: TerrainHeightSampler = {
  surfaceHeight: (x, z) => 30 + Math.sin(x * 0.01) * 4 + Math.cos(z * 0.008) * 3,
};

describe("far-summary hydrology coarse bypass", () => {
  it("does not construct fine hydrology tiles for 32m-or-coarser summary samples", () => {
    const config = cloneHydrologyConfig();
    config.simRes = 32;
    config.infinite.tileRes = 16;
    config.infinite.maxResidentTiles = 16;
    config.infinite.unifiedStartup = true;

    const hydrology = HydrologySystem.build(config, 512, sampler, {
      infiniteWorldSamples: true,
    });
    const bypass = hydrology.tileCoarseBypassCellSize();
    expect(bypass).not.toBeNull();
    expect(bypass!).toBeLessThan(32);

    const before = hydrology.tileCacheStats()?.builds ?? 0;
    for (const [x, z] of [
      [2048, 2048],
      [4096, -1024],
      [-3072, 5120],
    ] as const) {
      hydrology.sample(x, z, 32);
      hydrology.sample(x, z, 64);
      hydrology.sample(x, z, 128);
    }

    expect(hydrology.tileCacheStats()?.builds ?? 0).toBe(before);
  });
});
