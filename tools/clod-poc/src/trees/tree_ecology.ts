import type { TreeSettings, TreeSpeciesId } from "./tree_config.js";
import { clamp, clamp01, fractalNoise2D, hash2, remap, smoothstep, valueNoise2D } from "./tree_noise.js";

export interface TreeEcologySample {
  forestDensity: number;
  clearingMask: number;
  clusterMask: number;
  terrainSuitability: number;
  moisture: number;
  age: "young" | "mature" | "old";
  scaleMultiplier: number;
}

export function sampleTreeEcology(
  x: number,
  z: number,
  height: number,
  normalY: number,
  groundWeight: number,
  settings: TreeSettings,
): TreeEcologySample {
  const ecology = settings.ecology;
  const density = ecology.density;
  const terrain = ecology.terrain;
  const clustering = ecology.clustering;
  const seed = settings.seed;
  const forestNoise = fractalNoise2D(x, z, density.forestNoiseScaleM, seed + 11003, 3);
  const forestDensity = clamp01(0.5 + (forestNoise - 0.5) * density.forestNoiseStrength);
  const clearingNoise = valueNoise2D(x, z, density.clearingNoiseScaleM, seed + 12007);
  const clearingOpen = smoothstep(
    density.clearingThreshold - density.clearingSoftness,
    density.clearingThreshold + density.clearingSoftness,
    clearingNoise,
  );
  const edgeNoise = valueNoise2D(x + density.edgeSoftnessM, z - density.edgeSoftnessM, density.clearingNoiseScaleM * 0.55, seed + 12037);
  const clearingMask = clamp01(1 - clearingOpen * remap(edgeNoise, 0, 1, 0.72, 1));
  const clusterNoise = fractalNoise2D(x, z, clustering.clusterScaleM, seed + 13001, 2);
  const clusterMask = smoothstep(clustering.clusterThreshold, 1, clusterNoise);
  const lowerHeight = smoothstep(terrain.lowlandHeightM - terrain.heightFadeM, terrain.lowlandHeightM, height);
  const upperHeight = 1 - smoothstep(terrain.highlandHeightM, terrain.highlandHeightM + terrain.heightFadeM, height);
  const slope = smoothstep(terrain.slopeFadeStartY, terrain.slopeFadeEndY, normalY);
  const material = Math.pow(clamp01(groundWeight), terrain.materialWeightPower);
  const terrainSuitability = clamp01(lowerHeight * upperHeight * slope * material);
  const moisture = fractalNoise2D(x + 913.7, z - 271.4, density.forestNoiseScaleM * 1.35, seed + 14009, 3);
  const ageRoll = hash2(Math.floor(x * 8), Math.floor(z * 8), seed + 15013);
  const age = ageRoll < ecology.age.youngProbability
    ? "young"
    : ageRoll > 1 - ecology.age.oldProbability
      ? "old"
      : "mature";
  const baseScale = age === "young" ? ecology.age.scaleYoung : age === "old" ? ecology.age.scaleOld : ecology.age.scaleMature;
  const scaleNoise = hash2(Math.floor(x * 16), Math.floor(z * 16), seed + 15031) * 2 - 1;
  const scaleMultiplier = Math.max(0.05, baseScale * (1 + scaleNoise * ecology.age.scaleVariation));
  return {
    forestDensity,
    clearingMask,
    clusterMask,
    terrainSuitability,
    moisture,
    age,
    scaleMultiplier,
  };
}

export function ecologyAcceptanceProbability(sample: TreeEcologySample, settings: TreeSettings): number {
  if (!settings.ecology.enabled) return 1;
  const clusteredDensity = clamp(0.12 + sample.clusterMask * 1.35, 0, 1.25);
  const cluster = 1 - settings.ecology.clustering.clusterStrength + clusteredDensity * settings.ecology.clustering.clusterStrength;
  return clamp01(settings.ecology.density.baseDensity * sample.forestDensity * sample.clearingMask * cluster * sample.terrainSuitability);
}

export function speciesEcologyWeight(
  species: TreeSpeciesId,
  sample: TreeEcologySample,
  height: number,
  normalY: number,
  settings: TreeSettings,
): number {
  const speciesSettings = settings.species[species];
  if (!speciesSettings.enabled || speciesSettings.weight <= 0) return 0;
  if (height < speciesSettings.minHeightM || height > speciesSettings.maxHeightM) return 0;

  const ecology = settings.ecology;
  if (!ecology.enabled) return speciesSettings.weight;
  const zone = ecology.speciesZones[species];
  const heightT = smoothstep(ecology.terrain.lowlandHeightM, ecology.terrain.highlandHeightM, height);
  const heightWeight = zone.heightPreference === "low"
    ? 1 - heightT * 0.72
    : zone.heightPreference === "high"
      ? 0.38 + heightT * 0.92
      : 1;
  const moistureWeight = 1 - Math.abs(sample.moisture - zone.moisturePreference) * 0.85;
  const slopeSteepness = 1 - clamp01(normalY);
  const slopeWeight = clamp(zone.slopeTolerance / Math.max(0.001, slopeSteepness + 0.18), 0.15, 1.25);
  const clusterWeight = 1 + sample.clusterMask * zone.clusterBias * 0.45;
  const oldForestWeight = species === "dead" && sample.age === "old"
    ? 1 + zone.oldForestBias * sample.forestDensity * 1.4
    : 1;
  return Math.max(0, speciesSettings.weight * heightWeight * moistureWeight * slopeWeight * clusterWeight * oldForestWeight);
}

export function treeEcologyDebugSample(
  x: number,
  z: number,
  height: number,
  normalY: number,
  groundWeight: number,
  settings: TreeSettings,
): TreeEcologySample {
  return sampleTreeEcology(x, z, height, normalY, groundWeight, settings);
}
