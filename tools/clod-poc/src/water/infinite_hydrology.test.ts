import { describe, expect, it } from "vitest";
import { HYDROLOGY_BODY_DRY, HYDROLOGY_BODY_LAKE, HYDROLOGY_BODY_POND } from "./hydrologyGrid.js";
import {
  carveInfiniteHydrologyHeight,
  createTracedHydrologyCarver,
  measureTracedRiverContinuity,
  sampleInfiniteHydrology,
  type InfiniteHydrologyCarveConfig,
} from "./infinite_hydrology.js";

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

describe("traced-channel terrain carve", () => {
  const hilly = {
    surfaceHeight: (x: number, z: number) =>
      30 + Math.sin(x * 0.004) * 16 + Math.cos(z * 0.0031) * 12 + Math.sin((x + z) * 0.0012) * 6,
  };
  const carve: InfiniteHydrologyCarveConfig = { depthM: 4, power: 1.35, lakeBedDepthM: 2 };
  const options = { carve };

  function findCarvedSamples(
    count: number,
    accept: (s: ReturnType<typeof sampleInfiniteHydrology>) => boolean,
  ): Array<{ x: number; z: number; s: ReturnType<typeof sampleInfiniteHydrology> }> {
    const found: Array<{ x: number; z: number; s: ReturnType<typeof sampleInfiniteHydrology> }> = [];
    for (let z = 0; z < 8000 && found.length < count; z += 16) {
      for (let x = 0; x < 8000 && found.length < count; x += 16) {
        const s = sampleInfiniteHydrology(x, z, hilly, options);
        if (accept(s)) found.push({ x, z, s });
      }
    }
    return found;
  }

  it("never raises terrain and matches the sample terrainY (one carve authority)", () => {
    for (let z = 0; z < 3000; z += 61) {
      for (let x = 0; x < 3000; x += 61) {
        const base = hilly.surfaceHeight(x, z);
        const carved = carveInfiniteHydrologyHeight(x, z, base, hilly, carve);
        expect(carved).toBeLessThanOrEqual(base);
        expect(sampleInfiniteHydrology(x, z, hilly, options).terrainY).toBe(carved);
      }
    }
  });

  it("guarantees visible depth in the wet core of rivers (no pothole chains)", () => {
    const rivers = findCarvedSamples(40, (s) => s.riverMask >= 0.999);
    expect(rivers.length).toBeGreaterThan(0);
    // Core carve profile: depth >= 0.35 * depthM below the channel level.
    for (const { s } of rivers) expect(s.depth).toBeGreaterThanOrEqual(0.35 * carve.depthM - 0.01);
  });

  it("keeps the channel wet while walking downstream (continuity)", () => {
    const starts = findCarvedSamples(8, (s) => s.riverMask >= 0.9 && s.depth > 0.5);
    expect(starts.length).toBeGreaterThan(0);
    let walked = 0;
    for (const start of starts) {
      let { x, z } = start;
      let s = start.s;
      for (let step = 0; step < 20; step++) {
        x += s.flowX * 12;
        z += s.flowZ * 12;
        s = sampleInfiniteHydrology(x, z, hilly, options);
        if (s.riverMask < 0.3) break; // drifted off the channel core / reached the outlet
        expect(s.depth).toBeGreaterThan(0.2);
        walked++;
      }
    }
    expect(walked).toBeGreaterThan(20);
  });

  it("fades the carve to zero at the channel edge (no bank cliffs)", () => {
    const rivers = findCarvedSamples(6, (s) => s.riverMask >= 0.999);
    expect(rivers.length).toBeGreaterThan(0);
    for (const { x, z } of rivers) {
      // Perpendicular transect across the channel; the carved surface may be steep but
      // must not jump: a hard clamp at the width boundary would step by metres.
      const s = sampleInfiniteHydrology(x, z, hilly, options);
      const px = -s.flowZ;
      const pz = s.flowX;
      let prev: number | null = null;
      for (let d = -60; d <= 60; d += 0.5) {
        const sx = x + px * d;
        const sz = z + pz * d;
        const carved = carveInfiniteHydrologyHeight(sx, sz, hilly.surfaceHeight(sx, sz), hilly, carve);
        if (prev !== null) expect(Math.abs(carved - prev)).toBeLessThan(2);
        prev = carved;
      }
    }
  });

  it("deepens lake and pond beds to the configured visible depth", () => {
    // Egg-carton terrain: real depressions everywhere, so hashed basins validate.
    const dimpled = {
      surfaceHeight: (x: number, z: number) => 30 + Math.sin(x * 0.02) * 8 * Math.cos(z * 0.02),
    };
    const lakes: Array<ReturnType<typeof sampleInfiniteHydrology>> = [];
    for (let z = 0; z < 12_000 && lakes.length < 10; z += 16) {
      for (let x = 0; x < 12_000 && lakes.length < 10; x += 16) {
        const s = sampleInfiniteHydrology(x, z, dimpled, options);
        if ((s.bodyKind === HYDROLOGY_BODY_LAKE || s.bodyKind === HYDROLOGY_BODY_POND) && s.bodyMask >= 0.999) {
          lakes.push(s);
        }
      }
    }
    expect(lakes.length).toBeGreaterThan(0);
    for (const s of lakes) expect(s.depth).toBeGreaterThanOrEqual(carve.lakeBedDepthM - 0.01);
  });

  it("is pure across memo evictions with the carve enabled", () => {
    const probe = () => {
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        const x = 130 + i * 37.5;
        const z = 4210 - i * 21.25;
        out.push(carveInfiniteHydrologyHeight(x, z, hilly.surfaceHeight(x, z), hilly, carve));
      }
      return out;
    };
    const before = probe();
    for (let i = 0; i < 600; i++) {
      sampleInfiniteHydrology(-200_000 + i * 768, 90_000 + i * 768, hilly, options);
    }
    expect(probe()).toEqual(before);
  });

  it("reports full continuity with the carve and degraded continuity without it", () => {
    const carved = measureTracedRiverContinuity(3000, 3000, 3000, hilly, carve, 0.5);
    expect(carved.channels).toBeGreaterThan(0);
    expect(carved.pct).toBe(100);
    // A near-zero carve depth reproduces the pothole failure mode the gate exists for.
    const potholes = measureTracedRiverContinuity(3000, 3000, 3000, hilly, { ...carve, depthM: 0.01 }, 0.5);
    expect(potholes.pct).toBeLessThan(100);
  });

  it("exposes the carver seam used by the terrain authorities", () => {
    const carver = createTracedHydrologyCarver(hilly);
    for (let i = 0; i < 50; i++) {
      const x = 55 + i * 111;
      const z = 999 + i * 77;
      const base = hilly.surfaceHeight(x, z);
      expect(carver.carveHeight(x, z, base, carve)).toBe(carveInfiniteHydrologyHeight(x, z, base, hilly, carve));
    }
  });
});
