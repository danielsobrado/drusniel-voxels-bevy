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

describe("terrain-traced drainage channels", () => {
  // Undulating terrain with clear valleys so traced channels exist.
  const hilly = {
    surfaceHeight: (x: number, z: number) =>
      30 + Math.sin(x * 0.004) * 16 + Math.cos(z * 0.0031) * 12 + Math.sin((x + z) * 0.0012) * 6,
  };

  function findRiverSamples(count: number): Array<ReturnType<typeof sampleInfiniteHydrology>> {
    const found: Array<ReturnType<typeof sampleInfiniteHydrology>> = [];
    for (let z = 0; z < 6000 && found.length < count; z += 24) {
      for (let x = 0; x < 6000 && found.length < count; x += 24) {
        const s = sampleInfiniteHydrology(x, z, hilly);
        if (s.riverMask > 0.3 && s.depth > 0.1) found.push(s);
      }
    }
    return found;
  }

  it("produces rivers whose flow is normalized and whose water sits above terrain", () => {
    const rivers = findRiverSamples(25);
    expect(rivers.length).toBeGreaterThan(0);
    for (const s of rivers) {
      expect(s.waterY).toBeGreaterThan(s.terrainY); // never floats below/inside terrain
      const flowLen = Math.hypot(s.flowX, s.flowZ);
      expect(flowLen).toBeGreaterThan(0.99); // normalized flow direction
      expect(Number.isFinite(s.flowStrength)).toBe(true);
    }
  });

  it("keeps the water surface non-increasing when walking along the flow direction", () => {
    // Walk one step downstream from strong river samples; the canonical level must not
    // rise (small tolerance for crossing between segments/channels).
    let checked = 0;
    for (let z = 0; z < 6000 && checked < 10; z += 24) {
      for (let x = 0; x < 6000 && checked < 10; x += 24) {
        const s = sampleInfiniteHydrology(x, z, hilly);
        if (s.riverMask < 0.6 || s.depth < 0.15) continue;
        const down = sampleInfiniteHydrology(x + s.flowX * 24, z + s.flowZ * 24, hilly);
        if (down.riverMask < 0.3) continue; // walked off the channel
        expect(down.waterY).toBeLessThanOrEqual(s.waterY + 0.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("reproduces identical rivers after the channel memo evicts (pure retrace)", () => {
    const before = findRiverSamples(5);
    expect(before.length).toBeGreaterThan(0);
    // Flood the bounded channel memo with distant basins to force evictions.
    for (let i = 0; i < 600; i++) {
      sampleInfiniteHydrology(100_000 + i * 768, -50_000 - i * 768, hilly);
    }
    const again = findRiverSamples(5);
    expect(again).toEqual(before);
  });
});
