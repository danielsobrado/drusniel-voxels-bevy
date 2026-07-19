import { describe, expect, it } from "vitest";
import {
  cloneEnvironmentalMaskSettings,
  parseEnvironmentalMaskConfig,
} from "./environment_mask_config.js";

const CONFIG = `
sunbeam_mote:
  enabled: true
  strength: 4
  visibility_start: 0.8
  visibility_end: 0.2
  particles:
    max_particles: 9999
    spawn_radius_m: 999
    fade_start_m: 99
    fade_end_m: -4
    update_period_frames: 999
    density: -1
    opacity: 5
    forward_scatter_power: 99
    mist_floor: -2
    warm_color_rgb: [2, -1, 0.5]
    cold_color_rgb: [0.2, 0.4, 8]
`;

describe("sunbeam mote environment-mask config", () => {
  it("clamps unsafe visual and allocation settings", () => {
    const settings = parseEnvironmentalMaskConfig(CONFIG, null).sunbeamMote;
    expect(settings.strength).toBe(1);
    expect(settings.visibilityEnd).toBe(settings.visibilityStart);
    expect(settings.particles.maxParticles).toBe(1200);
    expect(settings.particles.spawnRadiusM).toBe(96);
    expect(settings.particles.fadeStartM).toBe(96);
    expect(settings.particles.fadeEndM).toBe(96);
    expect(settings.particles.updatePeriodFrames).toBe(120);
    expect(settings.particles.density).toBe(0);
    expect(settings.particles.opacity).toBe(1);
    expect(settings.particles.forwardScatterPower).toBe(32);
    expect(settings.particles.mistFloor).toBe(0);
    expect(settings.particles.warmColorRgb).toEqual([1, 0, 0.5]);
    expect(settings.particles.coldColorRgb).toEqual([0.2, 0.4, 1]);
  });

  it("deep-clones particle color ownership", () => {
    const source = parseEnvironmentalMaskConfig(CONFIG, null);
    const clone = cloneEnvironmentalMaskSettings(source);
    clone.sunbeamMote.particles.warmColorRgb[0] = 0;
    clone.sunbeamMote.particles.coldColorRgb[2] = 0;
    expect(source.sunbeamMote.particles.warmColorRgb[0]).toBe(1);
    expect(source.sunbeamMote.particles.coldColorRgb[2]).toBe(1);
  });
});
