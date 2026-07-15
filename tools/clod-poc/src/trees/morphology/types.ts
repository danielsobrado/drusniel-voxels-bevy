import type { TreeSpeciesId, TreeSpeciesMorphologyRuntimeSettings } from "../tree_config_types.js";

export interface TreeIdentity {
  stableIdLo: number;
  stableIdHi: number;
}

export interface TreeTerrainSample {
  slope01: number;
  downhillDirectionXZ: [number, number];
  exposure01: number;
  exposedRootPotential: number;
}

export interface TreeEcologySample {
  oldForestBias: number;
  moisture: number;
  moistureSuitability: number;
  temperatureSuitability: number;
  stress: number;
}

export interface TreeCompetitionSample {
  crownPressure: number;
  directionalPressure: number;
  openLightDirectionXZ: [number, number];
}

export interface TreeInstanceMorphology {
  age01: number;
  leanX: number;
  leanZ: number;
  crownBiasX: number;
  crownBiasZ: number;
  crownWidth: number;
  crownFlattening: number;
  branchDroop: number;
  foliageDensity: number;
  health01: number;
  rootFlare: number;
  stiffness: number;
}

export interface TreeVertexMorphologyAttributes {
  treeHeight01: number;
  treeRadial01: number;
  treeBranchLevel: number;
  treeBranchPhase: number;
  treeRootMask: number;
  treeFoliageMask: number;
  treeFoliageCard: number;
}

export type TreeMorphologyRuntimeSettings = TreeSpeciesMorphologyRuntimeSettings;

export interface TreeCompetitionInput {
  worldSeed: number;
  positionXZ: [number, number];
  species: TreeSpeciesId;
}
