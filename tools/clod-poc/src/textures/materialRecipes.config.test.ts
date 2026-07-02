import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROCEDURAL_TEXTURE_CONFIG,
  parseProceduralTextureConfig,
} from "./materialRecipes.js";

describe("procedural texture config parsing", () => {
  it("parses terrain variation ranges from yaml", () => {
    const config = parseProceduralTextureConfig(`
procedural_textures:
  terrain:
    macro_variation_m: [3.0, 77.0]
    meso_variation_m: [1.25, 9.5]
    micro_variation_m: [0.08, 0.65]
`);

    expect(config.terrain.macro_variation_m).toEqual([3.0, 77.0]);
    expect(config.terrain.meso_variation_m).toEqual([1.25, 9.5]);
    expect(config.terrain.micro_variation_m).toEqual([0.08, 0.65]);
  });

  it("keeps unsafe cache dimensions and quality budgets bounded", () => {
    const config = parseProceduralTextureConfig(`
procedural_textures:
  noise:
    resolution: -64
    periods:
      value: -3
      fbm: 0
      ridged: 4
      worley: 5
  terrain:
    layer_resolution: 1
  terrain_material_quality:
    debug_flat:
      max_noise_fetches: -9
`);

    expect(config.noise.resolution).toBe(DEFAULT_PROCEDURAL_TEXTURE_CONFIG.noise.resolution);
    expect(config.noise.periods.value).toBe(DEFAULT_PROCEDURAL_TEXTURE_CONFIG.noise.periods.value);
    expect(config.noise.periods.fbm).toBe(DEFAULT_PROCEDURAL_TEXTURE_CONFIG.noise.periods.fbm);
    expect(config.noise.periods.ridged).toBe(4);
    expect(config.noise.periods.worley).toBe(5);
    expect(config.terrain.layer_resolution).toBe(2);
    expect(config.terrain_material_quality.debug_flat.max_noise_fetches).toBe(0);
  });
});
