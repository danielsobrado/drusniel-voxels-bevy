import { describe, expect, it } from "vitest";
import {
  cloneEnvironmentalMaskSettings,
  parseEnvironmentalMaskConfig,
} from "./environment_mask_config.js";

describe("river mist environmental configuration", () => {
  it("parses particle settings and enforces allocation budgets", () => {
    const settings = parseEnvironmentalMaskConfig(`
river_mist:
  particles:
    spawn_radius_m: 999
    spacing_m: 0.1
    sample_hint_m: 999
    max_particles: 99999
    max_emitters_per_tick: 999
    scan_cells_per_frame: 9999
    min_lifetime_s: 5
    max_lifetime_s: 0.05
    color_rgb: [-1, 0.5, 2]
`, null);

    expect(settings.riverMist.particles.spawnRadiusM).toBe(256);
    expect(settings.riverMist.particles.spacingM).toBe(1);
    expect(settings.riverMist.particles.sampleHintM).toBe(256);
    expect(settings.riverMist.particles.maxParticles).toBe(2_048);
    expect(settings.riverMist.particles.maxEmittersPerTick).toBe(128);
    expect(settings.riverMist.particles.scanCellsPerFrame).toBe(512);
    expect(settings.riverMist.particles.minLifetimeS).toBe(5);
    expect(settings.riverMist.particles.maxLifetimeS).toBe(5);
    expect(settings.riverMist.particles.colorRgb).toEqual([0, 0.5, 1]);
  });

  it("deep clones nested particle state", () => {
    const first = cloneEnvironmentalMaskSettings();
    const second = cloneEnvironmentalMaskSettings(first);
    second.riverMist.particles.colorRgb[0] = 0;
    second.riverMist.particles.maxParticles = 1;
    expect(first.riverMist.particles.colorRgb[0]).not.toBe(0);
    expect(first.riverMist.particles.maxParticles).not.toBe(1);
  });
});
