import { describe, expect, it } from "vitest";
import { parseStoneConfig } from "./stone_config.js";

describe("stone_config", () => {
  it("maps YAML snake_case to runtime stone settings", () => {
    const cfg = parseStoneConfig(`
enabled: true
seed_salt: 123
cell_size_m: 3.5
max_instances: 99
water_margin_m: 0.75
patch_clump_cell_mult: 4
debug:
  class_colors: true
large:
  radius_min: 0.7
  presets: [slab, angular]
`);
    expect(cfg.enabled).toBe(true);
    expect(cfg.seedSalt).toBe(123);
    expect(cfg.cellSizeM).toBe(3.5);
    expect(cfg.maxInstances).toBe(99);
    expect(cfg.waterMarginM).toBe(0.75);
    expect(cfg.patchClumpCellMult).toBe(4);
    expect(cfg.debug.classColors).toBe(true);
    expect(cfg.classes.large.radiusMin).toBe(0.7);
    expect(cfg.classes.large.presets).toEqual(["slab", "angular"]);
  });

  it("maps terrain density and class bias from YAML", () => {
    const cfg = parseStoneConfig(`
terrain:
  low_height_m: 20
  high_height_m: 80
  height_blend_m: 10
  snow:
    density: 0.5
    large: 2.0
    medium: 0.8
    small: 0.2
`, null);

    expect(cfg.terrain.lowHeightM).toBe(20);
    expect(cfg.terrain.highHeightM).toBe(80);
    expect(cfg.terrain.heightBlendM).toBe(10);
    expect(cfg.terrain.snow).toEqual({ density: 0.5, large: 2.0, medium: 0.8, small: 0.2 });
  });

  it("clamps negative terrain weights and falls back on malformed YAML", () => {
    const cfg = parseStoneConfig(`
terrain:
  grass:
    density: -1
    large: -2
`, null);
    expect(cfg.terrain.grass.density).toBe(0);
    expect(cfg.terrain.grass.large).toBe(0);

    const warnings: string[] = [];
    const fallback = parseStoneConfig("terrain:\n  snow: [", (message) => warnings.push(message));
    expect(warnings).toHaveLength(1);
    expect(fallback.terrain.snow.large).toBe(1.75);
  });
});
