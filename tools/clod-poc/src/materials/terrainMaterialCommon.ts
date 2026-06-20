import { sampleNoiseChannel, type NoiseBakeResult } from "../textures/noiseBake.js";
import {
  DEFAULT_PROCEDURAL_TEXTURE_CONFIG,
  type ProceduralMaterialId,
  type ProceduralTextureConfig,
} from "../textures/materialRecipes.js";

export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];

export interface DrusnielTerrainMaterialInput {
  worldPos: Vec3;
  normalWs: Vec3;
  materialWeights: Vec4;
  pageLod: number;
  cameraDistance: number;
  noise: NoiseBakeResult;
  config?: ProceduralTextureConfig;
  lodBias?: number;
}

export interface DrusnielTerrainMaterialSample {
  albedo: Vec3;
  roughness: number;
  ao: number;
  materialId: number;
  debugValue: number;
  normalStrength: number;
  microFade: number;
}

const BEVY_TERRAIN_SLOT_IDS: readonly ProceduralMaterialId[] = ["grass", "rock", "sand", "dirt"];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 0.0001));
  return t * t * (3 - 2 * t);
}

function normalizeWeights(weights: Vec4): Vec4 {
  const sum = weights[0] + weights[1] + weights[2] + weights[3];
  if (sum <= 0.000001) return [1, 0, 0, 0];
  return [weights[0] / sum, weights[1] / sum, weights[2] / sum, weights[3] / sum];
}

function dominantMaterialId(weights: Vec4): number {
  let best = 0;
  for (let i = 1; i < 4; i++) {
    if (weights[i] > weights[best]) best = i;
  }
  return best;
}

function weightedRecipeValue(
  weights: Vec4,
  selector: (id: ProceduralMaterialId) => number,
): number {
  return BEVY_TERRAIN_SLOT_IDS.reduce((sum, id, index) => sum + selector(id) * weights[index], 0);
}

function mixColor(a: Vec3, b: Vec3, t: number): Vec3 {
  const k = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

export function sampleDrusnielTerrainMaterial(input: DrusnielTerrainMaterialInput): DrusnielTerrainMaterialSample {
  const config = input.config ?? DEFAULT_PROCEDURAL_TEXTURE_CONFIG;
  const masks = config.terrain.masks;
  const weights = normalizeWeights(input.materialWeights);
  const xzU = input.worldPos[0] / Math.max(config.terrain.macro_variation_m[1], 0.001);
  const xzV = input.worldPos[2] / Math.max(config.terrain.macro_variation_m[1], 0.001);
  const macro = sampleNoiseChannel(input.noise.dataA, input.noise.resolution, xzU, xzV, 1);
  const meso = sampleNoiseChannel(
    input.noise.dataA,
    input.noise.resolution,
    input.worldPos[0] / Math.max(config.terrain.meso_variation_m[1], 0.001),
    input.worldPos[2] / Math.max(config.terrain.meso_variation_m[1], 0.001),
    0,
  );
  const ridged = sampleNoiseChannel(
    input.noise.dataB,
    input.noise.resolution,
    input.worldPos[0] / Math.max(config.terrain.meso_variation_m[1] * 8, 0.001),
    input.worldPos[2] / Math.max(config.terrain.meso_variation_m[1] * 8, 0.001),
    2,
  );

  const baseColor = BEVY_TERRAIN_SLOT_IDS.reduce<[number, number, number]>((sum, id, index) => {
    const recipe = config.terrain.materials[id];
    sum[0] += recipe.base_color[0] * weights[index];
    sum[1] += recipe.base_color[1] * weights[index];
    sum[2] += recipe.base_color[2] * weights[index];
    return sum;
  }, [0, 0, 0]);
  const macroStrength = weightedRecipeValue(weights, (id) => config.terrain.materials[id].macro_strength);
  const recipeRoughness = weightedRecipeValue(weights, (id) => config.terrain.materials[id].roughness);
  const recipeNormal = weightedRecipeValue(weights, (id) => config.terrain.materials[id].normal_strength);
  const upness = clamp01(input.normalWs[1] * 0.5 + 0.5);
  const slope = clamp01(1 - upness);
  const slopeDamp = smoothstep(masks.slope_damp[0], masks.slope_damp[1], upness);
  const variation = 1 + (macro - 0.5) * macroStrength + (meso - 0.5) * masks.meso_albedo_strength;
  const cameraLodDistance = input.cameraDistance + input.pageLod * masks.page_lod_normal_fade_m + Math.max(input.lodBias ?? 0, 0);
  const micro = config.terrain.micro_normal.enabled
    ? 1 - smoothstep(config.terrain.micro_normal.fade_start_m, config.terrain.micro_normal.fade_end_m, cameraLodDistance)
    : 0;
  const normalStrength = recipeNormal * config.terrain.micro_normal.max_strength * micro * (0.5 + ridged * 0.5) * slopeDamp;
  const materialId = dominantMaterialId(weights);
  const snowMask = smoothstep(masks.snow_height[0], masks.snow_height[1], input.worldPos[1])
    * smoothstep(masks.snow_upness[0], masks.snow_upness[1], upness);
  const mossMask = weights[0] * smoothstep(masks.moss_upness[0], masks.moss_upness[1], upness);
  const gravelMask = weights[1] * smoothstep(masks.gravel_slope[0], masks.gravel_slope[1], slope);
  const wetMask = weights[2]
    * (1 - smoothstep(masks.wet_height[0], masks.wet_height[1], input.worldPos[1]))
    * smoothstep(masks.wet_upness[0], masks.wet_upness[1], upness);
  let albedo: Vec3 = [
    clamp01(baseColor[0] * variation),
    clamp01(baseColor[1] * variation),
    clamp01(baseColor[2] * variation),
  ];
  albedo = mixColor(albedo, masks.snow_tint, snowMask * masks.snow_tint_strength);
  albedo = mixColor(albedo, masks.moss_tint, mossMask * masks.moss_tint_strength);
  albedo = mixColor(albedo, masks.gravel_tint, gravelMask * masks.gravel_tint_strength);
  albedo = mixColor(albedo, masks.wet_tint, wetMask * masks.wet_tint_strength);
  let roughness = recipeRoughness;
  roughness = roughness + (masks.wet_roughness - roughness) * wetMask * masks.wet_roughness_strength;

  return {
    albedo,
    roughness: clamp01(roughness),
    ao: 1,
    materialId,
    debugValue: materialId / 3,
    normalStrength: clamp01(normalStrength),
    microFade: clamp01(micro),
  };
}
