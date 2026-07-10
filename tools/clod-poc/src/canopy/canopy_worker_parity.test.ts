import { describe, expect, it } from "vitest";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { surfaceHeightCore } from "../gpu/terrain_field_core.js";
import { parseCanopyShellConfig } from "./canopy_config.js";
import { buildCanopySummaryTile } from "./canopy_summary_builder.js";
import { createSummaryTerrainSampler } from "./canopy_terrain_sampler.js";
import { createTreeDistribution } from "./deterministic_tree_distribution.js";
import { packCanopyCells, unpackCanopyCells, packCanopyTile, unpackCanopyTile, CANOPY_CELL_FLOATS } from "./canopy_worker_protocol.js";

function testSummaryField(): TerrainSummaryField {
  const res = 8;
  const worldSize = 512;
  const heightMin = new Float32Array(res * res);
  const heightMax = new Float32Array(res * res);
  for (let i = 0; i < res * res; i++) {
    heightMin[i] = 4 + (i % res);
    heightMax[i] = 10 + (i % res) * 1.5;
  }
  return {
    res,
    worldSize,
    farReduceFactor: 4,
    heightMin,
    heightMax,
    normalX: new Float32Array(res * res),
    normalY: new Float32Array(res * res).fill(1),
    normalZ: new Float32Array(res * res),
    coverage: new Float32Array(res * res),
    analyticHeightSampler: (x, z) => surfaceHeightCore(x, z),
  };
}

/** Rebuild the summary field the way canopy_build_worker does: height arrays + stubs. */
function workerReconstructedField(source: TerrainSummaryField): TerrainSummaryField {
  const empty = new Float32Array(0);
  return {
    res: source.res,
    worldSize: source.worldSize,
    farReduceFactor: source.farReduceFactor,
    heightMin: source.heightMin.slice(),
    heightMax: source.heightMax.slice(),
    normalX: empty,
    normalY: empty,
    normalZ: empty,
    coverage: empty,
    analyticHeightSampler: (x, z) => surfaceHeightCore(x, z),
  };
}

describe("canopy worker protocol", () => {
  it("round-trips cells through the packed transfer format", () => {
    const cells = [
      { groundHeight: 12.5, canopyHeight: 19.25, coverage: 0.5, crownRoughness: 0.25, slope: 0.125, moisture: 0.75, speciesPine: 0.5, speciesBroadleaf: 0.375, speciesDeadwood: 0.125 },
      { groundHeight: -3, canopyHeight: 0, coverage: 0, crownRoughness: 0, slope: 1, moisture: 0, speciesPine: 0, speciesBroadleaf: 0, speciesDeadwood: 0 },
    ];
    const packed = packCanopyCells(cells);
    expect(packed.length).toBe(cells.length * CANOPY_CELL_FLOATS);
    expect(unpackCanopyCells(packed, cells.length)).toEqual(cells);
  });

  it("round-trips whole tiles", () => {
    const config = parseCanopyShellConfig("");
    const distribution = createTreeDistribution(config.treeDistribution, config.seed);
    const sampler = createSummaryTerrainSampler(testSummaryField(), 600);
    const tile = buildCanopySummaryTile({
      key: { tileX: 1, tileZ: -2, ring: 0 },
      originX: 64,
      originZ: -128,
      cellSizeM: 8,
      resolution: 8,
      config,
      terrainSampler: sampler,
      treeDistribution: distribution,
      revision: 7,
    });
    const roundTripped = unpackCanopyTile(packCanopyTile(tile));
    expect(roundTripped.key).toEqual(tile.key);
    expect(roundTripped.revision).toBe(7);
    // The f64 transfer format keeps worker-built cells bit-identical.
    expect(roundTripped.cells).toEqual(tile.cells);
  });

  it("builds identical tiles from the worker-reconstructed summary field", () => {
    const config = parseCanopyShellConfig("");
    const source = testSummaryField();
    const mainSampler = createSummaryTerrainSampler(source, 600);
    const workerSampler = createSummaryTerrainSampler(workerReconstructedField(source), 600);
    const params = {
      key: { tileX: 0, tileZ: 0, ring: 0 },
      originX: 128,
      originZ: 128,
      cellSizeM: 8,
      resolution: 16,
      config,
    } as const;

    const mainTile = buildCanopySummaryTile({
      ...params,
      terrainSampler: mainSampler,
      treeDistribution: createTreeDistribution(config.treeDistribution, config.seed),
      revision: 1,
    });
    const workerTile = buildCanopySummaryTile({
      ...params,
      terrainSampler: workerSampler,
      treeDistribution: createTreeDistribution(config.treeDistribution, config.seed),
      revision: 1,
    });

    expect(workerTile.cells).toEqual(mainTile.cells);
  });
});
