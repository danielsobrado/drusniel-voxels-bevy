import { describe, expect, it } from "vitest";
import { HydrologySystem } from "./hydrologySystem.js";
import { HydrologyTileCache } from "./hydrologyTileSource.js";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import { sampleInfiniteHydrology } from "./infinite_hydrology.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

const WORLD_CELLS = 1024;

// Undulating deterministic terrain (same family as the tile-source tests).
const sampler: TerrainHeightSampler = {
  surfaceHeight: (x: number, z: number) =>
    24 + Math.sin(x * 0.004) * 14 + Math.cos(z * 0.0031) * 11 + Math.sin((x + z) * 0.0012) * 6,
};

function buildUnified(): HydrologySystem {
  const config = cloneHydrologyConfig();
  config.simRes = 64;
  config.infinite.unifiedStartup = true;
  return HydrologySystem.build(config, WORLD_CELLS, sampler, { infiniteWorldSamples: true });
}

function buildLegacy(): HydrologySystem {
  const config = cloneHydrologyConfig();
  config.simRes = 64;
  config.accumulation.particles = 4000;
  config.accumulation.maxSteps = 60;
  config.fill.iterations = 60;
  config.infinite.unifiedStartup = false;
  return HydrologySystem.build(config, WORLD_CELLS, sampler, { infiniteWorldSamples: true });
}

describe("unified startup hydrology (Phase 3b)", () => {
  const unified = buildUnified();

  it("samples the tile authority inside the startup world (bit-equal to a reference cache)", () => {
    const config = cloneHydrologyConfig();
    const reference = new HydrologyTileCache(sampler, {
      tileSizeM: config.infinite.tileSizeM,
      tileRes: config.infinite.tileRes,
      maxResidentTiles: config.infinite.maxResidentTiles,
      drySentinelDepthM: config.waterSurface.drySentinelDepth,
    });
    for (const [x, z] of [[100, 100], [512.3, 700.7], [WORLD_CELLS - 4, 16], [24, WORLD_CELLS - 24]] as const) {
      const got = unified.sample(x, z, 2);
      const want = reference.sample(x, z);
      expect(got.waterY).toBe(want.waterY);
      expect(got.terrainY).toBe(want.terrainY);
      expect(got.bodyMask).toBe(want.bodyMask);
      expect(got.bodyKind).toBe(want.bodyKind);
      expect(got.bodyId).toBe(want.bodyId);
      expect(got.shoreDistance).toBe(want.shoreDistance);
    }
  });

  it("is continuous across the old startup-world boundary with no blend band", () => {
    // Adjacent samples straddling x=worldCells must come from one authority: the step
    // between them is bounded by ordinary field variation, not an authority switch.
    for (let z = 100; z < WORLD_CELLS; z += 200) {
      const inside = unified.sample(WORLD_CELLS - 0.5, z, 2);
      const outside = unified.sample(WORLD_CELLS + 0.5, z, 2);
      expect(Math.abs(outside.waterY - inside.waterY)).toBeLessThan(0.5);
      expect(Math.abs(outside.bodyMask - inside.bodyMask)).toBeLessThan(0.5);
    }
  });

  it("rasterizes the lattice from the same authority (texel == direct analytic sample)", () => {
    const grid = unified.grid;
    const denom = grid.res - 1;
    const config = cloneHydrologyConfig();
    for (const [gx, gz] of [[0, 0], [13, 40], [denom, denom], [32, 5]] as const) {
      const wx = (gx / denom) * WORLD_CELLS;
      const wz = (gz / denom) * WORLD_CELLS;
      const s = sampleInfiniteHydrology(wx, wz, sampler, { drySentinelDepthM: config.waterSurface.drySentinelDepth });
      const i = gz * grid.res + gx;
      expect(grid.waterY[i]).toBeCloseTo(s.waterY, 4);
      expect(grid.carvedBed[i]).toBeCloseTo(s.terrainY, 4);
      expect(grid.bodyKind[i]).toBe(s.bodyKind);
      expect(grid.shoreDistance[i]).toBeCloseTo(s.shoreDistance, 4);
    }
  });

  it("does not carve terrain: the lattice bed equals the authority terrain", () => {
    const grid = unified.grid;
    for (let i = 0; i < grid.carvedBed.length; i += 97) {
      expect(grid.carvedBed[i]).toBe(grid.originalBed[i]);
    }
  });

  it("reports unified mode and stays legacy when the flag is off", () => {
    expect(unified.unifiedStartupActive()).toBe(true);
    const legacy = buildLegacy();
    expect(legacy.unifiedStartupActive()).toBe(false);
    // Legacy mode still carves rivers somewhere on this terrain.
    let carved = 0;
    for (let i = 0; i < legacy.grid.carvedBed.length; i++) {
      if (legacy.grid.carvedBed[i] < legacy.grid.originalBed[i] - 1e-3) carved++;
    }
    expect(carved).toBeGreaterThan(0);
  });
});
