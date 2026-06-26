import { load } from "js-yaml";
import type { GrassSettings } from "./grass_config.js";

export interface GrassTerrainDensityWeights {
  density: number;
}

export interface GrassHeightDensityWeights {
  lowHeightM: number;
  highHeightM: number;
  heightBlendM: number;
  low: GrassTerrainDensityWeights;
  mid: GrassTerrainDensityWeights;
  high: GrassTerrainDensityWeights;
}

export interface GrassMaterialBiasSettings {
  grass: GrassTerrainDensityWeights;
  rock: GrassTerrainDensityWeights;
  sand: GrassTerrainDensityWeights;
  snow: GrassTerrainDensityWeights;
  height: GrassHeightDensityWeights;
}

interface GrassMaterialYaml {
  grass?: {
    terrain?: {
      grass?: Partial<GrassTerrainDensityWeights>;
      rock?: Partial<GrassTerrainDensityWeights>;
      sand?: Partial<GrassTerrainDensityWeights>;
      snow?: Partial<GrassTerrainDensityWeights>;
      height?: Partial<GrassHeightDensityWeights> & {
        low?: Partial<GrassTerrainDensityWeights>;
        mid?: Partial<GrassTerrainDensityWeights>;
        high?: Partial<GrassTerrainDensityWeights>;
        low_height_m?: number;
        high_height_m?: number;
        height_blend_m?: number;
      };
    };
  };
}

type GrassSettingsWithMaterialBias = GrassSettings & { materialBias?: GrassMaterialBiasSettings };

export const DEFAULT_GRASS_MATERIAL_BIAS: GrassMaterialBiasSettings = {
  grass: { density: 1.12 },
  rock: { density: 0.18 },
  sand: { density: 0.58 },
  snow: { density: 0.02 },
  height: {
    lowHeightM: 14,
    highHeightM: 34,
    heightBlendM: 8,
    low: { density: 1.04 },
    mid: { density: 1.0 },
    high: { density: 0.58 },
  },
};

export function applyGrassMaterialBiasFromYaml(settings: GrassSettings, text: string): GrassSettings {
  const target = settings as GrassSettingsWithMaterialBias;
  target.materialBias = parseGrassMaterialBias(text);
  return target;
}

export function getGrassMaterialBias(settings: GrassSettings): GrassMaterialBiasSettings {
  return (settings as GrassSettingsWithMaterialBias).materialBias ?? DEFAULT_GRASS_MATERIAL_BIAS;
}

export function grassTerrainDensity(
  settings: GrassSettings,
  weights: readonly [number, number, number, number],
  height: number,
): number {
  const bias = getGrassMaterialBias(settings);
  const material = blendMaterialDensity(weights, bias);
  const heightBias = blendHeightDensity(height, bias.height);
  return material * heightBias;
}

export function grassMaterialDensityVector(settings: GrassSettings): [number, number, number, number] {
  const bias = getGrassMaterialBias(settings);
  return [bias.grass.density, bias.rock.density, bias.sand.density, bias.snow.density];
}

export function grassHeightDensityVector(settings: GrassSettings): [number, number, number, number, number, number] {
  const height = getGrassMaterialBias(settings).height;
  return [height.lowHeightM, height.highHeightM, height.heightBlendM, height.low.density, height.mid.density, height.high.density];
}

function parseGrassMaterialBias(text: string): GrassMaterialBiasSettings {
  const fallback = cloneGrassMaterialBias(DEFAULT_GRASS_MATERIAL_BIAS);
  const raw = (load(text) ?? {}) as GrassMaterialYaml;
  const terrain = raw.grass?.terrain ?? {};
  return {
    grass: readDensity(fallback.grass, terrain.grass),
    rock: readDensity(fallback.rock, terrain.rock),
    sand: readDensity(fallback.sand, terrain.sand),
    snow: readDensity(fallback.snow, terrain.snow),
    height: {
      lowHeightM: readNumber(terrain.height?.low_height_m, fallback.height.lowHeightM),
      highHeightM: readNumber(terrain.height?.high_height_m, fallback.height.highHeightM),
      heightBlendM: readAtLeast(terrain.height?.height_blend_m, fallback.height.heightBlendM, 0.001),
      low: readDensity(fallback.height.low, terrain.height?.low),
      mid: readDensity(fallback.height.mid, terrain.height?.mid),
      high: readDensity(fallback.height.high, terrain.height?.high),
    },
  };
}

function blendMaterialDensity(weights: readonly [number, number, number, number], bias: GrassMaterialBiasSettings): number {
  const sum = Math.max(0.00001, weights[0] + weights[1] + weights[2] + weights[3]);
  return (
    weights[0] * bias.grass.density +
    weights[1] * bias.rock.density +
    weights[2] * bias.sand.density +
    weights[3] * bias.snow.density
  ) / sum;
}

function blendHeightDensity(height: number, settings: GrassHeightDensityWeights): number {
  const blend = Math.max(0.001, settings.heightBlendM);
  const low = 1 - smoothstep(settings.lowHeightM - blend, settings.lowHeightM + blend, height);
  const high = smoothstep(settings.highHeightM - blend, settings.highHeightM + blend, height);
  const mid = Math.max(0, 1 - low - high);
  const sum = Math.max(0.00001, low + mid + high);
  return (settings.low.density * low + settings.mid.density * mid + settings.high.density * high) / sum;
}

function readDensity(base: GrassTerrainDensityWeights, raw: Partial<GrassTerrainDensityWeights> | undefined): GrassTerrainDensityWeights {
  return { density: readAtLeast(raw?.density, base.density, 0) };
}

function cloneGrassMaterialBias(source: GrassMaterialBiasSettings): GrassMaterialBiasSettings {
  return {
    grass: { ...source.grass },
    rock: { ...source.rock },
    sand: { ...source.sand },
    snow: { ...source.snow },
    height: {
      ...source.height,
      low: { ...source.height.low },
      mid: { ...source.height.mid },
      high: { ...source.height.high },
    },
  };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
