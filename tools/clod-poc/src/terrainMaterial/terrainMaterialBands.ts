import { sampleActiveErosionMaterialChannels } from "../world/erosion/integration.js";
import type { MaterialId, MaterialWeights, TerrainMaterialInput, TerrainMaterialSample } from "./terrainMaterialTypes.js";
import { deterministicNoise2 } from "./macroTerrain.js";

const EPSILON = 1e-8;
const MATERIAL_BASE_COLORS: Record<MaterialId, [number, number, number]> = {
  sand: [0.58, 0.52, 0.38],
  grass: [0.25, 0.33, 0.18],
  dirt: [0.35, 0.28, 0.20],
  rock: [0.42, 0.40, 0.37],
  snow: [0.82, 0.84, 0.92],
};

const MATERIAL_ROUGHNESS: Record<MaterialId, number> = {
  sand: 0.92,
  grass: 0.88,
  dirt: 0.90,
  rock: 0.78,
  snow: 0.65,
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  const range = edge1 - edge0;
  const denominator = Math.abs(range) < EPSILON ? EPSILON : range;
  const t = Math.min(1, Math.max(0, (value - edge0) / denominator));
  return t * t * (3 - 2 * t);
}

function normalizeWeights(weights: MaterialWeights): MaterialWeights {
  const sum = weights.sand + weights.grass + weights.dirt + weights.rock + weights.snow;
  if (sum <= EPSILON) return { sand: 1, grass: 0, dirt: 0, rock: 0, snow: 0 };
  return {
    sand: weights.sand / sum,
    grass: weights.grass / sum,
    dirt: weights.dirt / sum,
    rock: weights.rock / sum,
    snow: weights.snow / sum,
  };
}

function dominantMaterial(weights: MaterialWeights): MaterialId {
  const entries: [MaterialId, number][] = [
    ["sand", weights.sand],
    ["grass", weights.grass],
    ["dirt", weights.dirt],
    ["rock", weights.rock],
    ["snow", weights.snow],
  ];
  let best: MaterialId = "grass";
  let bestWeight = -1;
  for (const [id, weight] of entries) {
    if (weight > bestWeight) {
      best = id;
      bestWeight = weight;
    }
  }
  return best;
}

function blendColor(
  weights: MaterialWeights,
  colors: Record<MaterialId, [number, number, number]>,
): [number, number, number] {
  const color: [number, number, number] = [0, 0, 0];
  const entries: [MaterialId, number][] = [
    ["sand", weights.sand],
    ["grass", weights.grass],
    ["dirt", weights.dirt],
    ["rock", weights.rock],
    ["snow", weights.snow],
  ];
  for (const [id, weight] of entries) {
    if (weight <= 0) continue;
    const materialColor = colors[id];
    color[0] += materialColor[0] * weight;
    color[1] += materialColor[1] * weight;
    color[2] += materialColor[2] * weight;
  }
  return color;
}

function blendRoughness(weights: MaterialWeights): number {
  const entries: [MaterialId, number][] = [
    ["sand", weights.sand],
    ["grass", weights.grass],
    ["dirt", weights.dirt],
    ["rock", weights.rock],
    ["snow", weights.snow],
  ];
  let roughness = 0;
  for (const [id, weight] of entries) if (weight > 0) roughness += MATERIAL_ROUGHNESS[id] * weight;
  return Math.min(1, Math.max(0, roughness));
}

function applyErosionMaterialBias(input: TerrainMaterialInput, weights: MaterialWeights): MaterialWeights {
  const channels = sampleActiveErosionMaterialChannels(input.worldX, input.worldZ);
  if (!channels) return weights;
  const deposited = Math.min(1, Math.max(0, channels.netDepositionM / 0.5));
  const eroded = Math.min(1, Math.max(0, -channels.netDepositionM / 0.35));
  const sediment = Math.min(1, channels.sedimentDepthM / 0.35);
  const hardRock = smoothstep(0.55, 0.9, channels.hardness01);
  const softGround = 1 - smoothstep(0.25, 0.6, channels.hardness01);
  const nearWater = Math.max(0, 1 - Math.abs(input.height - input.waterLevel) / 12);
  return {
    sand: Math.max(0, weights.sand + deposited * nearWater * 0.8 + sediment * nearWater * 0.35),
    grass: Math.max(0, weights.grass * (1 - eroded * 0.75) + channels.wetnessSeed * softGround * 0.18),
    dirt: Math.max(0, weights.dirt + deposited * 0.7 + sediment * 0.45),
    rock: Math.max(0, weights.rock + hardRock * 0.75 + eroded * 1.1),
    snow: weights.snow,
  };
}

export function classifyTerrainMaterial(input: TerrainMaterialInput): TerrainMaterialSample {
  const { height, slope, waterLevel, config } = input;
  const heightRelativeToWater = height - waterLevel;
  let rawSand = 0;
  let rawGrass = 0;
  let rawDirt = 0;
  let rawRock = 0;
  let rawSnow = 0;
  if (heightRelativeToWater > 0) {
    rawSand = 1 - smoothstep(0, config.sand_max_height_m, heightRelativeToWater);
    rawSand *= 1 - smoothstep(0, 0.35, slope);
    rawGrass = smoothstep(config.grass_max_slope + 0.15, config.grass_max_slope - 0.05, slope);
    rawGrass *= 1 - rawSand;
    rawRock = smoothstep(config.rock_min_slope - 0.1, config.rock_min_slope + 0.2, slope);
    const heightFactor = smoothstep(config.snow_min_height_m - 20, config.snow_min_height_m + 40, height);
    const slopeFactor = smoothstep(config.snow_min_slope - 0.05, config.snow_min_slope + 0.1, slope);
    rawSnow = heightFactor * slopeFactor;
    rawRock *= 1 - rawSnow * 0.6;
    rawGrass *= 1 - rawSnow;
    rawGrass *= smoothstep(config.snow_min_height_m + 50, config.snow_min_height_m - 20, height);
    rawDirt = Math.max(0, 1 - rawSand - rawGrass - rawRock - rawSnow);
    rawDirt *= 1 - smoothstep(config.dirt_max_slope + 0.1, config.dirt_max_slope - 0.1, slope) * 0.6;
  } else {
    rawSand = 1;
  }
  const normalized = normalizeWeights(applyErosionMaterialBias(input, {
    sand: rawSand,
    grass: rawGrass,
    dirt: rawDirt,
    rock: rawRock,
    snow: rawSnow,
  }));
  const materialId = dominantMaterial(normalized);
  const baseColor = blendColor(normalized, MATERIAL_BASE_COLORS);
  const roughness = blendRoughness(normalized);
  const macro = config.macro_variation.enabled
    ? computeMacroVariation(input.worldX, input.worldZ, slope, height, config.macro_variation)
    : 0;
  const finalColor: [number, number, number] = [
    clampColor(baseColor[0] * (1 + (macro - 0.5) * config.macro_variation.strength)),
    clampColor(baseColor[1] * (1 + (macro - 0.5) * config.macro_variation.strength)),
    clampColor(baseColor[2] * (1 + (macro - 0.5) * config.macro_variation.strength)),
  ];
  return {
    materialId,
    weights: normalized,
    baseColor: finalColor,
    roughness,
    macroVariation: macro,
    debugMaterialId: ["sand", "grass", "dirt", "rock", "snow"].indexOf(materialId),
    debugWeights: [normalized.sand, normalized.grass, normalized.dirt, normalized.rock, normalized.snow],
    valid: true,
  };
}

function computeMacroVariation(
  x: number,
  z: number,
  slope: number,
  height: number,
  config: TerrainMaterialInput["config"]["macro_variation"],
): number {
  const noise1 = deterministicNoise2(x / config.world_scale_1, z / config.world_scale_1);
  const noise2 = deterministicNoise2(x / config.world_scale_2, z / config.world_scale_2);
  let value = noise1 * 0.65 + noise2 * 0.35;
  value += (slope - 0.5) * config.slope_strength;
  value += (height / 200) * config.height_strength;
  return Math.min(1, Math.max(0, value));
}

function clampColor(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function materialColorForDebugId(id: number): [number, number, number] {
  const colors: Record<number, [number, number, number]> = {
    0: [0.76, 0.70, 0.50],
    1: [0.30, 0.48, 0.24],
    2: [0.42, 0.34, 0.24],
    3: [0.50, 0.47, 0.42],
    4: [0.85, 0.88, 0.95],
  };
  return colors[id % 5] ?? [0.5, 0.5, 0.5];
}
