import { describe, expect, it } from "vitest";
import type { FarSummaryRingRequest } from "./clipmap-rings.js";
import type { FarSummaryCache } from "./summary-cache.js";
import { createFarSummaryUnifiedEnrichment } from "./summary-tile-builder.js";
import type { FarSummaryTile } from "./types.js";
import { countFarSummaryUnifiedReadiness } from "./unified-readiness.js";

describe("far-summary unified readiness", () => {
  it("separates terrain/water coverage from pending canopy refinement", () => {
    const request: FarSummaryRingRequest = {
      ring: 0,
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      priority: 0,
      distanceToCamera: 0,
      distanceToPredictedCenter: 0,
    };
    const tile: FarSummaryTile = {
      key: request.key,
      state: "ready",
      revision: 1,
      lastTouchedFrame: 1,
      lastTouchedTimeMs: 1,
      cellSizeM: 32,
      tileCells: 1,
      originX: 0,
      originZ: 0,
      samples: [{
        heightMin: 40,
        heightMax: 40,
        heightAvg: 40,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        dominantMaterial: 1,
        materialVariance: 0,
        canopyCoverage: 0,
        waterCoverage: 1,
        waterLevel: 42,
        bodyKind: 1,
        shoreDistance: 0,
        flowX: 0,
        flowZ: 0,
        canopyHeightAvg: 40,
        speciesPine: 0,
        speciesBroadleaf: 0,
        speciesDeadwood: 0,
        structureCoverage: 0,
        caveEntranceCoverage: 0,
        occluderHeight: 0,
        slope: 0,
        roughness: 0,
      }],
    };
    const enrichment = createFarSummaryUnifiedEnrichment(tile);
    enrichment.nextSample = tile.samples.length;
    const pending = new Map([["0:0:0:32", enrichment]]);
    const cache = {
      getTile: () => tile,
    } as unknown as FarSummaryCache;

    expect(countFarSummaryUnifiedReadiness(cache, [request], pending, new Set())).toEqual({
      terrainWaterReady: 1,
      waterPending: 0,
      canopyPending: 1,
      fullyEnriched: 0,
    });

    pending.clear();
    expect(countFarSummaryUnifiedReadiness(cache, [request], pending, new Set())).toEqual({
      terrainWaterReady: 1,
      waterPending: 0,
      canopyPending: 0,
      fullyEnriched: 1,
    });
  });
});
