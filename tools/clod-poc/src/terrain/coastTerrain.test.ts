import { describe, expect, it } from "vitest";
import { defaultBorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import { shapeCoastTerrain } from "./coastTerrain.js";

const config = defaultBorderCoastOceanConfig;

describe("shapeCoastTerrain", () => {
  it("does not affect terrain far from the border", () => {
    const sample = shapeCoastTerrain({ x: 0, z: 0 }, 80, config, 7);

    expect(sample.affected).toBe(false);
    expect(sample.height).toBe(80);
    expect(sample.material).toBe("inland");
  });

  it("submerges playable corners instead of leaving square terrain corners", () => {
    for (const pos of [
      { x: config.world.bounds.min_x, z: config.world.bounds.min_z },
      { x: config.world.bounds.max_x, z: config.world.bounds.min_z },
      { x: config.world.bounds.max_x, z: config.world.bounds.max_z },
      { x: config.world.bounds.min_x, z: config.world.bounds.max_z },
    ]) {
      const sample = shapeCoastTerrain(pos, 100, config, 17);
      expect(sample.affected).toBe(true);
      expect(sample.height).toBeLessThan(config.world.water_level);
    }
  });

  it("is deterministic at shared chunk and page coordinates", () => {
    const pos = { x: config.world.bounds.max_x - 128, z: 256 };
    const first = shapeCoastTerrain(pos, 90, config, 99);
    const second = shapeCoastTerrain(pos, 90, config, 99);

    expect(second).toEqual(first);
  });

  it("does not generate terrain outside playable bounds", () => {
    const sample = shapeCoastTerrain(
      { x: config.world.bounds.max_x + 1, z: 0 },
      63,
      config,
      3,
    );

    expect(sample.affected).toBe(false);
    expect(sample.height).toBe(63);
  });

  it("produces finite coastal heights and material masks across a border transect", () => {
    for (let distance = 0; distance <= config.coast.band.width_m * 2; distance += 8) {
      const sample = shapeCoastTerrain(
        { x: config.world.bounds.max_x - distance, z: 300 },
        75,
        config,
        123,
      );
      expect(Number.isFinite(sample.height)).toBe(true);
      for (const weight of Object.values(sample.materialWeights)) {
        expect(Number.isFinite(weight)).toBe(true);
        expect(weight).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
