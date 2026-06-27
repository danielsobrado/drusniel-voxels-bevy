import { describe, expect, it } from "vitest";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import { cloneWaterConfig } from "./waterConfig.js";
import { WaterField } from "./waterField.js";
import { createDeepOceanSampler } from "./ocean_service.js";

describe("shore surf boundary", () => {
  it("samples shallow surf only inside the playable world border", () => {
    const cfg = cloneWaterConfig();
    cfg.source = "fake_bodies";
    cfg.fakeBodies.lakes = [];
    cfg.fakeBodies.rivers = [];
    const field = new WaterField(cfg, { surfaceHeight: () => 17 }, null, 256);
    field.setShoreSurfBand({
      enabled: true,
      startDistance: 32,
      fullSurfDistance: 0,
      level: 18,
      maxShallowDepth: 2.5,
    });

    expect(field.sample(0, 128).bodyMask).toBeGreaterThan(0);
    expect(field.sample(-1, 128).bodyMask).toBe(0);
    expect(field.sample(257, 128).bodyMask).toBe(0);
  });

  it("can exclude border fake-body water from the clipmap", () => {
    const cfg = cloneWaterConfig();
    cfg.source = "fake_bodies";
    cfg.fakeBodies.lakes = [{ center: [8, 128], radius: [16, 16], levelOffset: 4 }];
    cfg.fakeBodies.rivers = [];
    const field = new WaterField(cfg, { surfaceHeight: () => 17 }, null, 256);
    expect(field.sample(8, 128).bodyMask).toBeGreaterThan(0);

    field.setClipmapExclusionBand({ enabled: true, distance: 32 });
    expect(field.sample(8, 128).bodyMask).toBe(0);
  });

  it("keeps fake-body water dry outside the playable world", () => {
    const cfg = cloneWaterConfig();
    cfg.source = "fake_bodies";
    cfg.fakeBodies.lakes = [{ center: [-8, 128], radius: [32, 32], levelOffset: 4 }];
    cfg.fakeBodies.rivers = [];
    const field = new WaterField(cfg, { surfaceHeight: () => 17 }, null, 256);

    const outside = field.sample(-8, 128);
    expect(outside.bodyMask).toBe(0);
    expect(outside.depth).toBeLessThanOrEqual(0);
  });
});

describe("deep ocean sampler boundary", () => {
  it("treats only positions outside the transition gap as future boat ocean", () => {
    const sampler = createDeepOceanSampler(256, {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      startOutsideBorderM: 64,
      extendCells: 128,
      surfaceY: 18,
      segments: 8,
    });

    expect(sampler.isInPlayableOcean(321, 128)).toBe(true);
    expect(sampler.isInPlayableOcean(300, 128)).toBe(false);
    expect(sampler.isInPlayableOcean(8, 128)).toBe(false);
    expect(sampler.isInPlayableOcean(128, 128)).toBe(false);
    expect(Number.isFinite(sampler.sampleOceanHeight(321, 128, 1))).toBe(true);
    expect(Number.isNaN(sampler.sampleOceanHeight(300, 128, 1))).toBe(true);
  });
});
