import { describe, expect, it } from "vitest";
import { computeBorderDistance } from "../borderDistance.js";
import { sampleCoastMask } from "../coastMask.js";
import { defaultBorderCoastOceanConfig } from "../../config/borderCoastOceanConfig.js";

const bounds = defaultBorderCoastOceanConfig.world.bounds;
const coast = defaultBorderCoastOceanConfig.coast;

describe("computeBorderDistance", () => {
  it("reports the center as inside with a positive signed distance", () => {
    const result = computeBorderDistance({ x: 0, z: 0 }, bounds);

    expect(result.inside).toBe(true);
    expect(result.distanceToNearestBorder).toBe(2048);
    expect(result.signedDistanceToPlayableArea).toBe(2048);
    expect(result.nearestSide).toBe("west");
    expect(result.nearestBorderNormal).toEqual({ x: -1, z: 0 });
  });

  it.each([
    ["north", { x: 100, z: 2048 }, { x: 0, z: 1 }],
    ["south", { x: 100, z: -2048 }, { x: 0, z: -1 }],
    ["east", { x: 2048, z: 100 }, { x: 1, z: 0 }],
    ["west", { x: -2048, z: 100 }, { x: -1, z: 0 }],
  ] as const)("reports the %s border", (side, pos, normal) => {
    const result = computeBorderDistance(pos, bounds);

    expect(result.inside).toBe(true);
    expect(result.distanceToNearestBorder).toBe(0);
    expect(result.signedDistanceToPlayableArea).toBe(0);
    expect(result.nearestSide).toBe(side);
    expect(result.nearestBorderNormal).toEqual(normal);
  });

  it.each([
    [{ x: -2048, z: -2048 }, { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }],
    [{ x: 2048, z: -2048 }, { x: Math.SQRT1_2, z: -Math.SQRT1_2 }],
    [{ x: 2048, z: 2048 }, { x: Math.SQRT1_2, z: Math.SQRT1_2 }],
    [{ x: -2048, z: 2048 }, { x: -Math.SQRT1_2, z: Math.SQRT1_2 }],
  ])("reports playable corner %o", (pos, normal) => {
    const result = computeBorderDistance(pos, bounds);

    expect(result.inside).toBe(true);
    expect(result.nearestSide).toBe("corner");
    expect(result.nearestBorderNormal.x).toBeCloseTo(normal.x);
    expect(result.nearestBorderNormal.z).toBeCloseTo(normal.z);
  });

  it("reports an outside edge with negative signed distance", () => {
    const result = computeBorderDistance({ x: 2100, z: 0 }, bounds);

    expect(result.inside).toBe(false);
    expect(result.distanceToNearestBorder).toBe(52);
    expect(result.signedDistanceToPlayableArea).toBe(-52);
    expect(result.nearestSide).toBe("east");
    expect(result.nearestBorderNormal).toEqual({ x: 1, z: 0 });
  });

  it("reports an outside corner using Euclidean distance and a diagonal normal", () => {
    const result = computeBorderDistance({ x: 2078, z: 2088 }, bounds);

    expect(result.inside).toBe(false);
    expect(result.distanceToNearestBorder).toBe(50);
    expect(result.signedDistanceToPlayableArea).toBe(-50);
    expect(result.nearestSide).toBe("corner");
    expect(result.nearestBorderNormal).toEqual({ x: 0.6, z: 0.8 });
  });
});

describe("sampleCoastMask", () => {
  it("keeps the world center outside the coast band", () => {
    const result = sampleCoastMask({ x: 0, z: 0 }, bounds, coast, 42);

    expect(result.inCoastBand).toBe(false);
    expect(result.coastAlpha).toBe(0);
    expect(result.bandT).toBe(1);
  });

  it.each([
    { x: 0, z: 1900 },
    { x: 0, z: -1900 },
    { x: 1900, z: 0 },
    { x: -1900, z: 0 },
  ])("samples a coast band near border position %o", (pos) => {
    const result = sampleCoastMask(pos, bounds, coast, 42);

    expect(result.inCoastBand).toBe(true);
    expect(result.coastAlpha).toBeGreaterThan(0);
    expect(result.bandT).toBeGreaterThanOrEqual(0);
    expect(result.bandT).toBeLessThanOrEqual(1);
  });

  it.each([
    { x: -1950, z: -1950 },
    { x: 1950, z: -1950 },
    { x: 1950, z: 1950 },
    { x: -1950, z: 1950 },
  ])("rounds and noises coast corners at %o", (pos) => {
    const result = sampleCoastMask(pos, bounds, coast, 42);

    expect(Math.abs(result.nearestBorderNormal.x)).toBeGreaterThan(0);
    expect(Math.abs(result.nearestBorderNormal.z)).toBeGreaterThan(0);
    expect(Math.hypot(result.nearestBorderNormal.x, result.nearestBorderNormal.z)).toBeCloseTo(1);
  });

  it("does not mark outside positions as in-bounds coast terrain", () => {
    const outsideEdge = sampleCoastMask({ x: 2100, z: 0 }, bounds, coast, 42);
    const outsideCorner = sampleCoastMask({ x: 2100, z: 2100 }, bounds, coast, 42);

    expect(outsideEdge.inCoastBand).toBe(false);
    expect(outsideEdge.coastAlpha).toBe(0);
    expect(outsideCorner.inCoastBand).toBe(false);
    expect(outsideCorner.coastAlpha).toBe(0);
  });

  it("is stable for the same world seed and position", () => {
    const first = sampleCoastMask({ x: 1920, z: 640 }, bounds, coast, 731);
    const second = sampleCoastMask({ x: 1920, z: 640 }, bounds, coast, 731);

    expect(second).toEqual(first);
  });

  it("changes deterministic coast sampling for a different world seed", () => {
    const samplesA = Array.from({ length: 20 }, (_, index) =>
      sampleCoastMask({ x: -1800 + index * 180, z: 1900 }, bounds, coast, 100),
    );
    const samplesB = Array.from({ length: 20 }, (_, index) =>
      sampleCoastMask({ x: -1800 + index * 180, z: 1900 }, bounds, coast, 101),
    );

    expect(samplesB).not.toEqual(samplesA);
  });

  it("blends coast weights and keeps them normalized", () => {
    const samples = Array.from({ length: 80 }, (_, index) =>
      sampleCoastMask({ x: -2000 + index * 50, z: 1900 }, bounds, coast, 99),
    );
    const blended = samples.find((sample) =>
      Object.values(sample.weights).filter((weight) => weight > 0.001).length > 1,
    );

    expect(blended).toBeDefined();
    const total = Object.values(blended?.weights ?? {}).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1);
  });
});
