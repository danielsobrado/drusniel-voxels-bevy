import { describe, expect, it } from "vitest";
import {
  WaterField,
  buildRiverTerrainWetnessMask,
  cloneWaterConfig,
  collectRiverTerrainWetnessMaskStats,
} from "./index.js";

describe("river terrain wetness mask stats", () => {
  it("reports disabled stats for a missing texture", () => {
    const stats = collectRiverTerrainWetnessMaskStats(null);

    expect(stats.enabled).toBe(false);
    expect(stats.wetPixels).toBe(0);
    expect(stats.foamPixels).toBe(0);
  });

  it("summarizes wet, foam, and droplet channels", () => {
    const config = cloneWaterConfig();
    config.source = "fake_bodies";
    config.fakeBodies.lakes = [];
    config.fakeBodies.rivers = [{
      points: [[16, 32], [96, 32]],
      width: 14,
      levelOffset: 4,
      downstreamDrop: 8,
    }];
    const field = new WaterField(config, { surfaceHeight: () => 10 });
    const texture = buildRiverTerrainWetnessMask({
      field,
      worldCells: 128,
      resolution: 64,
    });

    const stats = collectRiverTerrainWetnessMaskStats(texture);

    expect(stats.enabled).toBe(true);
    expect(stats.width).toBe(64);
    expect(stats.height).toBe(64);
    expect(stats.wetPixels).toBeGreaterThan(0);
    expect(stats.maxWet).toBeGreaterThan(0);
    expect(stats.maxWet).toBeLessThanOrEqual(255);
    expect(stats.maxFoam).toBeLessThanOrEqual(255);
    expect(stats.maxDroplets).toBeLessThanOrEqual(255);

    texture.dispose();
  });
});
