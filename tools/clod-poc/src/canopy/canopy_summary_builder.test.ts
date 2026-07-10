import { describe, expect, it } from "vitest";
import { buildTerrainSummary } from "../clod/terrain_summary.js";
import { parseCanopyShellConfig } from "./canopy_config.js";
import canopyYaml from "../../config/canopy_shell.yaml?raw";
import { buildCanopySummaryTile, createCanopySummaryTileJob, tileResolutionForCellSize } from "./canopy_summary_builder.js";
import { createBlendedTerrainSampler } from "./canopy_terrain_sampler.js";
import { createTreeDistribution } from "./deterministic_tree_distribution.js";

describe("canopy summary builder", () => {
  const config = parseCanopyShellConfig(canopyYaml);
  const summary = buildTerrainSummary([], 512, 8);
  const terrain = createBlendedTerrainSampler(summary, 1024);
  const trees = createTreeDistribution(config.treeDistribution, config.seed);
  const cellSizeM = 8;
  const resolution = tileResolutionForCellSize(config.clipmap.tileSizeM, cellSizeM);

  it("builds tiles without NaNs and clamps coverage", () => {
    const tile = buildCanopySummaryTile({
      key: { tileX: 0, tileZ: 0, ring: 0 },
      originX: 0,
      originZ: 0,
      cellSizeM,
      resolution,
      config,
      terrainSampler: terrain,
      treeDistribution: trees,
    });
    for (const cell of tile.cells) {
      expect(Number.isFinite(cell.groundHeight)).toBe(true);
      expect(Number.isFinite(cell.canopyHeight)).toBe(true);
      expect(cell.coverage).toBeGreaterThanOrEqual(0);
      expect(cell.coverage).toBeLessThanOrEqual(1);
    }
  });

  it("has compatible border cells between neighbor tiles", () => {
    const tileA = buildCanopySummaryTile({
      key: { tileX: 0, tileZ: 0, ring: 0 },
      originX: 0,
      originZ: 0,
      cellSizeM,
      resolution,
      config,
      terrainSampler: terrain,
      treeDistribution: trees,
    });
    const tileB = buildCanopySummaryTile({
      key: { tileX: 1, tileZ: 0, ring: 0 },
      originX: config.clipmap.tileSizeM,
      originZ: 0,
      cellSizeM,
      resolution,
      config,
      terrainSampler: terrain,
      treeDistribution: trees,
    });
    const edgeA = tileA.cells[tileA.resolution - 1];
    const edgeB = tileB.cells[0];
    expect(Math.abs(edgeA.coverage - edgeB.coverage)).toBeLessThan(0.35);
  });

  it("resumes a tile build across bounded steps without changing the result", () => {
    let clock = 0;
    const params = {
      key: { tileX: 0, tileZ: 0, ring: 0 },
      originX: 0,
      originZ: 0,
      cellSizeM,
      resolution: 16,
      config,
      terrainSampler: terrain,
      treeDistribution: trees,
      revision: 9,
    };
    const job = createCanopySummaryTileJob(params, () => clock++);

    expect(job.step(1)).toBeNull();
    let actual = job.step(1);
    while (!actual) actual = job.step(1);

    const expected = buildCanopySummaryTile(params);
    expect(actual.revision).toBe(9);
    expect(actual.cells).toEqual(expected.cells);
  });
});
