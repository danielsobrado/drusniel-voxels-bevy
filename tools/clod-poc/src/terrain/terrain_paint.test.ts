import { describe, expect, it } from "vitest";
import { terrainWeights } from "./terrain_paint.js";

describe("terrainWeights", () => {
  it("keeps high-altitude material weights normalized and within range", () => {
    for (const height of [110, 110.025, 128, 256]) {
      const weights = terrainWeights(height, 1);
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
      for (const weight of weights) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });
});
