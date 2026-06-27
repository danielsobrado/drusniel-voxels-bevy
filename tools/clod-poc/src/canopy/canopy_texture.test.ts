import { describe, expect, it } from "vitest";
import { buildCanopyTextureSet } from "./canopy_texture.js";
import { parseCanopyShellConfig } from "./canopy_config.js";
import canopyYaml from "../../config/canopy_shell.yaml?raw";
import { buildCanopySummaryTile, tileResolutionForCellSize } from "./canopy_summary_builder.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";
import { createBlendedTerrainSampler } from "./canopy_terrain_sampler.js";
import { createTreeDistribution } from "./deterministic_tree_distribution.js";
import type { CanopySummaryTile } from "./canopy_types.js";

describe("canopy texture", () => {
  const config = parseCanopyShellConfig(canopyYaml);
  const summary = buildTerrainSummary([], 512, 8);
  const terrain = createBlendedTerrainSampler(summary, 2048);
  const trees = createTreeDistribution(config.treeDistribution, config.seed);
  const tile = buildCanopySummaryTile({
    key: { tileX: 0, tileZ: 0, ring: 0 },
    originX: -256,
    originZ: -256,
    cellSizeM: 8,
    resolution: tileResolutionForCellSize(config.clipmap.tileSizeM, 8),
    config,
    terrainSampler: terrain,
    treeDistribution: trees,
  });

  it("clamps coverage values and avoids NaNs", () => {
    const set = buildCanopyTextureSet({
      visibleTiles: [tile],
      config,
      centerX: 0,
      centerZ: 0,
      syntheticFallback: false,
    });
    const cov = set.coverageTexture.image.data as Float32Array;
    for (let i = 0; i < cov.length; i++) {
      expect(Number.isFinite(cov[i])).toBe(true);
      expect(cov[i]).toBeGreaterThanOrEqual(0);
      expect(cov[i]).toBeLessThanOrEqual(1);
    }
    expect(set.syntheticFallback).toBe(false);
  });

  it("sanitizes invalid summary cell values before texture upload", { timeout: 60000 }, () => {
    const badTile: CanopySummaryTile = {
      ...tile,
      originX: 0,
      originZ: 0,
      resolution: 1,
      cellSizeM: config.clipmap.tileSizeM,
      cells: [{
        groundHeight: Number.NaN,
        canopyHeight: Number.NaN,
        coverage: -0.25,
        crownRoughness: Number.POSITIVE_INFINITY,
        slope: 0,
        moisture: 0,
        speciesPine: Number.NaN,
        speciesBroadleaf: -2,
        speciesDeadwood: 0,
      }],
    };

    const set = buildCanopyTextureSet({
      visibleTiles: [badTile],
      config,
      centerX: config.distances.shellEndM,
      centerZ: config.distances.shellEndM,
      syntheticFallback: false,
    });

    const height = set.heightTexture.image.data as Float32Array;
    const coverage = set.coverageTexture.image.data as Float32Array;
    const species = set.speciesTexture.image.data as Float32Array;
    const roughness = set.roughnessTexture.image.data as Float32Array;

    for (const value of height) expect(Number.isFinite(value)).toBe(true);
    for (const value of coverage) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    for (const value of species) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    for (const value of roughness) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("uses synthetic fallback only when requested", () => {
    const set = buildCanopyTextureSet({
      visibleTiles: [],
      config,
      centerX: 0,
      centerZ: 0,
      syntheticFallback: true,
      terrainSummary: summary,
      farRadius: 1024,
    });
    expect(set.syntheticFallback).toBe(true);
  });
});
