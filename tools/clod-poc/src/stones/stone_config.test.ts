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
});
