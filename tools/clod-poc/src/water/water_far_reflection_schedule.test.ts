import { describe, expect, it } from "vitest";
import { DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import { waterFarReflectionMarchDistances } from "./water_far_reflection_schedule.js";

describe("water far reflection march schedule", () => {
  it("covers the configured middle tier with six growing steps", () => {
    const policy = DEFAULT_WATER_VISUAL.reflection.farSummary;
    const distances = waterFarReflectionMarchDistances(policy);

    expect(distances).toHaveLength(6);
    expect(distances[0]).toBe(16);
    expect(distances.at(-1)).toBeCloseTo(302.33088, 4);
    expect(distances.every((distance, index) => index === 0 || distance > distances[index - 1]!)).toBe(true);
    expect(distances.every((distance) => distance <= policy.maxDistanceM)).toBe(true);
  });

  it("never emits more than the configured step count or beyond max distance", () => {
    expect(waterFarReflectionMarchDistances({
      maxSteps: 8,
      startDistanceM: 10,
      maxDistanceM: 25,
      stepGrowth: 2,
    })).toEqual([10, 20]);
  });
});
