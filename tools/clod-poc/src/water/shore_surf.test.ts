import { describe, expect, it } from "vitest";
import { WaterField } from "./waterField.js";
import { parseWaterConfig } from "./waterConfig.js";
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
});

describe("deep ocean sampler", () => {
  it("reports playable ocean outside world bounds only", () => {
    const sampler = createDeepOceanSampler(256, {
      enabled: true,
      extendCells: 64,
      surfaceY: 18,
      segments: 8,
    });
    expect(sampler.isInPlayableOcean(300, 128)).toBe(true);
    expect(sampler.isInPlayableOcean(128, 128)).toBe(false);
    expect(sampler.sampleOceanHeight(300, 128, 0)).toBeGreaterThan(0);
  });
});
