import { describe, expect, it } from "vitest";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import type { FarSummaryRingRequest } from "./clipmap-rings.js";
import type { FarSummaryCache } from "./summary-cache.js";
import {
  createFarSummaryBaseSampler,
  FarSummaryCpuBaseBuilder,
  requestKey,
} from "./cpu-unified-builder.js";
import {
  createFarSummaryUnifiedEnrichment,
  stepFarSummaryUnifiedEnrichment,
  stepFarSummaryUnifiedWaterEnrichment,
  takeFarSummaryUnifiedWaterSnapshot,
  type FarTerrainSampler,
} from "./summary-tile-builder.js";
import type { FarSummaryTile } from "./types.js";

describe("CPU unified far-summary builder", () => {
  it("builds terrain-only base tiles and defers water/canopy through the shared lifecycle", () => {
    const ring = { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 2 };
    const config = {
      ...DEFAULT_FAR_SUMMARY_CONFIG,
      rings: [ring],
    };
    const request: FarSummaryRingRequest = {
      ring: 0,
      key: { ring: 0, x: 0, z: 0, cellSizeM: ring.cellM },
      priority: 0,
      distanceToCamera: 0,
      distanceToPredictedCenter: 0,
    };
    const requested: FarSummaryTile = {
      key: request.key,
      state: "requested",
      revision: 0,
      lastTouchedFrame: 0,
      lastTouchedTimeMs: 0,
      cellSizeM: ring.cellM,
      tileCells: ring.tileCells,
      originX: 0,
      originZ: 0,
      samples: [],
    };
    const cache = {
      getTile: () => requested,
    } as unknown as FarSummaryCache;

    let waterCalls = 0;
    let canopyCalls = 0;
    const source: FarTerrainSampler = {
      sampleHeight: () => 40,
      sampleMaterial: () => 2,
      sampleWaterSummary: () => {
        waterCalls++;
        return {
          coverage: 0,
          waterLevel: 40,
          bodyKind: 0,
          shoreDistance: 8,
          flowX: 0,
          flowZ: 0,
        };
      },
      sampleCanopySummary: () => {
        canopyCalls++;
        return {
          coverage: 0.5,
          canopyHeightAvg: 55,
          speciesPine: 1,
          speciesBroadleaf: 0,
          speciesDeadwood: 0,
        };
      },
    };

    const pending = new Map<string, ReturnType<typeof createFarSummaryUnifiedEnrichment>>();
    const builder = new FarSummaryCpuBaseBuilder({
      config,
      cache,
      terrainSampler: createFarSummaryBaseSampler(source),
      isEnrichmentPending: (key) => pending.has(key),
      onBuilt: (key, tile) => pending.set(key, createFarSummaryUnifiedEnrichment(tile)),
    });

    builder.buildSome([request], 1, 0, 1, Number.POSITIVE_INFINITY);

    expect(waterCalls).toBe(0);
    expect(canopyCalls).toBe(0);
    expect(builder.buildingCount()).toBe(0);
    expect(builder.completedBaseTilesTotal()).toBe(1);

    const state = pending.get(requestKey(request));
    expect(state).toBeDefined();
    expect(state?.tile.samples).toHaveLength(4);
    expect(state?.tile.samples.every((sample) => sample.waterCoverage === 0)).toBe(true);
    expect(state?.tile.samples.every((sample) => sample.canopyCoverage === 0)).toBe(true);

    expect(stepFarSummaryUnifiedWaterEnrichment(state!, source, Number.POSITIVE_INFINITY)).toBe(true);
    const waterSnapshot = takeFarSummaryUnifiedWaterSnapshot(state!);
    expect(waterSnapshot).not.toBeNull();
    expect(waterCalls).toBe(4);
    expect(canopyCalls).toBe(0);

    expect(stepFarSummaryUnifiedEnrichment(state!, source, Number.POSITIVE_INFINITY)).toBe(true);
    expect(canopyCalls).toBe(4);
  });
});
