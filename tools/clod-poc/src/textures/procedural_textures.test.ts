import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildTerrainFragmentShader } from "../terrain_shader.js";
import {
  bakeNoiseTextures,
  periodicFbm2,
  periodicRidged2,
  periodicValueNoise2,
  periodicWorleyF1,
} from "./noiseBake.js";
import {
  DEFAULT_PROCEDURAL_TEXTURE_CONFIG,
  parseProceduralTextureConfig,
  type ProceduralTextureConfig,
} from "./materialRecipes.js";
import { createProceduralTerrainTextures } from "./terrainTextureArrays.js";
import { createProceduralTextureManifest, stableHash } from "./textureManifest.js";

function tinyConfig(seed = 1337): ProceduralTextureConfig {
  const defaults = DEFAULT_PROCEDURAL_TEXTURE_CONFIG;
  return {
    ...defaults,
    seed,
    noise: {
      ...defaults.noise,
      resolution: 16,
      periods: { value: 8, fbm: 6, ridged: 5, worley: 7 },
    },
    terrain: {
      ...defaults.terrain,
      layer_resolution: 8,
      micro_normal: { ...defaults.terrain.micro_normal },
      material_order: ["grass", "rock", "sand", "dirt"],
      materials: { ...defaults.terrain.materials },
    },
    debug: { ...defaults.debug },
  };
}

describe("procedural terrain textures", () => {
  it("bakes identical packed noise bytes for the same seed and config", () => {
    const config = tinyConfig();
    const first = bakeNoiseTextures({
      seed: config.seed,
      resolution: config.noise.resolution,
      periods: config.noise.periods,
    });
    const second = bakeNoiseTextures({
      seed: config.seed,
      resolution: config.noise.resolution,
      periods: config.noise.periods,
    });

    expect([...second.dataA]).toEqual([...first.dataA]);
    expect([...second.dataB]).toEqual([...first.dataB]);
  });

  it("uses periodic noise for baked scalar and gradient fields", () => {
    const seed = 42;
    const period = 8;
    const x = 3.375;
    const y = 5.125;

    expect(periodicValueNoise2(x + period, y, period, seed)).toBeCloseTo(periodicValueNoise2(x, y, period, seed), 8);
    expect(periodicFbm2(x, y + period, period, seed)).toBeCloseTo(periodicFbm2(x, y, period, seed), 8);
    expect(periodicRidged2(x + period, y + period, period, seed)).toBeCloseTo(periodicRidged2(x, y, period, seed), 8);
    expect(periodicWorleyF1(x + period, y, period, seed)).toBeCloseTo(periodicWorleyF1(x, y, period, seed), 8);
  });

  it("sets baked noise textures to repeat rather than mirrored repeat", () => {
    const config = tinyConfig();
    const bake = bakeNoiseTextures({
      seed: config.seed,
      resolution: config.noise.resolution,
      periods: config.noise.periods,
    });

    expect(bake.noiseA.wrapS).toBe(THREE.RepeatWrapping);
    expect(bake.noiseA.wrapT).toBe(THREE.RepeatWrapping);
    expect(bake.noiseB.wrapS).toBe(THREE.RepeatWrapping);
    expect(bake.noiseB.wrapT).toBe(THREE.RepeatWrapping);
  });

  it("changes manifest hash when seed, config, or schema input changes", () => {
    const config = tinyConfig();
    const base = createProceduralTextureManifest({
      seed: config.seed,
      config,
      noiseResolution: config.noise.resolution,
      layerResolution: config.terrain.layer_resolution,
      materialOrder: config.terrain.material_order,
    });
    const differentSeed = createProceduralTextureManifest({
      seed: config.seed + 1,
      config: { ...config, seed: config.seed + 1 },
      noiseResolution: config.noise.resolution,
      layerResolution: config.terrain.layer_resolution,
      materialOrder: config.terrain.material_order,
    });

    expect(differentSeed.configHash).not.toBe(base.configHash);
    expect(stableHash({ schemaVersion: 1, config })).not.toBe(stableHash({ schemaVersion: 2, config }));
    expect(stableHash({ config })).not.toBe(stableHash({ config: { ...config, noise: { ...config.noise, resolution: 32 } } }));
    expect(base.shaderHash).toHaveLength(16);
    expect(base.outputs.noiseA).toBe("noise_a.png");
    expect(base.outputs.terrainAlbedo).toContain("grass_albedo.png");

    const changedRuntimeOnly = createProceduralTextureManifest({
      seed: config.seed,
      config: { ...config, enabled: !config.enabled, runtime_mode: "cache_only" },
      noiseResolution: config.noise.resolution,
      layerResolution: config.terrain.layer_resolution,
      materialOrder: config.terrain.material_order,
    });
    expect(changedRuntimeOnly.configHash).toBe(base.configHash);
  });

  it("generates deterministic terrain array dimensions and metadata", () => {
    const config = tinyConfig();
    const first = createProceduralTerrainTextures(config);
    const second = createProceduralTerrainTextures(config);

    expect(first.albedoArray.image.width).toBe(8);
    expect(first.albedoArray.image.height).toBe(8);
    expect(first.albedoArray.image.depth).toBe(4);
    expect(first.normalArray.image.depth).toBe(4);
    expect(first.slots.map((slot) => slot.selectedId)).toEqual([
      "generated:grass",
      "generated:rock",
      "generated:sand",
      "generated:dirt",
    ]);
    expect(first.manifest.configHash).toBe(second.manifest.configHash);
    expect([...first.noise.dataA]).toEqual([...second.noise.dataA]);
  });

  it("parses yaml overrides without dropping generated material recipes", () => {
    const config = parseProceduralTextureConfig(`
procedural_textures:
  seed: 17
  noise:
    resolution: 32
  terrain:
    layer_resolution: 16
    material_order: [rock, grass]
    materials:
      grass:
        base_color: [0.1, 0.4, 0.2]
`);

    expect(config.seed).toBe(17);
    expect(config.noise.resolution).toBe(32);
    expect(config.terrain.layer_resolution).toBe(16);
    expect(config.terrain.material_order).toEqual(["rock", "grass"]);
    expect(config.terrain.materials.grass.base_color).toEqual([0.1, 0.4, 0.2]);
    expect(config.terrain.materials.wet_soil.base_color).toEqual(DEFAULT_PROCEDURAL_TEXTURE_CONFIG.terrain.materials.wet_soil.base_color);
    expect(config.terrain_material_quality.debug_flat.max_noise_fetches).toBe(0);
    expect(config.terrain_material_quality.procedural_full.max_noise_fetches).toBe(10);
  });

  it("binds procedural terrain uniforms and keeps world-position sampling in the terrain shader", () => {
    const shader = buildTerrainFragmentShader();

    expect(shader).toContain("uniform bool uUseProceduralTerrain");
    expect(shader).toContain("uniform sampler2D uProceduralNoiseA");
    expect(shader).toContain("uniform sampler2D uProceduralNoiseB");
    expect(shader).toContain("uniform int uProceduralDebugMode");
    expect(shader).toContain("proceduralMacroTint(tex, vWorldPos");
    expect(shader).toContain("sampleTextureSlot(int(vPaintSlots");
    expect(shader).not.toContain("vUv");
  });
});
