import { describe, expect, it } from "vitest";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import { computeRequiredFarSummaryTiles } from "./clipmap-rings.js";
import type { StreamCenter } from "./stream-center.js";

describe("clipmap rings", () => {
  const config = DEFAULT_FAR_SUMMARY_CONFIG;

  it("returns a deterministic set of required tiles", () => {
    const center: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };
    const req1 = computeRequiredFarSummaryTiles(center, config);
    const req2 = computeRequiredFarSummaryTiles(center, config);
    expect(req1.length).toBe(req2.length);
    for (let i = 0; i < req1.length; i++) {
      expect(req1[i].key.x).toBe(req2[i].key.x);
      expect(req1[i].key.z).toBe(req2[i].key.z);
      expect(req1[i].ring).toBe(req2[i].ring);
    }
  });

  it("shifts required tiles when stream center crosses a tile boundary", () => {
    const centerA: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };
    const centerB: StreamCenter = {
      worldX: 5000, worldZ: 5000,
      predictedX: 5000, predictedZ: 5000,
      velocityX: 0, velocityZ: 0,
    };
    const reqA = computeRequiredFarSummaryTiles(centerA, config);
    const reqB = computeRequiredFarSummaryTiles(centerB, config);

    expect(reqA.length).toBeGreaterThan(0);
    expect(reqB.length).toBeGreaterThan(0);

    const tilesA = new Set(reqA.map((r) => `${r.ring}_${r.key.x}_${r.key.z}`));
    const tilesB = new Set(reqB.map((r) => `${r.ring}_${r.key.x}_${r.key.z}`));
    const overlap = [...tilesA].filter((k) => tilesB.has(k));
    // Some tiles may overlap at edges, but most should differ
    expect(overlap.length).toBeLessThan(tilesA.size);
  });

  it("does not request infinite tiles — bounded count", () => {
    const center: StreamCenter = {
      worldX: 100000, worldZ: 100000,
      predictedX: 100000, predictedZ: 100000,
      velocityX: 0, velocityZ: 0,
    };
    const req = computeRequiredFarSummaryTiles(center, config);
    expect(req.length).toBeLessThan(10000);
    expect(req.length).toBeGreaterThan(0);
  });

  it("higher rings request fewer/larger tiles", () => {
    const center: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };
    const req = computeRequiredFarSummaryTiles(center, config);
    const ringCounts = new Map<number, number>();
    for (const r of req) {
      ringCounts.set(r.ring, (ringCounts.get(r.ring) ?? 0) + 1);
    }
    // Ring 0 (near_far) should have more tiles with smaller cell size
    // Ring 2 (horizon) should have fewer tiles with larger cell size
    const count0 = ringCounts.get(0) ?? 0;
    const count2 = ringCounts.get(2) ?? 0;
    expect(count0).toBeGreaterThan(count2);
  });
});
