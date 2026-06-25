import { describe, expect, it } from "vitest";
import { terrainWeights } from "./terrain_paint.js";

describe("terrainWeights", () => {
  it("keeps high snow terrain weights inside the normalized range", () => {
    for (let y = 0; y <= 128; y += 0.25) {
      const weights = terrainWeights(y, 1);
      const sum = weights.reduce((acc, value) => acc + value, 0);
      expect(sum).toBeCloseTo(1, 6);
      for (const weight of weights) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });
});
