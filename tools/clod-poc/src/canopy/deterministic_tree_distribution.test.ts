import { describe, expect, it } from "vitest";
import { DEFAULT_CANOPY_SHELL_CONFIG } from "./canopy_defaults.js";
import { createTreeDistribution } from "./deterministic_tree_distribution.js";
import { createAnalyticTerrainSampler } from "./canopy_terrain_sampler.js";

describe("deterministic tree distribution", () => {
  const distA = createTreeDistribution(DEFAULT_CANOPY_SHELL_CONFIG.treeDistribution, 12345);
  const distB = createTreeDistribution(DEFAULT_CANOPY_SHELL_CONFIG.treeDistribution, 12345);
  const distOther = createTreeDistribution(DEFAULT_CANOPY_SHELL_CONFIG.treeDistribution, 99999);
  const terrain = createAnalyticTerrainSampler(0.5);

  it("is stable for the same seed", () => {
    expect(distA.sampleForestPotential(1200, 800)).toBe(distB.sampleForestPotential(1200, 800));
    expect(distA.sampleMoisture(1200, 800)).toBe(distB.sampleMoisture(1200, 800));
  });

  it("changes with different seed", () => {
    expect(distA.sampleForestPotential(1200, 800)).not.toBe(distOther.sampleForestPotential(1200, 800));
  });

  it("rejects steep slopes", () => {
    const steep = distA.sampleTreeCandidate(100, 100, {
      height: 40,
      normal: { x: 0.9, y: 0.1, z: 0.2 },
      slope: 0.95,
      materialHint: 0,
      water: false,
    });
    expect(steep).toBeNull();
  });

  it("rejects water cells", () => {
    const water = distA.sampleTreeCandidate(100, 100, {
      height: -2,
      normal: { x: 0, y: 1, z: 0 },
      slope: 0,
      materialHint: 0,
      water: true,
    });
    expect(water).toBeNull();
  });

  it("accumulates normalized species weights in summary cells", () => {
    const cell = distA.accumulateCanopyCell(512, 512, 8, terrain);
    if (cell.coverage > 0) {
      const sum = cell.speciesPine + cell.speciesBroadleaf + cell.speciesDeadwood;
      expect(sum).toBeCloseTo(1, 3);
    }
    expect(cell.coverage).toBeGreaterThanOrEqual(0);
    expect(cell.coverage).toBeLessThanOrEqual(1);
  });
});
