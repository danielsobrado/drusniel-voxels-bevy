import { describe, expect, it, vi } from "vitest";
import {
  loadLongViewMaterialsConfig,
  parseQueryOverrides,
} from "../src/config/longViewMaterialsConfig.js";

describe("loadLongViewMaterialsConfig", () => {
  it("loads defaults when config is missing", () => {
    const cfg = loadLongViewMaterialsConfig("");
    expect(cfg.enabled).toBe(true);
    expect(cfg.material_quality.default).toBe("horizon_proxy");
    expect(cfg.terrain_bands.waterline_m).toBe(0);
    expect(cfg.terrain_bands.snow_min_height_m).toBe(96);
    expect(cfg.haze.enabled).toBe(true);
  });

  it("loads defaults with null input", () => {
    const cfg = loadLongViewMaterialsConfig(undefined);
    expect(cfg.material_quality.default).toBe("horizon_proxy");
  });

  it("overrides material quality from query", () => {
    const cfg = loadLongViewMaterialsConfig("", {
      terrainMaterial: "atlas_only_debug",
    });
    expect(cfg.material_quality.default).toBe("atlas_only_debug");
  });

  it("rejects invalid material quality and uses default", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = loadLongViewMaterialsConfig(`
long_view_materials:
  material_quality:
    default: bogus_value
`, {});
    expect(cfg.material_quality.default).toBe("horizon_proxy");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("parses numeric terrain band values", () => {
    const cfg = loadLongViewMaterialsConfig(`
long_view_materials:
  terrain_bands:
    waterline_m: 0.5
    sand_max_height_m: 6.0
    grass_max_slope: 0.45
    rock_min_slope: 0.85
    snow_min_height_m: 120.0
`);
    expect(cfg.terrain_bands.waterline_m).toBeCloseTo(0.5);
    expect(cfg.terrain_bands.sand_max_height_m).toBeCloseTo(6.0);
    expect(cfg.terrain_bands.grass_max_slope).toBeCloseTo(0.45);
    expect(cfg.terrain_bands.rock_min_slope).toBeCloseTo(0.85);
    expect(cfg.terrain_bands.snow_min_height_m).toBeCloseTo(120.0);
  });

  it("clamps out-of-range numeric values", () => {
    const cfg = loadLongViewMaterialsConfig(`
long_view_materials:
  terrain_bands:
    grass_max_slope: 5.0
    rock_min_slope: -1.0
`);
    expect(cfg.terrain_bands.grass_max_slope).toBeCloseTo(1.0);
    expect(cfg.terrain_bands.rock_min_slope).toBeCloseTo(0.0);
  });

  it("parses debug flags from config", () => {
    const cfg = loadLongViewMaterialsConfig(`
long_view_materials:
  debug:
    show_material_bands: true
    show_slope: true
    show_far_normals: true
`);
    expect(cfg.debug.show_material_bands).toBe(true);
    expect(cfg.debug.show_slope).toBe(true);
    expect(cfg.debug.show_far_normals).toBe(true);
    expect(cfg.debug.show_macro_noise).toBe(false);
  });

  it("overrides debug flags from query", () => {
    const cfg = loadLongViewMaterialsConfig("", {
      debugMaterialBands: true,
      debugSlope: true,
      debugFarNormals: true,
      debugHaze: true,
      freezeMaterialLod: true,
    });
    expect(cfg.debug.show_material_bands).toBe(true);
    expect(cfg.debug.show_slope).toBe(true);
    expect(cfg.debug.show_far_normals).toBe(true);
    expect(cfg.debug.show_haze_factor).toBe(true);
    expect(cfg.debug.freeze_material_lod).toBe(true);
  });

  it("parses haze color array", () => {
    const cfg = loadLongViewMaterialsConfig(`
long_view_materials:
  haze:
    color: [0.5, 0.6, 0.7]
`);
    expect(cfg.haze.color[0]).toBeCloseTo(0.5);
    expect(cfg.haze.color[1]).toBeCloseTo(0.6);
    expect(cfg.haze.color[2]).toBeCloseTo(0.7);
  });

  it("clamps haze color values", () => {
    const cfg = loadLongViewMaterialsConfig(`
long_view_materials:
  haze:
    color: [2.0, -0.5, 1.5]
`);
    expect(cfg.haze.color[0]).toBeCloseTo(1.0);
    expect(cfg.haze.color[1]).toBeCloseTo(0.0);
    expect(cfg.haze.color[2]).toBeCloseTo(1.0);
  });

  it("parses macro variation config", () => {
    const cfg = loadLongViewMaterialsConfig(`
long_view_materials:
  macro_variation:
    enabled: false
    world_scale_1: 250.0
    strength: 0.25
`);
    expect(cfg.macro_variation.enabled).toBe(false);
    expect(cfg.macro_variation.world_scale_1).toBeCloseTo(250.0);
    expect(cfg.macro_variation.strength).toBeCloseTo(0.25);
    expect(cfg.macro_variation.world_scale_2).toBeCloseTo(720.0);
  });
});

describe("parseQueryOverrides", () => {
  it("parses terrainMaterial param", () => {
    const sp = new URLSearchParams("terrainMaterial=atlas_only_debug");
    const ov = parseQueryOverrides(sp);
    expect(ov.terrainMaterial).toBe("atlas_only_debug");
  });

  it("parses debug flags", () => {
    const sp = new URLSearchParams(
      "debugMaterialBands=1&debugSlope=1&debugFarNormals=1&debugHaze=1&freezeMaterialLod=1&debugMacroNoise=1"
    );
    const ov = parseQueryOverrides(sp);
    expect(ov.debugMaterialBands).toBe(true);
    expect(ov.debugSlope).toBe(true);
    expect(ov.debugFarNormals).toBe(true);
    expect(ov.debugHaze).toBe(true);
    expect(ov.freezeMaterialLod).toBe(true);
    expect(ov.debugMacroNoise).toBe(true);
  });

  it("returns empty overrides for no params", () => {
    const sp = new URLSearchParams("");
    const ov = parseQueryOverrides(sp);
    expect(ov.terrainMaterial).toBeUndefined();
    expect(ov.debugMaterialBands).toBeUndefined();
  });
});
