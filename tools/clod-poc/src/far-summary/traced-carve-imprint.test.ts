import { describe, expect, it } from "vitest";
import { imprintTracedCarveOnFarSummaryTile } from "./traced-carve-imprint.js";
import type { FarSummarySample, FarSummaryTile } from "./types.js";

function makeSample(height: number): FarSummarySample {
  return {
    heightMin: height - 2,
    heightMax: height + 2,
    heightAvg: height,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    dominantMaterial: 0,
    materialVariance: 0,
    canopyCoverage: 0,
    waterCoverage: 0,
    waterLevel: 0,
    bodyKind: 0,
    shoreDistance: 0,
    flowX: 0,
    flowZ: 0,
    canopyHeightAvg: height,
    speciesPine: 0,
    speciesBroadleaf: 0,
    speciesDeadwood: 0,
    structureCoverage: 0,
    caveEntranceCoverage: 0,
    occluderHeight: height + 1,
    slope: 0,
    roughness: 0,
  };
}

function makeTile(tileCells: number, cellSizeM: number, height: number): FarSummaryTile {
  return {
    key: { ring: 0, x: 0, z: 0, cellSizeM },
    state: "ready",
    revision: 0,
    lastTouchedFrame: 0,
    lastTouchedTimeMs: 0,
    cellSizeM,
    tileCells,
    originX: 0,
    originZ: 0,
    samples: Array.from({ length: tileCells * tileCells }, () => makeSample(height)),
  };
}

describe("imprintTracedCarveOnFarSummaryTile", () => {
  it("lowers height min/avg/max and occluder only where the carve bites", () => {
    const tile = makeTile(4, 32, 20);
    imprintTracedCarveOnFarSummaryTile(tile, {
      sampleHeight: () => 20,
      carveHeightImprint: (x, _z, height) => (x < 64 ? height - 3 : height),
    });

    for (let sz = 0; sz < 4; sz++) {
      for (let sx = 0; sx < 4; sx++) {
        const sample = tile.samples[sz * 4 + sx]!;
        const carved = (sx + 0.5) * 32 < 64;
        expect(sample.heightAvg).toBe(carved ? 17 : 20);
        expect(sample.heightMin).toBe(carved ? 15 : 18);
        expect(sample.heightMax).toBe(carved ? 19 : 22);
        expect(sample.occluderHeight).toBe(carved ? 18 : 21);
      }
    }
  });

  it("passes the tile cell size to the carve so the width floor tracks the ring", () => {
    const tile = makeTile(2, 48, 10);
    const seenCellSizes: number[] = [];
    imprintTracedCarveOnFarSummaryTile(tile, {
      sampleHeight: () => 10,
      carveHeightImprint: (_x, _z, height, cellSizeM) => {
        seenCellSizes.push(cellSizeM);
        return height;
      },
    });
    expect(seenCellSizes).toEqual([48, 48, 48, 48]);
  });

  it("is a no-op without a carve imprint on the sampler", () => {
    const tile = makeTile(2, 32, 20);
    imprintTracedCarveOnFarSummaryTile(tile, { sampleHeight: () => 20 });
    for (const sample of tile.samples) expect(sample.heightAvg).toBe(20);
  });

  it("skips cells whose height is not finite", () => {
    const tile = makeTile(2, 32, 20);
    tile.samples[0]!.heightAvg = Number.NaN;
    imprintTracedCarveOnFarSummaryTile(tile, {
      sampleHeight: () => 20,
      carveHeightImprint: (_x, _z, height) => height - 5,
    });
    expect(Number.isNaN(tile.samples[0]!.heightAvg)).toBe(true);
    expect(tile.samples[1]!.heightAvg).toBe(15);
  });
});
