import { describe, expect, it } from "vitest";
import { HydrologySystem } from "./hydrologySystem.js";
import { sampleHydrologyGrid } from "./hydrologyGrid.js";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

const WORLD_CELLS = 512;

const sampler: TerrainHeightSampler = {
  surfaceHeight: (x: number, z: number) =>
    24 + Math.sin(x * 0.004) * 14 + Math.cos(z * 0.0031) * 11 + Math.sin((x + z) * 0.0012) * 6,
};

function buildSystem(): HydrologySystem {
  // Small, fast hydrology build — the boundary behaviour under test does not depend on
  // simulation fidelity. This suite covers the legacy grid + boundary blend, so it pins
  // unifiedStartup off now that the default is the unified authority.
  const config = cloneHydrologyConfig();
  config.infinite.unifiedStartup = false;
  config.simRes = 64;
  config.accumulation.particles = 4000;
  config.accumulation.maxSteps = 60;
  config.fill.iterations = 60;
  config.infinite.tileRes = 32;
  return HydrologySystem.build(config, WORLD_CELLS, sampler, { infiniteWorldSamples: true });
}

describe("hydrology boundary blend", () => {
  const hydrology = buildSystem();

  it("uses the pure grid deep inside the world", () => {
    const x = WORLD_CELLS / 2;
    const z = WORLD_CELLS / 2;
    const effective = hydrology.sample(x, z);
    const grid = sampleHydrologyGrid(hydrology.grid, x, z);
    expect(effective.waterY).toBe(grid.waterY);
    expect(effective.bodyMask).toBe(grid.bodyMask);
  });

  it("matches the infinite field at the world edge (continuous across the boundary)", () => {
    for (const z of [64, 200, 333]) {
      const atEdge = hydrology.sample(WORLD_CELLS, z);
      const outside = hydrology.sample(WORLD_CELLS + 0.01, z);
      expect(Math.abs(outside.waterY - atEdge.waterY)).toBeLessThan(0.05);
      expect(Math.abs(outside.bodyMask - atEdge.bodyMask)).toBeLessThan(0.05);
    }
  });

  it("keeps the water surface continuous while walking across the boundary", () => {
    let maxWaterYStep = 0;
    for (const z of [96, 256, 410]) {
      let prev = hydrology.sample(WORLD_CELLS - 96, z);
      for (let x = WORLD_CELLS - 96 + 0.5; x <= WORLD_CELLS + 96; x += 0.5) {
        const cur = hydrology.sample(x, z);
        if (prev.bodyMask > 0.05 || cur.bodyMask > 0.05) {
          maxWaterYStep = Math.max(maxWaterYStep, Math.abs(cur.waterY - prev.waterY));
        }
        prev = cur;
      }
    }
    // 0.5 m steps over smooth fields: no hard surface jumps (a hard authority seam is
    // metres tall). The body mask is intentionally NOT bounded here: basin/channel
    // containment uses hard wet->dry cutoffs at shorelines, so mask steps are legitimate
    // wherever a body edge crosses the walk.
    expect(maxWaterYStep).toBeLessThan(1.0);
  });
});
