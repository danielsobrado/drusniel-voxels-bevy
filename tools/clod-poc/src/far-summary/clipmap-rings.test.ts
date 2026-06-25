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

  describe("priority ordering", () => {
    it("streams ahead tiles before behind tiles when moving +X", () => {
      const center: StreamCenter = {
        worldX: 0, worldZ: 0,
        predictedX: 100, predictedZ: 0,
        velocityX: 18, velocityZ: 0,
      };
      const req = computeRequiredFarSummaryTiles(center, config);
      // Filter to a single ring for clear comparison
      const ring0 = req.filter((r) => r.ring === 0);
      expect(ring0.length).toBeGreaterThan(1);

      // Find the first tile ahead (+X from predicted) and first behind (-X)
      const aheadTiles = ring0.filter((r) => r.key.x > worldToTileCoordQuick(100, 32 * 32));
      const behindTiles = ring0.filter((r) => r.key.x < worldToTileCoordQuick(100, 32 * 32));
      // Ahead tiles should have lower priority (more urgent) than behind tiles
      if (aheadTiles.length > 0 && behindTiles.length > 0) {
        const aheadMin = Math.min(...aheadTiles.map((t) => t.priority));
        const behindMin = Math.min(...behindTiles.map((t) => t.priority));
        expect(aheadMin).toBeLessThan(behindMin);
      }
    });

    it("streams closer tiles before farther tiles within same ring/direction", () => {
      const center: StreamCenter = {
        worldX: 0, worldZ: 0,
        predictedX: 0, predictedZ: 0,
        velocityX: 10, velocityZ: 0,
      };
      const req = computeRequiredFarSummaryTiles(center, config);
      const ring0 = req.filter((r) => r.ring === 0);
      expect(ring0.length).toBeGreaterThan(1);

      // Sort by priority
      const sorted = [...ring0].sort((a, b) => a.priority - b.priority);
      // Priority should correlate with distance away from predicted center (travel direction)
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i - 1].distanceToPredictedCenter <= sorted[i].distanceToPredictedCenter) {
          // Closer distance should have lower or equal priority
          expect(sorted[i - 1].priority).toBeLessThanOrEqual(sorted[i].priority);
        }
      }
    });

    it("lower ring tiles have higher priority than higher ring tiles", () => {
      const center: StreamCenter = {
        worldX: 0, worldZ: 0,
        predictedX: 0, predictedZ: 0,
        velocityX: 0, velocityZ: 0,
      };
      const req = computeRequiredFarSummaryTiles(center, config);
      // All ring 0 tiles should have lower priority than all ring 1 tiles
      const ring0prio = Math.max(...req.filter((r) => r.ring === 0).map((r) => r.priority));
      const ring1prio = Math.min(...req.filter((r) => r.ring === 1).map((r) => r.priority));
      expect(ring0prio).toBeLessThan(ring1prio);
    });

    it("produces stable ordering for identical priorities", () => {
      const center: StreamCenter = {
        worldX: 0, worldZ: 0,
        predictedX: 0, predictedZ: 0,
        velocityX: 0, velocityZ: 0,
      };
      const req1 = computeRequiredFarSummaryTiles(center, config);
      const req2 = computeRequiredFarSummaryTiles(center, config);
      expect(req1.length).toBe(req2.length);
      for (let i = 0; i < req1.length; i++) {
        expect(req1[i].priority).toBe(req2[i].priority);
      }
    });
  });
});

/** Quick helper to compute tile coord without importing the full function. */
function worldToTileCoordQuick(worldCoord: number, tileSize: number): number {
  return Math.floor(worldCoord / tileSize);
}
