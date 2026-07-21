import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./tree_config.js";
import {
  sampleTreeImpostorWindDisplacement,
  TREE_IMPOSTOR_WIND_HEIGHT_POWER,
  TREE_WIND_GUST_PHASE_SCALE,
  TREE_WIND_GUST_TIME_SCALE,
  TREE_WIND_HASH_SCALE,
  TREE_WIND_HASH_X,
  TREE_WIND_HASH_Z,
  TREE_WIND_PHASE_TAU,
  TREE_WIND_PROPAGATION,
  treeImpostorWindActive,
  treeWindPhase,
} from "./tree_impostor_wind.js";

function input(overrides: Partial<Parameters<typeof sampleTreeImpostorWindDisplacement>[0]> = {}) {
  const settings = cloneTreeSettings();
  settings.wind.enabled = true;
  settings.wind.direction = [3, 4];
  settings.wind.strength = 0.8;
  settings.wind.speed = 1.7;
  settings.wind.gustStrength = 0.25;
  settings.wind.trunkSwayStrength = 0.9;
  return {
    x: 37,
    z: -18,
    height01: 1,
    instanceScale: 1.2,
    yaw: 0,
    age01: 0.65,
    stiffness: 1,
    timeSeconds: 2.4,
    settings: settings.wind,
    ...overrides,
  };
}

describe("tree impostor wind", () => {
  it("locks the phase constants to the far-tree contract", () => {
    expect(TREE_WIND_HASH_X).toBe(127.1);
    expect(TREE_WIND_HASH_Z).toBe(311.7);
    expect(TREE_WIND_HASH_SCALE).toBe(43758.5453123);
    expect(TREE_WIND_PHASE_TAU).toBe(6.2831853);
    expect(TREE_WIND_PROPAGATION).toBe(0.035);
    expect(TREE_WIND_GUST_TIME_SCALE).toBe(0.37);
    expect(TREE_WIND_GUST_PHASE_SCALE).toBe(12.9898);
    expect(TREE_IMPOSTOR_WIND_HEIGHT_POWER).toBe(2);
  });

  it("is deterministic for a fixed world position and time", () => {
    const first = sampleTreeImpostorWindDisplacement(input());
    const second = sampleTreeImpostorWindDisplacement(input());

    expect(second).toEqual(first);
    expect(Math.hypot(...first)).toBeGreaterThan(0.001);
    expect(treeWindPhase(37, -18)).toBe(treeWindPhase(37, -18));
  });

  it("anchors the card base and disables all movement when wind is off", () => {
    const bottom = sampleTreeImpostorWindDisplacement(input({ height01: 0 }));
    const disabledSettings = { ...input().settings, enabled: false };
    const disabled = sampleTreeImpostorWindDisplacement(input({ settings: disabledSettings }));

    expect(bottom).toEqual([0, 0]);
    expect(disabled).toEqual([0, 0]);
  });

  it("matches the current mesh wind axis when yaw is zero", () => {
    const [x, z] = sampleTreeImpostorWindDisplacement(input());
    const magnitude = Math.hypot(x, z);

    expect(Math.abs(x / magnitude)).toBeCloseTo(0.6, 6);
    expect(Math.abs(z / magnitude)).toBeCloseTo(0.8, 6);
    expect(Math.abs(x * 0.8 - z * 0.6)).toBeLessThan(1e-8);
  });

  it("applies the same instance-yaw transform as current far meshes", () => {
    const unrotated = sampleTreeImpostorWindDisplacement(input({ yaw: 0 }));
    const quarterTurn = sampleTreeImpostorWindDisplacement(input({ yaw: Math.PI / 2 }));

    expect(quarterTurn[0]).toBeCloseTo(unrotated[1], 6);
    expect(quarterTurn[1]).toBeCloseTo(-unrotated[0], 6);
  });

  it("reduces sway for stiff trees and preserves instance scaling", () => {
    const flexible = sampleTreeImpostorWindDisplacement(input({ stiffness: 0.65, instanceScale: 1 }));
    const stiff = sampleTreeImpostorWindDisplacement(input({ stiffness: 1.35, instanceScale: 1 }));
    const doubled = sampleTreeImpostorWindDisplacement(input({ stiffness: 0.65, instanceScale: 2 }));

    expect(Math.hypot(...flexible)).toBeGreaterThan(Math.hypot(...stiff));
    expect(doubled[0]).toBeCloseTo(flexible[0] * 2, 6);
    expect(doubled[1]).toBeCloseTo(flexible[1] * 2, 6);
  });

  it("reports steady and gust-only wind as active", () => {
    const steady = cloneTreeSettings();
    steady.wind.enabled = true;
    steady.wind.strength = 1;
    steady.wind.gustStrength = 0;
    steady.wind.trunkSwayStrength = 1;
    const gustOnly = cloneTreeSettings();
    gustOnly.wind.enabled = true;
    gustOnly.wind.strength = 0;
    gustOnly.wind.gustStrength = 1;
    gustOnly.wind.trunkSwayStrength = 1;
    const disabled = cloneTreeSettings();
    disabled.wind.enabled = false;

    expect(treeImpostorWindActive(steady)).toBe(true);
    expect(treeImpostorWindActive(gustOnly)).toBe(true);
    expect(treeImpostorWindActive(disabled)).toBe(false);
  });

  it("fails safely for malformed runtime input", () => {
    const malformed = sampleTreeImpostorWindDisplacement(input({
      x: Number.NaN,
      z: Number.POSITIVE_INFINITY,
      height01: Number.NaN,
      instanceScale: Number.NaN,
      yaw: Number.NaN,
      age01: Number.NaN,
      stiffness: Number.NaN,
      timeSeconds: Number.NaN,
      settings: { ...input().settings, direction: [0, 0] },
    }));

    expect(malformed.every(Number.isFinite)).toBe(true);
  });
});
