import { describe, expect, it } from "vitest";
import { createCanopyClipmap } from "./canopy_clipmap.js";
import { parseCanopyShellConfig } from "./canopy_config.js";
import canopyYaml from "../../config/canopy_shell.yaml?raw";
import { createBlendedTerrainSampler } from "./canopy_terrain_sampler.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";
import { createTreeDistribution } from "./deterministic_tree_distribution.js";

describe("canopy clipmap", () => {
  const config = parseCanopyShellConfig(canopyYaml);
  const summary = buildTerrainSummary([], 512, 8);
  const terrain = createBlendedTerrainSampler(summary, 2048);
  const trees = createTreeDistribution(config.treeDistribution, config.seed);

  it("builds within per-frame budget", () => {
    const clipmap = createCanopyClipmap();
    const update = clipmap.update(0, 0, config, terrain, trees);
    expect(update.metrics.builtThisFrame).toBeLessThanOrEqual(config.budgets.maxTilesBuiltPerFrame);
    expect(update.metrics.visibleTiles).toBeGreaterThan(0);
  });

  it("evicts tiles when camera moves far away", () => {
    const clipmap = createCanopyClipmap();
    clipmap.update(0, 0, config, terrain, trees);
    const warm = clipmap.getVisibleTiles().length;
    clipmap.update(50000, 50000, config, terrain, trees);
    expect(clipmap.getVisibleTiles().length).toBeLessThanOrEqual(warm);
  });
});
