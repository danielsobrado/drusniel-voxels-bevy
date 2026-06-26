import { describe, expect, it } from "vitest";
import {
  applyRiverParityTestWaterConfig,
  isRiverParityTestScene,
  RIVER_PARITY_TEST_SCENE,
  DEFAULT_WATER_CONFIG,
  resolveWaterConfig,
} from "./index.js";

describe("river parity validation scene", () => {
  it("is identified by its explicit scene key", () => {
    expect(isRiverParityTestScene(RIVER_PARITY_TEST_SCENE)).toBe(true);
    expect(isRiverParityTestScene("long-view-forest-4km")).toBe(false);
    expect(isRiverParityTestScene(null)).toBe(false);
  });

  it("uses controlled fake-body rivers for material and geometry validation", () => {
    const cfg = applyRiverParityTestWaterConfig(DEFAULT_WATER_CONFIG);
    const resolved = resolveWaterConfig(cfg, 1024);

    expect(cfg.enabled).toBe(true);
    expect(cfg.source).toBe("fake_bodies");
    expect(cfg.fakeBodies.carveTerrain).toBe(true);
    expect(cfg.fakeBodies.lakes).toHaveLength(2);
    expect(cfg.fakeBodies.rivers).toHaveLength(3);
    expect(cfg.fakeBodies.rivers[0].pointsNorm).toHaveLength(8);
    expect(cfg.fakeBodies.rivers[1].downstreamDrop).toBeGreaterThan(cfg.fakeBodies.rivers[2].downstreamDrop);
    expect(resolved.fakeBodies.rivers[0].points[0][0]).toBeCloseTo(81.92, 2);
    expect(resolved.visual.foam.riverStrength).toBeGreaterThanOrEqual(0.88);
    expect(resolved.visual.foam.dropEnd).toBeLessThanOrEqual(1.2);
  });
});
