import { describe, expect, it } from "vitest";
import { WATER_LEVEL } from "../terrain/terrain.js";
import { resolveQuerySpawnPoint, shouldApplyQuerySpawnNow } from "./player_mode_controller.js";

describe("resolveQuerySpawnPoint", () => {
  it("keeps an already dry query spawn unchanged", () => {
    const spawn = resolveQuerySpawnPoint(2048, 2048, () => WATER_LEVEL + 5);

    expect(spawn.x).toBe(2048);
    expect(spawn.z).toBe(2048);
    expect(spawn.y).toBe(WATER_LEVEL + 5);
    expect(spawn.adjusted).toBe(false);
  });

  it("moves an underwater query spawn to nearby dry land", () => {
    const spawn = resolveQuerySpawnPoint(2048, 2048, (x, z) => (
      Math.hypot(x - 2080, z - 2048) < 1 ? WATER_LEVEL + 4 : WATER_LEVEL - 6
    ));

    expect(spawn.adjusted).toBe(true);
    expect(spawn.x).toBeCloseTo(2080, 5);
    expect(spawn.z).toBeCloseTo(2048, 5);
    expect(spawn.y).toBe(WATER_LEVEL + 4);
  });

  it("uses the highest finite fallback when no dry point exists", () => {
    const spawn = resolveQuerySpawnPoint(2048, 2048, (x) => (
      x > 2048 ? WATER_LEVEL - 1 : Number.NaN
    ));

    expect(spawn.adjusted).toBe(true);
    expect(spawn.y).toBe(WATER_LEVEL - 1);
  });
});

describe("shouldApplyQuerySpawnNow", () => {
  const base = { enabled: true, safetyReady: 0, safetyRequired: 0, collidersLoaded: 0, framesWaited: 0, maxFrames: 300 };

  it("spawns immediately when the gate is disabled (finite worlds)", () => {
    expect(shouldApplyQuerySpawnNow({ ...base, enabled: false })).toBe(true);
  });

  it("waits while streamed-root safety coverage is incomplete", () => {
    expect(shouldApplyQuerySpawnNow({ ...base, safetyRequired: 8, safetyReady: 3, collidersLoaded: 4 })).toBe(false);
  });

  it("waits while safety coverage is unknown (required=0)", () => {
    expect(shouldApplyQuerySpawnNow({ ...base, safetyRequired: 0, safetyReady: 0, collidersLoaded: 4 })).toBe(false);
  });

  it("waits until at least one collider page has loaded", () => {
    expect(shouldApplyQuerySpawnNow({ ...base, safetyRequired: 8, safetyReady: 8, collidersLoaded: 0 })).toBe(false);
  });

  it("spawns once safety coverage and colliders are ready", () => {
    expect(shouldApplyQuerySpawnNow({ ...base, safetyRequired: 8, safetyReady: 8, collidersLoaded: 2 })).toBe(true);
  });

  it("spawns anyway once the frame cap is reached, even if the stream stalled", () => {
    expect(shouldApplyQuerySpawnNow({ ...base, safetyRequired: 8, safetyReady: 0, collidersLoaded: 0, framesWaited: 300 })).toBe(true);
  });
});
