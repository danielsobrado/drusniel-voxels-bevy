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

function smoothstep(edge0: number, edge1: number, v: number): number {
  const range = edge1 - edge0;
  const denom = Math.abs(range) < EPSILON ? EPSILON : range;
  const t = Math.min(1, Math.max(0, (v - edge0) / denom));
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
  let bestW = -1;
  for (const [id, w] of entries) {
    if (w > bestW) { best = id; bestW = w; }
  }
  return best;
}

function blendColor(
  weights: MaterialWeights,
  colors: Record<MaterialId, [number, number, number]>,
): [number, number, number] {
  const c: [number, number, number] = [0, 0, 0];
  const entries: [MaterialId, number][] = [
    ["sand", weights.sand],
    ["grass", weights.grass],
    ["dirt", weights.dirt],
    ["rock", weights.rock],
    ["snow", weights.snow],
  ];
  for (const [id, w] of entries) {
    if (w <= 0) continue;
    const col = colors[id];
    c[0] += col[0] * w;
    c[1] += col[1] * w;
    c[2] += col[2] * w;
  }
  return c;
}

function blendRoughness(weights: MaterialWeights): number {
  const entries: [MaterialId, number][] = [
    ["sand", weights.sand],
    ["grass", weights.grass],
    ["dirt", weights.dirt],
    ["rock", weights.rock],
    ["snow", weights.snow],
  ];
  let r = 0;
  for (const [id, w] of entries) {
    if (w > 0) r += MATERIAL_ROUGHNESS[id] * w;
  }
  return Math.min(1, Math.max(0, r));
}

export function classifyTerrainMaterial(input: TerrainMaterialInput): TerrainMaterialSample {
  const { height, slope, waterLevel, config } = input;
  const hRel = height - waterLevel;

  let rawSand = 0;
  let rawGrass = 0;
  let rawDirt = 0;
  let rawRock = 0;
  let rawSnow = 0;

  const aboveWater = hRel > 0;

  if (aboveWater) {
    rawSand = 1 - smoothstep(0, config.sand_max_height_m, hRel);
    rawSand *= 1 - smoothstep(0, 0.35, slope);

    rawGrass = smoothstep(config.grass_max_slope + 0.15, config.grass_max_slope - 0.05, slope);
    rawGrass *= 1 - rawSand;

    rawRock = smoothstep(config.rock_min_slope - 0.1, config.rock_min_slope + 0.2, slope);

    const hF = smoothstep(config.snow_min_height_m - 20, config.snow_min_height_m + 40, height);
    const sF = smoothstep(config.snow_min_slope - 0.05, config.snow_min_slope + 0.1, slope);
    rawSnow = hF * sF;
    rawRock *= 1 - rawSnow * 0.6;
    rawGrass *= 1 - rawSnow;
    const altGrass = smoothstep(config.snow_min_height_m + 50, config.snow_min_height_m - 20, height);
    rawGrass *= altGrass;

    rawDirt = 1 - rawSand - rawGrass - rawRock - rawSnow;
    rawDirt = Math.max(0, rawDirt);
    rawDirt *= 1 - smoothstep(config.dirt_max_slope + 0.1, config.dirt_max_slope - 0.1, slope) * 0.6;
  } else {
    rawSand = 1;
  }

  const rawWeights: MaterialWeights = {
    sand: rawSand,
    grass: rawGrass,
    dirt: rawDirt,
    rock: rawRock,
    snow: rawSnow,
  };
  const normalized = normalizeWeights(rawWeights);
  const matId = dominantMaterial(normalized);
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
    materialId: matId,
    weights: normalized,
    baseColor: finalColor,
    roughness,
    macroVariation: macro,
    debugMaterialId: ["sand", "grass", "dirt", "rock", "snow"].indexOf(matId),
    debugWeights: [
      normalized.sand,
      normalized.grass,
      normalized.dirt,
      normalized.rock,
      normalized.snow,
    ],
    valid: true,
  };
}

function computeMacroVariation(
  x: number, z: number, slope: number, height: number,
  cfg: TerrainMaterialInput["config"]["macro_variation"],
): number {
  const n1 = deterministicNoise2(x / cfg.world_scale_1, z / cfg.world_scale_1);
  const n2 = deterministicNoise2(x / cfg.world_scale_2, z / cfg.world_scale_2);
  let v = n1 * 0.65 + n2 * 0.35;
  v += (slope - 0.5) * cfg.slope_strength;
  v += (height / 200) * cfg.height_strength;
  return Math.min(1, Math.max(0, v));
}

function clampColor(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function materialColorForDebugId(id: number): [number, number, number] {
  const DEBUG_BAND_COLORS: Record<number, [number, number, number]> = {
    0: [0.76, 0.70, 0.50],
    1: [0.30, 0.48, 0.24],
    2: [0.42, 0.34, 0.24],
    3: [0.50, 0.47, 0.42],
    4: [0.85, 0.88, 0.95],
  };
  return DEBUG_BAND_COLORS[id % 5] ?? [0.5, 0.5, 0.5];
}
