import { describe, expect, it } from "vitest";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import {
  buildFarSummaryTile,
  createFarSummaryUnifiedEnrichment,
  farSummaryCanopyWaterBlocked,
  stepFarSummaryUnifiedEnrichment,
  type FarTerrainSampler,
} from "./summary-tile-builder.js";

describe("far-summary canopy water masking", () => {
  it("uses a conservative 3x3 enriched-water neighbourhood without hydrology resampling", () => {
    const ringConfig = { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 2 };
    const baseSampler: FarTerrainSampler = {
      sampleHeight: () => 40,
      sampleMaterial: () => 1,
    };
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: ringConfig.cellM },
      ringConfig,
      terrainSampler: baseSampler,
      frameIndex: 0,
      nowMs: 0,
    });
    tile.samples[3]!.waterCoverage = 1;

    expect(farSummaryCanopyWaterBlocked(tile, 0, 0)).toBe(true);

    let canopyCalls = 0;
    const state = createFarSummaryUnifiedEnrichment(tile);
    const sampler: FarTerrainSampler = {
      ...baseSampler,
      sampleCanopySummary: () => {
        canopyCalls++;
        return {
          coverage: 0.8,
          canopyHeightAvg: 60,
          speciesPine: 1,
          speciesBroadleaf: 0,
          speciesDeadwood: 0,
        };
      },
    };

    expect(stepFarSummaryUnifiedEnrichment(state, sampler, Number.POSITIVE_INFINITY)).toBe(true);
    // Water masks canopy *coverage* across the 3x3 enriched-water neighbourhood. The canopy sampler
    // still runs so the height channel stays populated — `summary-tile-builder.test.ts` pins that
    // contract ("publishes a stable water snapshot while canopy enrichment continues").
    expect(canopyCalls).toBeGreaterThan(0);
    expect(tile.samples.every((sample) => sample.canopyCoverage === 0)).toBe(true);
  });
});
