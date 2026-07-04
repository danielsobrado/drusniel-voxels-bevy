import { describe, expect, it } from "vitest";
import { HYDROLOGY_BODY_DRY } from "./hydrologyGrid.js";
import { sampleInfiniteHydrology } from "./infinite_hydrology.js";

const sampler = {
  surfaceHeight: (x: number, z: number) => Math.sin(x * 0.01) * 2 + Math.cos(z * 0.008) * 3,
};

describe("sampleInfiniteHydrology", () => {
  it("is deterministic for the same world coordinate", () => {
    expect(sampleInfiniteHydrology(1500, -300, sampler)).toEqual(sampleInfiniteHydrology(1500, -300, sampler));
  });

  it("samples real world coordinates instead of repeating by startup-world size", () => {
    const a = sampleInfiniteHydrology(1100, 150, sampler);
    const b = sampleInfiniteHydrology(1100 + 1024, 150, sampler);

    expect(a.terrainY).not.toBeCloseTo(b.terrainY, 8);
  });

  it("returns a valid dry fallback when no water body is present", () => {
    const sample = sampleInfiniteHydrology(64, 64, { surfaceHeight: () => 12 }, { drySentinelDepthM: 10 });

    if (sample.bodyKind === HYDROLOGY_BODY_DRY) {
      expect(sample.waterY).toBe(2);
      expect(sample.bodyMask).toBe(0);
    } else {
      expect(sample.waterY).toBeGreaterThanOrEqual(sample.terrainY);
    }
  });
});
