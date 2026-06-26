import { describe, expect, it } from "vitest";
import { terrainWeights } from "./terrain_paint.js";

describe("terrainWeights", () => {
  it("keeps high snow terrain weights inside the normalized range", () => {
    for (const y of [...Array.from({ length: 513 }, (_, index) => index * 0.25), 256]) {
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
