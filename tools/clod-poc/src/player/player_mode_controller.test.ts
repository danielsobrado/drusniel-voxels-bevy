import { describe, expect, it } from "vitest";
import { WATER_LEVEL } from "../terrain/terrain.js";
import { resolveQuerySpawnPoint } from "./player_mode_controller.js";

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
