import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildTerrainFragmentShader } from "../terrain_shader.js";
import { MATERIAL_DEBUG_VIEW_IDS, materialDebugViewIndex } from "../debug/materialDebugViews.js";
import { samplePageTerrainMaterial } from "../materials/pageTerrainMaterial.js";
import { sampleDrusnielTerrainMaterial } from "../materials/terrainMaterialCommon.js";
import { bakeNoiseTextures } from "./noiseBake.js";
import {
  periodicFbm2,
  periodicRidged2,
  periodicValueNoise2,
  periodicWorleyF1,
  periodicWorleyF1Edge,
} from "./periodicNoise.js";
import {
  DEFAULT_PROCEDURAL_TEXTURE_CONFIG,
  parseProceduralTextureConfig,
  type ProceduralTextureConfig,
} from "./materialRecipes.js";
import {
  manifestOutputFiles,
  proceduralCacheStatus,
  shouldGenerateProceduralOutputs,
} from "./proceduralCache.js";
import { createProceduralTerrainTextures } from "./terrainTextureArrays.js";
import { deriveSeedStreams, stableSeedStream } from "./seedStreams.js";
import { createProceduralTextureManifest, stableHash } from "./textureManifest.js";
import { BARK_TABLE, bakeBarkTextures } from "./barkSynth.js";
import { bakeTerrainClassificationTexture } from "./terrainClassificationBake.js";

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
    expect(periodicWorleyF1Edge(x + 9, y, 9, 5, seed).f1).toBeCloseTo(periodicWorleyF1Edge(x, y, 9, 5, seed).f1, 8);
    expect(periodicWorleyF1Edge(x, y + 5, 9, 5, seed).edge).toBeCloseTo(periodicWorleyF1Edge(x, y, 9, 5, seed).edge, 8);
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

  it("derives deterministic independent seed streams from the root seed", () => {
    const streams = deriveSeedStreams(1337);
    expect(streams).toEqual(deriveSeedStreams(1337));
    expect(streams.noise_value).toBe(stableSeedStream(1337, "noise_value"));
    expect(new Set(Object.values(streams)).size).toBe(Object.keys(streams).length);
    expect(deriveSeedStreams(1338).noise_value).not.toBe(streams.noise_value);
    expect(streams.noise_value).not.toBe(streams.noise_fbm);
  });

  it("samples the same material for live chunks and CLOD pages at the same world position", () => {
    const config = tinyConfig();
    const noise = bakeNoiseTextures({
      seed: config.seed,
      resolution: config.noise.resolution,
      periods: config.noise.periods,
    });
    const classification = bakeTerrainClassificationTexture({ config, noise });
    const commonInput = {
      worldPos: [37.25, 22.5, -14.75] as const,
      normalWs: [0.12, 0.96, -0.08] as const,
      materialWeights: [0.66, 0.18, 0.04, 0.12] as const,
      pageLod: 0,
      cameraDistance: 24,
      noise,
      classification,
      config,
    };

    const live = sampleDrusnielTerrainMaterial(commonInput);
    const page = samplePageTerrainMaterial({ ...commonInput, pageId: "page:0:0:0" });

    expect(page).toEqual(live);
  });

  it("keeps albedo stable through page LOD changes while fading normal detail", () => {
    const config = tinyConfig();
    const noise = bakeNoiseTextures({
      seed: config.seed,
      resolution: config.noise.resolution,
      periods: config.noise.periods,
    });
    const base = {
      worldPos: [-11.5, 41, 63.125] as const,
      normalWs: [0.34, 0.74, 0.58] as const,
      materialWeights: [0.12, 0.74, 0.02, 0.12] as const,
      cameraDistance: 42,
      noise,
      config,
    };

    const lod0 = samplePageTerrainMaterial({ ...base, pageId: "page:lod0", pageLod: 0 });
    const lod3 = samplePageTerrainMaterial({ ...base, pageId: "page:lod3", pageLod: 3 });

    expect(lod3.albedo).toEqual(lod0.albedo);
    expect(lod3.roughness).toBe(lod0.roughness);
    expect(lod3.materialId).toBe(lod0.materialId);
    expect(lod3.normalStrength).toBeLessThanOrEqual(lod0.normalStrength);
  });

  it("declares the CLOD material debug views used by the shader UI", () => {
    expect(MATERIAL_DEBUG_VIEW_IDS).toEqual([
      "final",
      "macro_noise",
      "material_weights",
      "material_id",
      "normal_strength",
      "roughness",
      "page_lod",
      "seam_stress",
    ]);
    expect(materialDebugViewIndex("seam_stress")).toBe(7);
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
    expect(base.outputs.classificationA).toBe("classification_a.png");
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

  it("classifies procedural cache state from manifest and generated output list", () => {
    const config = tinyConfig();
    const manifest = createProceduralTextureManifest({
      seed: config.seed,
      config,
      noiseResolution: config.noise.resolution,
      layerResolution: config.terrain.layer_resolution,
      materialOrder: config.terrain.material_order,
    });
    const allFiles = new Set(manifestOutputFiles(manifest));
    const missingFiles = new Set(manifestOutputFiles(manifest).slice(1));
    const stale = { ...manifest, configHash: "different" };

    expect(proceduralCacheStatus(manifest, { manifest, files: allFiles })).toBe("match");
    expect(proceduralCacheStatus(manifest, { manifest, files: missingFiles })).toBe("missing");
    expect(proceduralCacheStatus(manifest, { manifest: stale, files: allFiles })).toBe("stale");
    expect(shouldGenerateProceduralOutputs({ runtime_mode: "cache_only" }, "missing")).toBe(false);
    expect(shouldGenerateProceduralOutputs({ runtime_mode: "generate_if_missing" }, "missing")).toBe(true);
    expect(shouldGenerateProceduralOutputs({ runtime_mode: "force_regenerate" }, "match")).toBe(true);
  });

  it("bakes deterministic terrain classification support maps", () => {
    const config = tinyConfig();
    const noise = bakeNoiseTextures({
      seed: config.seed,
      resolution: config.noise.resolution,
      periods: config.noise.periods,
    });
    const first = bakeTerrainClassificationTexture({ config, noise, resolution: 8 });
    const second = bakeTerrainClassificationTexture({ config, noise, resolution: 8 });

    expect(first.resolution).toBe(8);
    expect(first.dataA.length).toBe(8 * 8 * 4);
    expect([...first.dataA]).toEqual([...second.dataA]);
    expect(first.classificationA.wrapS).toBe(THREE.RepeatWrapping);
    expect(first.classificationA.wrapT).toBe(THREE.RepeatWrapping);
    for (const value of first.dataA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });

  it("generates deterministic terrain array dimensions and metadata", () => {
    const config = tinyConfig();
    const first = createProceduralTerrainTextures(config);
    const second = createProceduralTerrainTextures(config);

    expect(first.albedoArray.image.width).toBe(8);
    expect(first.albedoArray.image.height).toBe(8);
    expect(first.albedoArray.image.depth).toBe(4);
    expect(first.normalArray.image.depth).toBe(4);
    expect(first.classification.resolution).toBe(config.noise.resolution);
    expect(first.manifest.outputs.classificationA).toBe("classification_a.png");
    expect(first.slots.map((slot) => slot.selectedId)).toEqual([
      "generated:grass",
      "generated:rock",
      "generated:sand",
      "generated:dirt",
    ]);
    expect(first.manifest.configHash).toBe(second.manifest.configHash);
    expect([...first.noise.dataA]).toEqual([...second.noise.dataA]);
  });

  it("ports the reference BarkSynth species table for generated bark texture bakes", () => {
    expect(BARK_TABLE.map((species) => species.id)).toEqual([
      "spruce",
      "pine",
      "beech",
      "birch",
      "karst_gnarl",
      "snag",
    ]);
  });

  it("bakes deterministic periodic BarkSynth texture data", () => {
    const first = bakeBarkTextures({ layer: 1, seed: 77, resolution: 16 });
    const second = bakeBarkTextures({ layer: 1, seed: 77, resolution: 16 });
    const differentSeed = bakeBarkTextures({ layer: 1, seed: 78, resolution: 16 });
    const differentLayer = bakeBarkTextures({ layer: 2, seed: 77, resolution: 16 });

    expect(first.species.id).toBe("pine");
    expect(first.resolution).toBe(16);
    expect(first.dataA.length).toBe(16 * 16 * 4);
    expect(first.dataB.length).toBe(16 * 16 * 4);
    expect([...first.dataA]).toEqual([...second.dataA]);
    expect([...first.dataB]).toEqual([...second.dataB]);
    expect([...differentSeed.dataA]).not.toEqual([...first.dataA]);
    expect([...differentLayer.dataA]).not.toEqual([...first.dataA]);
  });

  it("sets BarkSynth textures to repeatable mipmapped float textures", () => {
    const bake = bakeBarkTextures({ layer: 0, seed: 91, resolution: 8 });

    for (const texture of [bake.texA, bake.texB]) {
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(texture.wrapT).toBe(THREE.RepeatWrapping);
      expect(texture.type).toBe(THREE.FloatType);
      expect(texture.format).toBe(THREE.RGBAFormat);
      expect(texture.generateMipmaps).toBe(true);
      expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(texture.magFilter).toBe(THREE.LinearFilter);
      expect(texture.anisotropy).toBe(4);
    }

    for (const value of [...bake.dataA, ...bake.dataB]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("parses yaml overrides without dropping generated material recipes", () => {
    const config = parseProceduralTextureConfig(`
procedural_textures:
  seed: 17
  noise:
    resolution: 32
  terrain:
    layer_resolution: 16
    masks:
      slope_damp: [0.2, 0.8]
      meso_albedo_strength: 0.11
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
    expect(config.terrain.masks.slope_damp).toEqual([0.2, 0.8]);
    expect(config.terrain.masks.meso_albedo_strength).toBe(0.11);
    expect(config.terrain_material_quality.debug_flat.max_noise_fetches).toBe(0);
    expect(config.terrain_material_quality.procedural_full.max_noise_fetches).toBe(10);
  });

  it("binds procedural terrain uniforms and keeps world-position sampling in the terrain shader", () => {
    const shader = buildTerrainFragmentShader();

    expect(shader).toContain("uniform bool uUseProceduralTerrain");
    expect(shader).toContain("uniform sampler2D uProceduralNoiseA");
    expect(shader).toContain("uniform sampler2D uProceduralNoiseB");
    expect(shader).toContain("uniform int uProceduralDebugMode");
    expect(shader).toContain("uniform vec4 uProceduralSnowMask");
    expect(shader).toContain("uniform vec4 uProceduralMaterialRoughness");
    const tintIndex = shader.indexOf("tex = proceduralMacroTint(tex, vWorldPos");
    const paintIndex = shader.indexOf("tex = mix(tex, blendPaintedAlbedo(vWorldPos), paint)");
    expect(tintIndex).toBeGreaterThan(-1);
    expect(paintIndex).toBeGreaterThan(tintIndex);
    expect(shader).toContain("blendPaintedNormal(vWorldPos, geomN)");
    expect(shader).toContain("samplePaintTextureSlot(int(vPaintSlots");
    expect(shader).toContain("vec3 samplePaintTextureSlot(int slot, vec3 worldPos)");
    expect(shader).toContain("worldPos.xz * uTextureScales[slot], float(slot)");
    expect(shader).toContain("sampleNormalSlot(int(vPaintSlots");
    expect(shader).not.toContain("vUv");
  });
});
