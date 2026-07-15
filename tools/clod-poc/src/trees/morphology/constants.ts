import type { TreeSpeciesId } from "../tree_config_types.js";
import type { TreeInstanceMorphology, TreeMorphologyRuntimeSettings } from "./types.js";

export const MORPH_CHANNEL = {
  AGE: 0x1101,
  LEAN: 0x1102,
  CROWN_BIAS: 0x1103,
  WIDTH: 0x1104,
  FLAT: 0x1105,
  DROOP: 0x1106,
  HEALTH: 0x1107,
  FLARE: 0x1108,
  FOLIAGE_CARD: 0x1109,
} as const;

export const MORPHOLOGY_RANGES: Record<keyof TreeInstanceMorphology, readonly [number, number]> = {
  age01: [0, 1],
  leanX: [-0.22, 0.22],
  leanZ: [-0.22, 0.22],
  crownBiasX: [-0.35, 0.35],
  crownBiasZ: [-0.35, 0.35],
  crownWidth: [0.82, 1.18],
  crownFlattening: [0.82, 1.2],
  branchDroop: [-0.18, 0.32],
  foliageDensity: [0.55, 1.15],
  health01: [0, 1],
  rootFlare: [0.75, 1.35],
  stiffness: [0.65, 1.35],
};

export const TREE_MORPHOLOGY_RUNTIME_DEFAULTS: Record<TreeSpeciesId, TreeMorphologyRuntimeSettings> = {
  oak: { slopeLean: 0.08, windLean: 0.04, randomLean: 0.05, exposureFlattening: 0.05, ageFlattening: 0.08, baseDroop: 0.03, ageDroop: 0.12, moistureDroop: 0.05, baseStiffness: 0.90 },
  pine: { slopeLean: 0.06, windLean: 0.05, randomLean: 0.03, exposureFlattening: 0.10, ageFlattening: 0.02, baseDroop: -0.02, ageDroop: 0.06, moistureDroop: 0.02, baseStiffness: 1.15 },
  birch: { slopeLean: 0.10, windLean: 0.07, randomLean: 0.05, exposureFlattening: 0.07, ageFlattening: 0.04, baseDroop: 0.04, ageDroop: 0.10, moistureDroop: 0.06, baseStiffness: 0.82 },
  willow: { slopeLean: 0.08, windLean: 0.04, randomLean: 0.04, exposureFlattening: 0.04, ageFlattening: 0.10, baseDroop: 0.12, ageDroop: 0.16, moistureDroop: 0.10, baseStiffness: 0.72 },
  spruce: { slopeLean: 0.05, windLean: 0.04, randomLean: 0.025, exposureFlattening: 0.09, ageFlattening: 0.02, baseDroop: 0.00, ageDroop: 0.05, moistureDroop: 0.02, baseStiffness: 1.22 },
  dead: { slopeLean: 0.12, windLean: 0.08, randomLean: 0.08, exposureFlattening: 0.00, ageFlattening: 0.00, baseDroop: 0.08, ageDroop: 0.14, moistureDroop: 0.00, baseStiffness: 0.78 },
};

export const TREE_IMPOSTOR_AGE_BUCKETS = [0.20, 0.60, 0.92] as const;
export const TREE_IMPOSTOR_STRUCTURAL_VARIANTS = 4;
export const TREE_IMPOSTOR_LAYERS_PER_SPECIES = 12;
