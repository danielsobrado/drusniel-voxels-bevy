import { describe, expect, it } from "vitest";
import { createSpawnWaitIndicator, spawnWaitLabel, spawnWaitProgress } from "./spawn_wait_indicator.js";

describe("spawn wait indicator", () => {
  it("progress grows with safety pages and completes only with colliders", () => {
    expect(spawnWaitProgress({ safetyReady: 0, safetyRequired: 500, collidersLoaded: 0 })).toBe(0);
    const half = spawnWaitProgress({ safetyReady: 250, safetyRequired: 500, collidersLoaded: 0 });
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.5);
    expect(spawnWaitProgress({ safetyReady: 500, safetyRequired: 500, collidersLoaded: 3 })).toBe(1);
  });

  it("clamps overshoot and handles zero required", () => {
    expect(spawnWaitProgress({ safetyReady: 900, safetyRequired: 500, collidersLoaded: 5 })).toBe(1);
    expect(spawnWaitProgress({ safetyReady: 0, safetyRequired: 0, collidersLoaded: 0 })).toBe(0);
  });

  it("labels what is being waited on", () => {
    expect(spawnWaitLabel({ safetyReady: 64, safetyRequired: 509, collidersLoaded: 224 })).toContain("64/509");
  });

  it("is a no-op without a DOM (node test environment)", () => {
    const indicator = createSpawnWaitIndicator();
    expect(() => {
      indicator.update({ safetyReady: 1, safetyRequired: 2, collidersLoaded: 0 });
      indicator.done();
    }).not.toThrow();
  });
});
