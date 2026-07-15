import type { TreeSpeciesSettings, TreeSpeciesZoneSettings } from "./tree_config.js";
import { clamp01, smoothstep } from "./tree_noise.js";
import { TREE_MORPHOLOGY_RUNTIME_DEFAULTS } from "./morphology/constants.js";

export const TREE_EXPANDED_SPECIES = ["oak", "pine", "dead", "birch", "willow", "spruce"] as const;
export type TreeExpandedSpeciesId = typeof TREE_EXPANDED_SPECIES[number];
export type TreeHeightPreference = TreeSpeciesZoneSettings["heightPreference"];

export interface TreeExpandedSpeciesNiche {
  heightPreference: TreeHeightPreference;
  moisturePreference: number;
  slopeTolerance: number;
  clusterBias: number;
  oldForestBias: number;
  materialBias: readonly [grass: number, rock: number, sand: number, snow: number];
}

export interface TreeExpandedSpeciesSample {
  heightM: number;
  normalY: number;
  moisture: number;
  clusterMask: number;
  age: "young" | "mature" | "old";
  forestDensity: number;
  materialWeights: readonly [grass: number, rock: number, sand: number, snow: number];
  lowlandHeightM: number;
  highlandHeightM: number;
}

export const TREE_EXPANDED_SPECIES_NICHES: Record<TreeExpandedSpeciesId, TreeExpandedSpeciesNiche> = {
  oak: {
    heightPreference: "low",
    moisturePreference: 0.65,
    slopeTolerance: 0.55,
    clusterBias: 0.75,
    oldForestBias: 0,
    materialBias: [1.22, 0.35, 0.72, 0.04],
  },
  pine: {
    heightPreference: "high",
    moisturePreference: 0.35,
    slopeTolerance: 0.85,
    clusterBias: 0.9,
    oldForestBias: 0,
    materialBias: [0.86, 0.96, 0.45, 0.30],
  },
  dead: {
    heightPreference: "any",
    moisturePreference: 0.45,
    slopeTolerance: 0.75,
    clusterBias: 1.0,
    oldForestBias: 0.85,
    materialBias: [0.52, 1.55, 0.68, 1.45],
  },
  birch: {
    heightPreference: "low",
    moisturePreference: 0.58,
    slopeTolerance: 0.72,
    clusterBias: 0.45,
    oldForestBias: 0.12,
    materialBias: [1.12, 0.42, 0.82, 0.18],
  },
  willow: {
    heightPreference: "low",
    moisturePreference: 0.86,
    slopeTolerance: 0.45,
    clusterBias: 0.65,
    oldForestBias: 0.08,
    materialBias: [1.04, 0.22, 1.16, 0.02],
  },
  spruce: {
    heightPreference: "high",
    moisturePreference: 0.42,
    slopeTolerance: 0.9,
    clusterBias: 1.05,
    oldForestBias: 0.18,
    materialBias: [0.72, 1.12, 0.28, 0.86],
  },
};

export const TREE_EXPANDED_SPECIES_DEFAULTS: Record<TreeExpandedSpeciesId, TreeSpeciesSettings> = {
  oak: species(0.34, 10, 42, 8.0, 0.36, 4.2, 0.18, 0.62, 3, 8, 3, 0.85, 0.42, 2.4, 0.72, 0.28, 18, 44, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.oak),
  pine: species(0.22, 14, 58, 9.5, 0.30, 3.1, 0.08, 0.42, 3, 9, 1, 0.58, -0.08, 2.0, 1.45, 0.16, 12, 36, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.pine),
  dead: species(0.07, 14, 58, 8.0, 0.27, 0.0, 0.26, 0.58, 2, 5, 1, 0.9, 0.18, 1.9, 1.0, 0.45, 0, 0, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.dead),
  birch: species(0.16, 11, 46, 7.2, 0.26, 3.2, 0.12, 0.58, 3, 7, 2, 0.72, 0.32, 2.0, 0.8, 0.22, 14, 34, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.birch),
  willow: species(0.11, 9, 36, 5.5, 0.34, 4.6, 0.24, 0.64, 3, 8, 3, 1.1, -0.08, 2.8, 0.62, 0.34, 22, 50, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.willow),
  spruce: species(0.10, 16, 60, 10.0, 0.32, 3.4, 0.05, 0.38, 5, 10, 1, 0.62, -0.12, 2.2, 1.55, 0.14, 14, 38, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.spruce),
};

export function treeExpandedSpeciesNicheWeight(
  speciesId: TreeExpandedSpeciesId,
  sample: TreeExpandedSpeciesSample,
): number {
  const niche = TREE_EXPANDED_SPECIES_NICHES[speciesId];
  const heightT = smoothstep(sample.lowlandHeightM, sample.highlandHeightM, sample.heightM);
  const heightWeight = niche.heightPreference === "low"
    ? 1 - heightT * 0.72
    : niche.heightPreference === "high"
      ? 0.38 + heightT * 0.92
      : 1;
  const moistureWeight = 1 - Math.abs(sample.moisture - niche.moisturePreference) * 0.85;
  const slopeSteepness = 1 - clamp01(sample.normalY);
  const slopeWeight = Math.max(0.15, Math.min(1.25, niche.slopeTolerance / Math.max(0.001, slopeSteepness + 0.18)));
  const clusterWeight = 1 + sample.clusterMask * niche.clusterBias * 0.45;
  const oldForestWeight = sample.age === "old" ? 1 + niche.oldForestBias * sample.forestDensity * 1.4 : 1;
  const materialBias = blendedMaterialBias(niche.materialBias, sample.materialWeights);
  return Math.max(0, heightWeight * moistureWeight * slopeWeight * clusterWeight * oldForestWeight * materialBias);
}

function blendedMaterialBias(
  bias: readonly [number, number, number, number],
  weights: readonly [number, number, number, number],
): number {
  const sum = Math.max(0.00001, weights[0] + weights[1] + weights[2] + weights[3]);
  return (bias[0] * weights[0] + bias[1] * weights[1] + bias[2] * weights[2] + bias[3] * weights[3]) / sum;
}

function species(
  weight: number,
  minHeightM: number,
  maxHeightM: number,
  trunkHeightM: number,
  trunkRadiusM: number,
  crownRadiusM: number,
  trunkBend: number,
  trunkTaper: number,
  branchLevels: number,
  primaryBranchCount: number,
  secondaryBranchCount: number,
  branchSpread: number,
  branchUpSweep: number,
  branchLength: number,
  crownFlattening: number,
  crownIrregularity: number,
  leafClusterCount: number,
  leafCardCount: number,
  morphologyRuntime: TreeSpeciesSettings["morphologyRuntime"],
): TreeSpeciesSettings {
  return {
    enabled: true,
    weight,
    minHeightM,
    maxHeightM,
    trunkHeightM,
    trunkRadiusM,
    crownRadiusM,
    morphology: {
      trunkBend,
      trunkTaper,
      branchLevels,
      primaryBranchCount,
      secondaryBranchCount,
      branchSpread,
      branchUpSweep,
      branchLength,
      crownFlattening,
      crownIrregularity,
      leafClusterCount,
      leafCardCount,
    },
    morphologyRuntime: { ...morphologyRuntime },
  };
}
