import { describe, expect, it } from "vitest";
import { deriveWaterFoamSyntheticDistances } from "./water-foam-distance-acceptance-profile.js";

describe("water foam distance acceptance profile", () => {
  it("samples before, halfway through, and beyond the live fade range", () => {
    expect(deriveWaterFoamSyntheticDistances({
      valid: true,
      startM: 120,
      endM: 320,
    })).toEqual({
      nearM: 70,
      midM: 220,
      farM: 370,
    });
  });

  it("clamps the near sample at world-space zero", () => {
    expect(deriveWaterFoamSyntheticDistances({
      valid: true,
      startM: 10,
      endM: 110,
    }).nearM).toBe(0);
  });

  it("rejects unavailable, non-finite, and reversed ranges", () => {
    expect(() => deriveWaterFoamSyntheticDistances({
      valid: false,
      startM: 120,
      endM: 320,
    })).toThrow(/invalid live foam distance fade/);
    expect(() => deriveWaterFoamSyntheticDistances({
      valid: true,
      startM: Number.NaN,
      endM: 320,
    })).toThrow(/invalid live foam distance fade/);
    expect(() => deriveWaterFoamSyntheticDistances({
      valid: true,
      startM: 320,
      endM: 120,
    })).toThrow(/invalid live foam distance fade/);
  });
});
