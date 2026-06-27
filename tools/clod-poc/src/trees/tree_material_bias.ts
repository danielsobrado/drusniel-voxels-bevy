import { load } from "js-yaml";
import type { TreeSettings, TreeSpeciesId } from "./tree_config.js";

export interface TreeTerrainClassWeights {
  density: number;
  oak: number;
  pine: number;
  dead: number;
}

export interface TreeMaterialBiasSettings {
  grass: TreeTerrainClassWeights;
  rock: TreeTerrainClassWeights;
  sand: TreeTerrainClassWeights;
  snow: TreeTerrainClassWeights;
}

interface TreeMaterialYaml {
  trees?: {
    ecology?: {
      material_bias?: Partial<Record<"grass" | "rock" | "sand" | "snow", Partial<TreeTerrainClassWeights>>>;
    };
  };
}

type WarnHandler = (message: string) => void;
type TreeSettingsWithMaterialBias = TreeSettings & {
  ecology: TreeSettings["ecology"] & { materialBias?: TreeMaterialBiasSettings };
};

export const DEFAULT_TREE_MATERIAL_BIAS: TreeMaterialBiasSettings = {
  grass: { density: 1.08, oak: 1.22, pine: 0.86, dead: 0.52 },
  rock: { density: 0.46, oak: 0.35, pine: 0.96, dead: 1.55 },
  sand: { density: 0.55, oak: 0.72, pine: 0.45, dead: 0.68 },
  snow: { density: 0.08, oak: 0.04, pine: 0.30, dead: 1.45 },
};

export function applyTreeMaterialBiasFromYaml(
  settings: TreeSettings,
  text: string,
  warn: WarnHandler | null = console.warn,
): TreeSettings {
  const target = settings as TreeSettingsWithMaterialBias;
  try {
    target.ecology = {
      ...target.ecology,
      materialBias: parseTreeMaterialBias(text),
    };
  } catch (error) {
    warn?.(`[tree-material-bias] failed to parse material bias; using defaults: ${error instanceof Error ? error.message : String(error)}`);
    target.ecology = {
      ...target.ecology,
      materialBias: DEFAULT_TREE_MATERIAL_BIAS,
    };
  }
  return target;
}

export function getTreeMaterialBias(settings: TreeSettings): TreeMaterialBiasSettings {
  return (settings as TreeSettingsWithMaterialBias).ecology.materialBias ?? DEFAULT_TREE_MATERIAL_BIAS;
}

export function treeMaterialDensity(settings: TreeSettings, weights: readonly [number, number, number, number]): number {
  const bias = getTreeMaterialBias(settings);
  return blendTreeMaterialBias(weights, bias, "density");
}

export function treeSpeciesMaterialBias(
  settings: TreeSettings,
  species: TreeSpeciesId,
  weights: readonly [number, number, number, number],
): number {
  const bias = getTreeMaterialBias(settings);
  return blendTreeMaterialBias(weights, bias, species);
}

export function treeMaterialDensityVector(settings: TreeSettings): [number, number, number, number] {
  const bias = getTreeMaterialBias(settings);
  return [bias.grass.density, bias.rock.density, bias.sand.density, bias.snow.density];
}

export function treeSpeciesMaterialVector(settings: TreeSettings, species: TreeSpeciesId): [number, number, number, number] {
  const bias = getTreeMaterialBias(settings);
  return [bias.grass[species], bias.rock[species], bias.sand[species], bias.snow[species]];
}

function parseTreeMaterialBias(text: string): TreeMaterialBiasSettings {
  const fallback = cloneTreeMaterialBias(DEFAULT_TREE_MATERIAL_BIAS);
  const raw = (load(text) ?? {}) as TreeMaterialYaml;
  const material = raw.trees?.ecology?.material_bias ?? {};
  return {
    grass: readClass(fallback.grass, material.grass),
    rock: readClass(fallback.rock, material.rock),
    sand: readClass(fallback.sand, material.sand),
    snow: readClass(fallback.snow, material.snow),
  };
}

function readClass(base: TreeTerrainClassWeights, raw: Partial<TreeTerrainClassWeights> | undefined): TreeTerrainClassWeights {
  return {
    density: readNonNegative(raw?.density, base.density),
    oak: readNonNegative(raw?.oak, base.oak),
    pine: readNonNegative(raw?.pine, base.pine),
    dead: readNonNegative(raw?.dead, base.dead),
  };
}

function blendTreeMaterialBias(
  weights: readonly [number, number, number, number],
  bias: TreeMaterialBiasSettings,
  key: keyof TreeTerrainClassWeights,
): number {
  const sum = Math.max(0.00001, weights[0] + weights[1] + weights[2] + weights[3]);
  return (
    weights[0] * bias.grass[key] +
    weights[1] * bias.rock[key] +
    weights[2] * bias.sand[key] +
    weights[3] * bias.snow[key]
  ) / sum;
}

function cloneTreeMaterialBias(source: TreeMaterialBiasSettings): TreeMaterialBiasSettings {
  return {
    grass: { ...source.grass },
    rock: { ...source.rock },
    sand: { ...source.sand },
    snow: { ...source.snow },
  };
}

function readNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}
