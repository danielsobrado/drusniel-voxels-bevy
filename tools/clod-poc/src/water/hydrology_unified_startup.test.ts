import { describe, expect, it } from "vitest";
import { createHydrologyGrid } from "./hydrologyGrid.js";
import { HydrologySystem } from "./hydrologySystem.js";
import { HydrologyTileCache } from "./hydrologyTileSource.js";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import { evaluateHydrologyInvariants } from "./hydrologyInvariants.js";
import { readHydrologyConfig } from "./water_config_hydrology_parsing.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

const WORLD_CELLS = 1024;

const sampler: TerrainHeightSampler = {
  surfaceHeight: (x: number, z: number) =>
    24 + Math.sin(x * 0.004) * 14 + Math.cos(z * 0.0031) * 11 + Math.sin((x + z) * 0.0012) * 6,
};

function unifiedConfig() {
  const config = cloneHydrologyConfig();
  config.simRes = 64;
  config.infinite.tileRes = 32;
  config.infinite.maxResidentTiles = 64;
  config.infinite.unifiedStartup = true;
  return config;
}

function buildUnified(): HydrologySystem {
  return HydrologySystem.build(unifiedConfig(), WORLD_CELLS, sampler, { infiniteWorldSamples: true });
}

function referenceCache(): HydrologyTileCache {
  const config = unifiedConfig();
  return new HydrologyTileCache(sampler, {
    tileSizeM: config.infinite.tileSizeM,
    tileRes: config.infinite.tileRes,
    maxResidentTiles: config.infinite.maxResidentTiles,
    drySentinelDepthM: config.waterSurface.drySentinelDepth,
  });
}

function expectSameSample(
  got: ReturnType<HydrologySystem["sample"]>,
  want: ReturnType<HydrologyTileCache["sample"]>,
): void {
  expect(got.waterY).toBe(want.waterY);
  expect(got.terrainY).toBe(want.terrainY);
  expect(got.bodyMask).toBe(want.bodyMask);
  expect(got.lakeMask).toBe(want.lakeMask);
  expect(got.riverMask).toBe(want.riverMask);
  expect(got.flowX).toBe(want.flowX);
  expect(got.flowZ).toBe(want.flowZ);
  expect(got.flowStrength).toBe(want.flowStrength);
  expect(got.bodyKind).toBe(want.bodyKind);
  expect(got.bodyId).toBe(want.bodyId);
  expect(got.shoreDistance).toBe(want.shoreDistance);
}

describe("unified startup hydrology (Phase 3b)", () => {
  const unified = buildUnified();

  it("parses the YAML authority flag while preserving the legacy default", () => {
    expect(cloneHydrologyConfig().infinite.unifiedStartup).toBe(false);
    const parsed = readHydrologyConfig({ infinite: { unified_startup: true } });
    expect(parsed.infinite.unifiedStartup).toBe(true);
  });

  it("uses the tile authority inside the startup world", () => {
    const reference = referenceCache();
    for (const [x, z] of [
      [100, 100],
      [512.3, 700.7],
      [WORLD_CELLS - 4, 16],
      [24, WORLD_CELLS - 24],
    ] as const) {
      expectSameSample(unified.sample(x, z, 2), reference.sample(x, z));
    }
  });

  it("has no authority switch at the old startup-world boundary", () => {
    const reference = referenceCache();
    for (const z of [100, 300, 500, 700, 900]) {
      for (const x of [WORLD_CELLS - 0.5, WORLD_CELLS, WORLD_CELLS + 0.5]) {
        expectSameSample(unified.sample(x, z, 2), reference.sample(x, z));
      }
    }
  });

  it("rasterizes the startup GPU grid from the same authority", () => {
    const grid = unified.grid;
    const denom = grid.res - 1;
    for (const [gx, gz] of [[0, 0], [13, 40], [denom, denom], [32, 5]] as const) {
      const worldX = (gx / denom) * WORLD_CELLS;
      const worldZ = (gz / denom) * WORLD_CELLS;
      const sample = unified.sample(worldX, worldZ, 2);
      const index = gz * grid.res + gx;
      expect(grid.waterY[index]).toBeCloseTo(sample.waterY, 4);
      expect(grid.carvedBed[index]).toBeCloseTo(sample.terrainY, 4);
      expect(grid.bodyKind[index]).toBe(sample.bodyKind);
      expect(grid.bodyId[index]).toBe(sample.bodyId);
      expect(grid.shoreDistance[index]).toBeCloseTo(sample.shoreDistance, 4);
    }
  });

  it("does not install a second terrain carve authority", () => {
    const grid = unified.grid;
    expect(unified.unifiedStartupActive()).toBe(true);
    for (let index = 0; index < grid.carvedBed.length; index += 97) {
      expect(grid.carvedBed[index]).toBe(grid.originalBed[index]);
    }
    for (const [x, z] of [[10, 20], [512, 700], [1300, -40]] as const) {
      expect(unified.terrainHeight(x, z)).toBe(sampler.surfaceHeight(x, z));
    }
  });

  it("evaluates sparse traced body ids without dense allocation", () => {
    const grid = createHydrologyGrid(2, 1, { surfaceHeight: () => 0 });
    grid.wetMask[0] = 1;
    grid.lakeMask[0] = 1;
    grid.bodyKind[0] = 2;
    grid.bodyId[0] = 2_000_000_000;
    grid.waterY[0] = 1;
    const report = evaluateHydrologyInvariants(grid);
    expect(report.bodyCount).toBe(1);
    expect(report.wetWithoutBodyIdCount).toBe(0);
  });

  it("keeps legacy finite-grid mode available when the flag is off", () => {
    const config = cloneHydrologyConfig();
    config.simRes = 32;
    config.accumulation.particles = 1000;
    config.accumulation.maxSteps = 30;
    config.fill.iterations = 30;
    config.infinite.unifiedStartup = false;
    const legacy = HydrologySystem.build(config, 256, sampler, { infiniteWorldSamples: true });
    expect(legacy.unifiedStartupActive()).toBe(false);
  });
});
