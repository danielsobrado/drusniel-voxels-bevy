import { describe, expect, it } from "vitest";
import yamlText from "../../config/border_coast_ocean.yaml?raw";
import { parseBorderCoastOceanConfig } from "./borderCoastOceanConfig.js";
import { parseBorderCoastOceanConfig as parseRuntimeBorderCoastOceanConfig } from "../terrain/border_coast_config.js";
import { parseBorderOceanGameplayConfig } from "../player/border_ocean_player_config.js";

function hexToRgb(hex: string): [number, number, number] {
  const raw = Number.parseInt(hex.slice(1), 16);
  return [((raw >> 16) & 255) / 255, ((raw >> 8) & 255) / 255, (raw & 255) / 255];
}

describe("border coast/ocean config", () => {
  it("parses the checked-in config", () => {
    const config = parseBorderCoastOceanConfig(yamlText);

    expect(config.world.bounds).toEqual({
      min_x: -2048,
      max_x: 2048,
      min_z: -2048,
      max_z: 2048,
    });
    expect(config.coast.type_weights).toEqual({
      sandy_beach: 0.38,
      rocky_beach: 0.2,
      cliff: 0.27,
      cove: 0.1,
      reef: 0.05,
    });
    expect(config.deep_ocean.start_outside_border_m).toBe(64);
    expect(config.deep_ocean.wave).toMatchObject({
      gravity: 9.81,
      grid_k: 16,
      active_gpu_waves: 48,
      wind_speed: 14,
      wind_direction_deg: 45,
      height_scale: 1.3,
      choppiness: 1.6,
      coarse_patch_m: 250,
      fine_patch_m: 37,
      foam_threshold: 0.5,
      foam_power: 1.36,
      foam_intensity: 1.25,
      swell_height_scale: 0.34,
    });
    expect(config.deep_ocean.shading.deep_color).toBe("#042c4e");
    expect(config.gameplay).toEqual({
      soft_pushback_enabled: true,
      world_edge_margin_m: 16,
      pushback_start_inside_world_m: 48,
      pushback_strength: 36,
    });
  });

  it("keeps strict config validation aligned with the runtime border ocean parser", () => {
    const strict = parseBorderCoastOceanConfig(yamlText);
    const runtime = parseRuntimeBorderCoastOceanConfig(yamlText);

    expect(runtime.deepOcean.enabled).toBe(strict.deep_ocean.enabled);
    expect(runtime.deepOcean.startOutsideBorderM).toBe(strict.deep_ocean.start_outside_border_m);
    expect(runtime.deepOcean.surfaceY).toBe(strict.world.water_level);
    expect(runtime.deepOcean.extendCells).toBe(strict.deep_ocean.visual_extent_m);
    expect(runtime.deepOcean.segments).toBe(strict.deep_ocean.far_subdivisions);
    expect(runtime.deepOcean.wave).toMatchObject({
      gravity: strict.deep_ocean.wave.gravity,
      gridK: strict.deep_ocean.wave.grid_k,
      activeGpuWaves: strict.deep_ocean.wave.active_gpu_waves,
      windSpeed: strict.deep_ocean.wave.wind_speed,
      windDirectionDeg: strict.deep_ocean.wave.wind_direction_deg,
      heightScale: strict.deep_ocean.wave.height_scale,
      choppiness: strict.deep_ocean.wave.choppiness,
      coarsePatchM: strict.deep_ocean.wave.coarse_patch_m,
      finePatchM: strict.deep_ocean.wave.fine_patch_m,
      foamThreshold: strict.deep_ocean.wave.foam_threshold,
      foamPower: strict.deep_ocean.wave.foam_power,
      foamIntensity: strict.deep_ocean.wave.foam_intensity,
      swellHeightScale: strict.deep_ocean.wave.swell_height_scale,
    });
    expect(runtime.deepOcean.shading.deepColor).toEqual(hexToRgb(strict.deep_ocean.shading.deep_color));
    expect(runtime.deepOcean.shading.shallowColor).toEqual(hexToRgb(strict.deep_ocean.shading.shallow_color));
    expect(runtime.deepOcean.shading.foamColor).toEqual(hexToRgb(strict.deep_ocean.shading.foam_color));
  });

  it("keeps strict gameplay config aligned with player config resolver", () => {
    const strict = parseBorderCoastOceanConfig(yamlText);
    const gameplay = parseBorderOceanGameplayConfig(yamlText);

    expect(gameplay.softPushbackEnabled).toBe(strict.gameplay.soft_pushback_enabled);
    expect(gameplay.worldEdgeMarginM).toBe(strict.gameplay.world_edge_margin_m);
    expect(gameplay.pushbackStartInsideWorldM).toBe(strict.gameplay.pushback_start_inside_world_m);
    expect(gameplay.pushbackStrength).toBe(strict.gameplay.pushback_strength);
  });

  it("normalizes coast type weights", () => {
    const config = parseBorderCoastOceanConfig(
      yamlText.replace(
        /sandy_beach: 0\.38[\s\S]*?reef: 0\.05/,
        [
          "sandy_beach: 2",
          "rocky_beach: 1",
          "cliff: 1",
          "cove: 0",
          "reef: 0",
        ].join("\n    "),
      ),
    );

    expect(config.coast.type_weights).toEqual({
      sandy_beach: 0.5,
      rocky_beach: 0.25,
      cliff: 0.25,
      cove: 0,
      reef: 0,
    });
  });

  it("clamps probabilities to zero through one", () => {
    const config = parseBorderCoastOceanConfig(
      yamlText
        .replace("tide_pool_probability: 0.08", "tide_pool_probability: -2")
        .replace("ledge_probability: 0.18", "ledge_probability: 3")
        .replace("cave_mouth_probability: 0.03", "cave_mouth_probability: -1")
        .replace("sea_stack_probability: 0.04", "sea_stack_probability: 2"),
    );

    expect(config.coast.beach.tide_pool_probability).toBe(0);
    expect(config.coast.cliff.ledge_probability).toBe(1);
    expect(config.coast.cliff.cave_mouth_probability).toBe(0);
    expect(config.coast.rocky.sea_stack_probability).toBe(1);
  });

  it("fails clearly when a required section is missing", () => {
    const missingSurf = yamlText.replace(/surf:\r?\n[\s\S]*?\r?\ndeep_ocean:/, "deep_ocean:");

    expect(() => parseBorderCoastOceanConfig(missingSurf)).toThrow(
      "missing required section 'surf'",
    );
  });

  it("fails clearly for malformed fields", () => {
    expect(() =>
      parseBorderCoastOceanConfig(
        yamlText.replace("near_subdivisions: 128", "near_subdivisions: many"),
      ),
    ).toThrow("deep_ocean.near_subdivisions must be a finite number");
  });

  it("fails clearly for malformed gameplay fields", () => {
    expect(() =>
      parseBorderCoastOceanConfig(
        yamlText.replace("soft_pushback_enabled: true", "soft_pushback_enabled: 1"),
      ),
    ).toThrow("gameplay.soft_pushback_enabled must be boolean");
  });

  it("fails clearly when hard clamp margin is disabled", () => {
    expect(() =>
      parseBorderCoastOceanConfig(
        yamlText.replace("world_edge_margin_m: 16", "world_edge_margin_m: 0"),
      ),
    ).toThrow("gameplay.world_edge_margin_m must be greater than 0");
  });

  it("fails clearly when enabled soft pushback has no band", () => {
    expect(() =>
      parseBorderCoastOceanConfig(
        yamlText.replace("pushback_start_inside_world_m: 48", "pushback_start_inside_world_m: 0"),
      ),
    ).toThrow("gameplay.pushback_start_inside_world_m must be greater than 0");
  });

  it("fails clearly when enabled soft pushback has no acceleration", () => {
    expect(() =>
      parseBorderCoastOceanConfig(
        yamlText.replace("pushback_strength: 36", "pushback_strength: 0"),
      ),
    ).toThrow("gameplay.pushback_strength must be greater than 0");
  });

  it("allows zero pushback values when soft pushback is disabled", () => {
    const config = parseBorderCoastOceanConfig(
      yamlText
        .replace("soft_pushback_enabled: true", "soft_pushback_enabled: false")
        .replace("pushback_start_inside_world_m: 48", "pushback_start_inside_world_m: 0")
        .replace("pushback_strength: 36", "pushback_strength: 0"),
    );

    expect(config.gameplay).toMatchObject({
      soft_pushback_enabled: false,
      world_edge_margin_m: 16,
      pushback_start_inside_world_m: 0,
      pushback_strength: 0,
    });
  });

  it("fails clearly for missing gameplay fields", () => {
    expect(() =>
      parseBorderCoastOceanConfig(
        yamlText.replace(/\n  world_edge_margin_m: 16/, ""),
      ),
    ).toThrow("missing required field 'gameplay.world_edge_margin_m'");
  });

  it("fails clearly for missing wave constants", () => {
    expect(() =>
      parseBorderCoastOceanConfig(
        yamlText.replace(/\n    gravity: 9\.81/, ""),
      ),
    ).toThrow("missing required field 'deep_ocean.wave.gravity'");
  });

  it("fails clearly for malformed YAML", () => {
    expect(() => parseBorderCoastOceanConfig("world: [")).toThrow("malformed YAML");
  });
});
