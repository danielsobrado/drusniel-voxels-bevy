import { describe, expect, it } from "vitest";
import { WaterField } from "./waterField.js";
import { parseWaterConfig, type WaterConfig } from "./waterConfig.js";
import waterYaml from "../../config/water.yaml?raw";
import { probeCliffDryAboveSea } from "../debug/border_ocean_scene.js";
import { createDeepOceanSampler } from "./ocean_service.js";

describe("shore surf band", () => {
  const worldCells = 256;
  const seaLevel = 18;

  function makeField(surfaceHeight: (x: number, z: number) => number): WaterField {
    return new WaterField(parseWaterConfig(waterYaml), { surfaceHeight }, null, worldCells);
  }

  it("does not flood cliffs above sea level", () => {
    expect(probeCliffDryAboveSea(seaLevel, worldCells)).toBe(1);
  });

  it("returns shallow surf only below sea level at the border", () => {
    const field = makeField(() => seaLevel - 1.5);
    field.setShoreSurfBand({
      enabled: true,
      startDistance: 48,
      fullSurfDistance: 16,
      level: seaLevel,
      maxShallowDepth: 2.5,
    });
    const sample = field.sample(4, worldCells * 0.5);
    expect(sample.waterY).toBe(seaLevel);
    expect(sample.depth).toBeGreaterThan(0);
    expect(sample.bodyMask).toBeGreaterThan(0);
  });

  it("skips interior points outside the shore band", () => {
    const field = makeField(() => seaLevel - 1);
    field.setShoreSurfBand({ enabled: true, startDistance: 48, fullSurfDistance: 16, level: seaLevel, maxShallowDepth: 2.5 });
    const interior = field.sample(worldCells * 0.5, worldCells * 0.5);
    expect(interior.bodyMask).toBe(0);
    expect(interior.depth).toBeLessThanOrEqual(0);
  });

  it("can exclude border fake-body water when deep ocean owns the band", () => {
    const cfg: WaterConfig = {
      ...parseWaterConfig(waterYaml),
      source: "fake_bodies",
      fakeBodies: {
        carveTerrain: false,
        lakes: [{ center: [8, 128], radius: [24, 24], levelOffset: 4 }],
        rivers: [],
      },
    };
    const field = new WaterField(cfg, { surfaceHeight: () => seaLevel - 2 }, null, worldCells);
    const flooded = field.sample(8, 128);
    expect(flooded.bodyMask).toBeGreaterThan(0);

    field.setClipmapExclusionBand({ enabled: true, distance: 48 });
    const excluded = field.sample(8, 128);
    expect(excluded.bodyMask).toBe(0);
    expect(excluded.depth).toBeLessThanOrEqual(0);
  });
});

describe("deep ocean sampler", () => {
  it("reports the outside skirt and playable border band as ocean without CPU wave simulation", () => {
    const sampler = createDeepOceanSampler(256, {
      enabled: true,
      extendCells: 64,
      surfaceY: 18,
      segments: 8,
    }, 48);
    expect(sampler.isInPlayableOcean(300, 128)).toBe(true);
    expect(sampler.isInPlayableOcean(8, 128)).toBe(true);
    expect(sampler.isInPlayableOcean(128, 128)).toBe(false);
    expect(sampler.sampleOceanHeight(300, 128, 1)).toBe(18);
    expect(sampler.sampleOceanNormal(300, 128, 1)).toEqual([0, 1, 0]);
    expect(sampler.sampleOceanCurrent(300, 128, 1)).toEqual([0, 0, 0]);
  });
});
