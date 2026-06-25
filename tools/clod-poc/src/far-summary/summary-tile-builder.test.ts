import { describe, expect, it } from "vitest";
import { buildFarSummaryTile, computeNormalFiniteDifference } from "./summary-tile-builder.js";
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

  it("finite difference normal computation works", () => {
    const h = () => 50;
    const [nx, ny, nz] = computeNormalFiniteDifference(h, 0, 0, 1);
    expect(Math.abs(ny - 1)).toBeLessThan(0.01);
    expect(Math.abs(nx)).toBeLessThan(0.01);
    expect(Math.abs(nz)).toBeLessThan(0.01);
  });
});
