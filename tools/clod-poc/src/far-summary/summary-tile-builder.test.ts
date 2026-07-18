import { describe, expect, it } from "vitest";
import {
  buildFarSummaryTile,
  computeNormalFiniteDifference,
  createFarSummaryUnifiedEnrichment,
  stepFarSummaryUnifiedEnrichment,
  takeFarSummaryUnifiedWaterSnapshot,
} from "./summary-tile-builder.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";

const flatSampler: FarTerrainSampler = {
  sampleHeight: () => 50,
  sampleMaterial: () => 1,
  sampleCanopyCoverage: () => 0,
  sampleWaterCoverage: () => 0,
};

const roughSampler: FarTerrainSampler = {
  sampleHeight: (x: number, z: number) => 50 + Math.sin(x * 0.3) * 10 + Math.cos(z * 0.3) * 10,
  sampleMaterial: () => 0,
  sampleCanopyCoverage: () => 0.5,
  sampleWaterCoverage: () => 0,
};

describe("summary tile builder", () => {
  it("produces no NaN samples", () => {
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: DEFAULT_FAR_SUMMARY_CONFIG.rings[0],
      terrainSampler: flatSampler,
      frameIndex: 0,
      nowMs: 0,
    });

    expect(tile.samples.length).toBeGreaterThan(0);
    for (const s of tile.samples) {
      expect(Number.isNaN(s.heightMin)).toBe(false);
      expect(Number.isNaN(s.heightMax)).toBe(false);
      expect(Number.isNaN(s.heightAvg)).toBe(false);
      expect(Number.isNaN(s.normalX)).toBe(false);
      expect(Number.isNaN(s.normalY)).toBe(false);
      expect(Number.isNaN(s.normalZ)).toBe(false);
    }
  });

  it("backfills invalid center heights from valid samples instead of zero", () => {
    let calls = 0;
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 2 },
      terrainSampler: {
        sampleHeight: () => {
          calls++;
          return calls === 1 ? Number.NaN : 64;
        },
      },
      frameIndex: 0,
      nowMs: 0,
    });

    expect(tile.samples[0].heightAvg).toBe(64);
    expect(tile.samples[0].heightMin).toBe(64);
    expect(tile.samples[0].heightMax).toBe(64);
  });

  it("bakes the traced-carve imprint into CPU-built heights via the height grid", () => {
    const ringConfig = { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 4 };
    const cellM = ringConfig.cellM;
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: cellM },
      ringConfig,
      terrainSampler: {
        sampleHeight: () => 50,
        carveHeightImprint: (x, _z, height, cellSizeM) => {
          expect(cellSizeM).toBe(cellM);
          return x < cellM ? height - 4 : height;
        },
      },
      frameIndex: 0,
      nowMs: 0,
    });

    for (let sz = 0; sz < 4; sz++) {
      for (let sx = 0; sx < 4; sx++) {
        const sample = tile.samples[sz * 4 + sx]!;
        expect(sample.heightAvg).toBe((sx + 0.5) * cellM < cellM ? 46 : 50);
      }
    }
  });

  it("normals are unit vectors", () => {
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: DEFAULT_FAR_SUMMARY_CONFIG.rings[0],
      terrainSampler: roughSampler,
      frameIndex: 0,
      nowMs: 0,
    });

    for (const s of tile.samples) {
      const len = Math.hypot(s.normalX, s.normalY, s.normalZ);
      expect(Math.abs(len - 1)).toBeLessThan(0.01);
    }
  });

  it("heightMin <= heightAvg <= heightMax", () => {
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: DEFAULT_FAR_SUMMARY_CONFIG.rings[0],
      terrainSampler: roughSampler,
      frameIndex: 0,
      nowMs: 0,
    });

    for (const s of tile.samples) {
      expect(s.heightMin).toBeLessThanOrEqual(s.heightAvg + 0.01);
      expect(s.heightAvg).toBeLessThanOrEqual(s.heightMax + 0.01);
    }
  });

  it("flat terrain produces up normal", () => {
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: DEFAULT_FAR_SUMMARY_CONFIG.rings[0],
      terrainSampler: flatSampler,
      frameIndex: 0,
      nowMs: 0,
    });

    for (const s of tile.samples) {
      expect(Math.abs(s.normalY - 1)).toBeLessThan(0.01);
      expect(Math.abs(s.normalX)).toBeLessThan(0.01);
      expect(Math.abs(s.normalZ)).toBeLessThan(0.01);
    }
  });

  it("rough terrain has higher roughness than flat terrain", () => {
    const flatTile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: DEFAULT_FAR_SUMMARY_CONFIG.rings[0],
      terrainSampler: flatSampler,
      frameIndex: 0,
      nowMs: 0,
    });

    const roughTile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: DEFAULT_FAR_SUMMARY_CONFIG.rings[0],
      terrainSampler: roughSampler,
      frameIndex: 0,
      nowMs: 0,
    });

    const flatRoughness = flatTile.samples.reduce((s, sm) => s + sm.roughness, 0) / flatTile.samples.length;
    const roughRoughness = roughTile.samples.reduce((s, sm) => s + sm.roughness, 0) / roughTile.samples.length;
    expect(roughRoughness).toBeGreaterThan(flatRoughness);
  });

  it("reuses cached height samples for derived fields", () => {
    const tileCells = 2;
    let heightSamples = 0;
    buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells },
      terrainSampler: {
        sampleHeight: () => {
          heightSamples++;
          return 50;
        },
      },
      frameIndex: 0,
      nowMs: 0,
    });

    expect(heightSamples).toBe((tileCells + 2) * (tileCells + 2));
  });

  it("uses cached height for water coverage without fallback resampling", () => {
    const tileCells = 2;
    let fallbackWaterSamples = 0;
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells },
      terrainSampler: {
        sampleHeight: (_x, z) => z < 64 ? 10 : 80,
        sampleWaterCoverageForHeight: (_x, _z, height) => height < 50 ? 1 : 0,
        sampleWaterCoverage: () => {
          fallbackWaterSamples++;
          return 0;
        },
      },
      frameIndex: 0,
      nowMs: 0,
    });

    expect(fallbackWaterSamples).toBe(0);
    expect(tile.samples.some((sample) => sample.waterCoverage === 1)).toBe(true);
    expect(tile.samples.some((sample) => sample.waterCoverage === 0)).toBe(true);
  });

  it("fills layout-v2 hydrology and deterministic canopy channels", () => {
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 1 },
      terrainSampler: {
        sampleHeight: () => 40,
        sampleWaterSummary: (_x, _z, cellSizeM) => ({
          coverage: 0.8,
          waterLevel: 43,
          bodyKind: 2,
          shoreDistance: cellSizeM * 0.25,
          flowX: 0.5,
          flowZ: -0.25,
        }),
        sampleCanopySummary: (originX, originZ, cellSizeM) => ({
          coverage: 0.6,
          canopyHeightAvg: 55,
          speciesPine: originX === 0 ? 0.2 : 0,
          speciesBroadleaf: originZ === 0 ? 0.7 : 0,
          speciesDeadwood: cellSizeM === 32 ? 0.1 : 0,
        }),
      },
      frameIndex: 0,
      nowMs: 0,
    });

    expect(tile.samples[0]).toMatchObject({
      waterCoverage: 0.8,
      waterLevel: 43,
      bodyKind: 2,
      shoreDistance: 8,
      flowX: 0.5,
      flowZ: -0.25,
      canopyCoverage: 0.6,
      canopyHeightAvg: 55,
      speciesPine: 0.2,
      speciesBroadleaf: 0.7,
      speciesDeadwood: 0.1,
      structureCoverage: 0,
      caveEntranceCoverage: 0,
      occluderHeight: 0,
    });
  });

  it("coarsens GPU canopy enrichment without diluting the native summary cell size", () => {
    const ringConfig = { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 16 };
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig,
      terrainSampler: flatSampler,
      frameIndex: 0,
      nowMs: 0,
    });
    let canopyCalls = 0;
    const state = createFarSummaryUnifiedEnrichment(tile);

    expect(stepFarSummaryUnifiedEnrichment(state, {
      ...flatSampler,
      sampleCanopySummary: (_x, _z, cellSizeM) => {
        canopyCalls++;
        return {
          coverage: cellSizeM === 32 ? 0.5 : 0,
          canopyHeightAvg: 60,
          speciesPine: 0.5,
          speciesBroadleaf: 0.3,
          speciesDeadwood: 0.2,
        };
      },
    }, Number.POSITIVE_INFINITY)).toBe(true);

    expect(canopyCalls).toBe(16);
    expect(tile.samples.filter((sample) => sample.canopyCoverage === 0.5)).toHaveLength(16);
    expect(tile.samples.filter((sample) => sample.canopyHeightAvg === 60)).toHaveLength(16);
  });

  it("resumes coarse canopy enrichment one expensive sample at a time after its deadline", () => {
    const ringConfig = { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 16 };
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig,
      terrainSampler: flatSampler,
      frameIndex: 0,
      nowMs: 0,
    });
    let canopyCalls = 0;
    const state = createFarSummaryUnifiedEnrichment(tile);
    const sampler = {
      ...flatSampler,
      sampleCanopySummary: () => {
        canopyCalls++;
        return {
          coverage: 0.5,
          canopyHeightAvg: 60,
          speciesPine: 0.5,
          speciesBroadleaf: 0.3,
          speciesDeadwood: 0.2,
        };
      },
    };

    let complete = false;
    let calls = 0;
    while (!complete && calls++ < 300) {
      const before = canopyCalls;
      complete = stepFarSummaryUnifiedEnrichment(state, sampler, Number.NEGATIVE_INFINITY);
      expect(canopyCalls - before).toBeLessThanOrEqual(1);
    }

    expect(complete).toBe(true);
    expect(canopyCalls).toBe(16);
  });

  it("publishes a stable water snapshot while canopy enrichment continues", () => {
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 1 },
      terrainSampler: flatSampler,
      frameIndex: 0,
      nowMs: 0,
    });
    const state = createFarSummaryUnifiedEnrichment(tile);
    const sampler = {
      ...flatSampler,
      sampleWaterSummary: () => ({
        coverage: 1,
        waterLevel: 55,
        bodyKind: 1,
        shoreDistance: 0,
        flowX: 0,
        flowZ: 0,
      }),
      sampleCanopySummary: () => ({
        coverage: 0.5,
        canopyHeightAvg: 60,
        speciesPine: 1,
        speciesBroadleaf: 0,
        speciesDeadwood: 0,
      }),
    };

    expect(stepFarSummaryUnifiedEnrichment(state, sampler, Number.NEGATIVE_INFINITY)).toBe(false);
    const snapshot = takeFarSummaryUnifiedWaterSnapshot(state);
    expect(snapshot?.samples[0]).toMatchObject({ waterCoverage: 1, waterLevel: 55, canopyCoverage: 0 });
    const snapshotCanopyHeight = snapshot?.samples[0]?.canopyHeightAvg;
    expect(takeFarSummaryUnifiedWaterSnapshot(state)).toBeNull();

    expect(stepFarSummaryUnifiedEnrichment(state, sampler, Number.POSITIVE_INFINITY)).toBe(true);
    expect(snapshot?.samples[0]?.canopyHeightAvg).toBe(snapshotCanopyHeight);
    expect(tile.samples[0]?.canopyHeightAvg).toBe(60);
  });

  it("rejects coarse canopy coverage from authoritative water cells", () => {
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 1 },
      terrainSampler: flatSampler,
      frameIndex: 0,
      nowMs: 0,
    });
    const state = createFarSummaryUnifiedEnrichment(tile);

    stepFarSummaryUnifiedEnrichment(state, {
      ...flatSampler,
      sampleWaterSummary: () => ({
        coverage: 1,
        waterLevel: 55,
        bodyKind: 1,
        shoreDistance: 0,
        flowX: 0,
        flowZ: 0,
      }),
      sampleCanopySummary: () => ({
        coverage: 0.5,
        canopyHeightAvg: 60,
        speciesPine: 1,
        speciesBroadleaf: 0,
        speciesDeadwood: 0,
      }),
    }, Number.POSITIVE_INFINITY);

    expect(tile.samples[0]?.waterCoverage).toBe(1);
    expect(tile.samples[0]?.canopyCoverage).toBe(0);
  });

  it("rejects canopy beside a narrow water cell at a cell boundary", () => {
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 3 },
      terrainSampler: flatSampler,
      frameIndex: 0,
      nowMs: 0,
    });
    const state = createFarSummaryUnifiedEnrichment(tile);
    let waterCalls = 0;

    stepFarSummaryUnifiedEnrichment(state, {
      ...flatSampler,
      sampleWaterSummary: (x, z) => {
        waterCalls++;
        return {
          coverage: x === 48 && z === 48 ? 1 : 0,
          waterLevel: 55,
          bodyKind: 1,
          shoreDistance: 0,
          flowX: 0,
          flowZ: 0,
        };
      },
      sampleCanopySummary: () => ({
        coverage: 0.5,
        canopyHeightAvg: 60,
        speciesPine: 1,
        speciesBroadleaf: 0,
        speciesDeadwood: 0,
      }),
    }, Number.POSITIVE_INFINITY);

    expect(tile.samples[0]?.waterCoverage).toBe(0);
    expect(tile.samples[0]?.canopyCoverage).toBe(0);
    expect(waterCalls).toBe(tile.samples.length);
  });

  it("rejects coarse canopy coverage using the sea-level fallback when graph water is disabled", () => {
    const tile = buildFarSummaryTile({
      key: { ring: 0, x: 0, z: 0, cellSizeM: 32 },
      ringConfig: { ...DEFAULT_FAR_SUMMARY_CONFIG.rings[0], tileCells: 1 },
      terrainSampler: flatSampler,
      frameIndex: 0,
      nowMs: 0,
    });
    const state = createFarSummaryUnifiedEnrichment(tile);

    stepFarSummaryUnifiedEnrichment(state, {
      ...flatSampler,
      sampleWaterCoverageForHeight: () => 1,
      sampleCanopySummary: () => ({
        coverage: 0.5,
        canopyHeightAvg: 60,
        speciesPine: 1,
        speciesBroadleaf: 0,
        speciesDeadwood: 0,
      }),
    }, Number.POSITIVE_INFINITY);

    expect(tile.samples[0]?.waterCoverage).toBe(1);
    expect(tile.samples[0]?.canopyCoverage).toBe(0);
  });

  it("finite difference normal computation works", () => {
    const h = () => 50;
    const [nx, ny, nz] = computeNormalFiniteDifference(h, 0, 0, 1);
    expect(Math.abs(ny - 1)).toBeLessThan(0.01);
    expect(Math.abs(nx)).toBeLessThan(0.01);
    expect(Math.abs(nz)).toBeLessThan(0.01);
  });
});
