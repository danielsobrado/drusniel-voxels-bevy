import { describe, expect, it } from "vitest";
import { createCanopyClipmap, ringForDistance } from "./canopy_clipmap.js";
import { parseCanopyShellConfig } from "./canopy_config.js";
import canopyYaml from "../../config/canopy_shell.yaml?raw";
import { createBlendedTerrainSampler } from "./canopy_terrain_sampler.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";
import { createTreeDistribution } from "./deterministic_tree_distribution.js";
import { buildCanopyTextureSet } from "./canopy_texture.js";
import { stableTileKey } from "./canopy_types.js";

describe("canopy clipmap", () => {
  const config = parseCanopyShellConfig(canopyYaml);
  const summary = buildTerrainSummary([], 512, 8);
  const terrain = createBlendedTerrainSampler(summary, config.distances.shellEndM);
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

  it("ringForDistance returns null below first ring", () => {
    expect(ringForDistance(100, config)).toBeNull();
    expect(ringForDistance(511, config)).toBeNull();
    expect(ringForDistance(512, config)).toBe(0);
    expect(ringForDistance(1500, config)).toBe(0);
    expect(ringForDistance(3000, config)).toBe(1);
  });

  it("keeps old tile visible when ring changes before replacement is built", () => {
    const clipmap = createCanopyClipmap();
    clipmap.update(1024, 1024, config, terrain, trees);
    for (let i = 0; i < 12; i++) {
      clipmap.update(1024, 1024, config, terrain, trees);
    }
    const before = clipmap.getVisibleTiles();
    expect(before.length).toBeGreaterThan(0);
    const sample = before[0];
    const key = stableTileKey(sample.key.tileX, sample.key.tileZ);

    const noBuildConfig = {
      ...config,
      budgets: { ...config.budgets, maxTilesBuiltPerFrame: 0 },
    };
    clipmap.update(0, 0, noBuildConfig, terrain, trees);
    const after = clipmap.getVisibleTiles();
    expect(after.some((t) => stableTileKey(t.key.tileX, t.key.tileZ) === key)).toBe(true);
    expect(after.find((t) => stableTileKey(t.key.tileX, t.key.tileZ) === key)?.revision).toBe(
      sample.revision,
    );
  });

  it("skips tile builds when clipmap is disabled", () => {
    const clipmap = createCanopyClipmap();
    clipmap.update(0, 0, config, terrain, trees);
    expect(clipmap.getVisibleTiles().length).toBeGreaterThan(0);

    const disabled = {
      ...config,
      clipmap: { ...config.clipmap, enabled: false },
    };
    const update = clipmap.update(0, 0, disabled, terrain, trees);
    expect(clipmap.getVisibleTiles()).toHaveLength(0);
    expect(update.metrics.builtThisFrame).toBe(0);
    expect(update.metrics.visibleTiles).toBe(0);
    expect(update.metrics.averageCoverage).toBe(0);
    expect(update.texturesDirty).toBe(true);

    const second = clipmap.update(0, 0, disabled, terrain, trees);
    expect(second.metrics.evictedTiles).toBe(0);
    expect(second.texturesDirty).toBe(false);
  });

  it("uses first camera position as freeze center when frozen before first update", () => {
    const clipmap = createCanopyClipmap();
    clipmap.setFreezeCenter(true);

    const first = clipmap.update(2048, 1024, config, terrain, trees);
    expect(first.centerX).toBe(2048);
    expect(first.centerZ).toBe(1024);

    const second = clipmap.update(4096, 4096, config, terrain, trees);
    expect(second.centerX).toBe(2048);
    expect(second.centerZ).toBe(1024);
  });

  it("texture revision changes after clipmap warms at a new camera position", () => {
    const clipmap = createCanopyClipmap();
    clipmap.update(0, 0, config, terrain, trees);
    for (let i = 0; i < 8; i++) {
      clipmap.update(0, 0, config, terrain, trees);
    }
    const setA = buildCanopyTextureSet({
      visibleTiles: clipmap.getVisibleTiles(),
      config,
      centerX: 0,
      centerZ: 0,
      syntheticFallback: false,
    });
    clipmap.update(2048, 2048, config, terrain, trees);
    for (let i = 0; i < 8; i++) {
      clipmap.update(2048, 2048, config, terrain, trees);
    }
    const setB = buildCanopyTextureSet({
      visibleTiles: clipmap.getVisibleTiles(),
      config,
      centerX: 2048,
      centerZ: 2048,
      syntheticFallback: false,
    });
    expect(setB.revision).toBeGreaterThan(setA.revision);
    expect(setB.heightTexture).not.toBe(setA.heightTexture);
  });

  it("does not mark textures dirty when queue remains but no tile was built", () => {
    const clipmap = createCanopyClipmap();
    const noBuildConfig = {
      ...config,
      budgets: { ...config.budgets, maxTilesBuiltPerFrame: 0 },
    };

    clipmap.update(0, 0, config, terrain, trees);
    while (clipmap.getVisibleTiles().length === 0) {
      clipmap.update(0, 0, config, terrain, trees);
    }

    const update = clipmap.update(1024, 0, noBuildConfig, terrain, trees);

    expect(update.metrics.builtThisFrame).toBe(0);
    expect(update.metrics.queuedTiles).toBeGreaterThan(0);
    expect(update.texturesDirty).toBe(false);
  });
});
