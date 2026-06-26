import * as THREE from "three";
import { terrainWeights, surfaceHeight, surfaceNormal } from "../terrain/terrain.js";
import type { PageFootprint } from "../types.js";
import { treeHash2, treeRandomSigned } from "./tree_hash.js";
import { selectTreeSpecies } from "./tree_species.js";
import type { TreeSettings, TreeSpeciesId } from "./tree_config.js";
import {
  ecologyAcceptanceProbability,
  sampleTreeEcology,
  speciesEcologyWeight,
  type TreeEcologySample,
} from "./tree_ecology.js";

export interface TreeTerrainSampler {
  surfaceHeight(x: number, z: number): number;
  surfaceNormal(x: number, z: number): [number, number, number];
  materialWeights(height: number, normalY: number): [number, number, number, number];
}

export interface TreeInstance {
  position: [number, number, number];
  species: TreeSpeciesId;
  scale: number;
  rotationY: number;
  normalY: number;
}

export interface TreeGenerationStats {
  generatedCandidates: number;
  acceptedCandidates: number;
  rejectedSlope: number;
  rejectedHeight: number;
  rejectedMaterial: number;
}

export const defaultTreeTerrainSampler: TreeTerrainSampler = {
  surfaceHeight,
  surfaceNormal,
  materialWeights: terrainWeights,
};

export function emptyTreeGenerationStats(): TreeGenerationStats {
  return {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    rejectedSlope: 0,
    rejectedHeight: 0,
    rejectedMaterial: 0,
  };
}

export function generateTreeInstances(
  footprint: PageFootprint,
  settings: TreeSettings,
  maxInstances = settings.maxInstances,
  stats: TreeGenerationStats = emptyTreeGenerationStats(),
  sampler: TreeTerrainSampler = defaultTreeTerrainSampler,
  worldCells = Number.POSITIVE_INFINITY,
): TreeInstance[] {
  const spacing = Math.max(0.5, settings.placement.spacingM);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  const limit = Math.max(0, Math.floor(maxInstances));
  const ranked: { priority: number; instance: TreeInstance; suppressionRadius: number }[] = [];
  const minSpacingSq = settings.placement.minSpacingM * settings.placement.minSpacingM;

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      stats.generatedCandidates++;
      const gridX = Math.floor(footprint.minX / spacing) + column;
      const gridZ = Math.floor(footprint.minZ / spacing) + row;
      const baseX = footprint.minX + (column + 0.5) * spacing;
      const baseZ = footprint.minZ + (row + 0.5) * spacing;
      const x = THREE.MathUtils.clamp(
        baseX + treeRandomSigned(gridX, gridZ, settings.seed + 101) * spacing * settings.placement.jitter,
        footprint.minX + 0.001,
        Math.min(footprint.maxX, worldCells) - 0.001,
      );
      const z = THREE.MathUtils.clamp(
        baseZ + treeRandomSigned(gridX, gridZ, settings.seed + 211) * spacing * settings.placement.jitter,
        footprint.minZ + 0.001,
        Math.min(footprint.maxZ, worldCells) - 0.001,
      );
      if (x < 0 || z < 0 || x > worldCells || z > worldCells) {
        stats.rejectedMaterial++;
        continue;
      }

      const height = sampler.surfaceHeight(x, z);
      const normalY = sampler.surfaceNormal(x, z)[1];
      if (normalY < settings.placement.slopeMinY) {
        stats.rejectedSlope++;
        continue;
      }
      if (height < settings.placement.minHeightM || height > settings.placement.maxHeightM) {
        stats.rejectedHeight++;
        continue;
      }

      const weights = sampler.materialWeights(height, normalY);
      const groundWeight = weights[0] + weights[1] * 0.25;
      const threshold = treeHash2(gridX, gridZ, settings.seed + 307);
      if (groundWeight < settings.placement.minGroundWeight || (!settings.ecology.enabled && threshold > groundWeight)) {
        stats.rejectedMaterial++;
        continue;
      }

      const ecology = settings.ecology.enabled
        ? sampleTreeEcology(x, z, height, normalY, groundWeight, settings)
        : null;
      if (ecology && treeHash2(gridX, gridZ, settings.seed + 809) > ecologyAcceptanceProbability(ecology, settings)) {
        stats.rejectedMaterial++;
        continue;
      }

      const species = ecology
        ? selectEcologySpecies(settings, ecology, height, normalY, treeHash2(gridX, gridZ, settings.seed + 409))
        : selectTreeSpecies(settings, treeHash2(gridX, gridZ, settings.seed + 409));
      if (!species) {
        stats.rejectedMaterial++;
        continue;
      }
      const speciesSettings = settings.species[species];
      if (height < speciesSettings.minHeightM || height > speciesSettings.maxHeightM) {
        stats.rejectedHeight++;
        continue;
      }

      const suppressionRadius = ecology
        ? treeSuppressionRadius(species, ecology, settings, gridX, gridZ)
        : settings.placement.minSpacingM;
      if (minSpacingSq > 0 && ranked.some(({ instance, suppressionRadius: acceptedRadius }) => {
        const dx = instance.position[0] - x;
        const dz = instance.position[2] - z;
        const radius = Math.max(suppressionRadius, acceptedRadius);
        return dx * dx + dz * dz < radius * radius;
      })) {
        stats.rejectedMaterial++;
        continue;
      }

      stats.acceptedCandidates++;
      const baseScale = 0.82 + treeHash2(gridX, gridZ, settings.seed + 601) * 0.42;
      ranked.push({
        priority: treeHash2(gridX, gridZ, settings.seed + 503),
        suppressionRadius,
        instance: {
          position: [x, height, z],
          species,
          scale: baseScale * (ecology?.scaleMultiplier ?? 1),
          rotationY: treeHash2(gridX, gridZ, settings.seed + 701) * Math.PI * 2,
          normalY,
        },
      });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  return ranked.slice(0, limit).map(({ instance }) => instance);
}

function selectEcologySpecies(
  settings: TreeSettings,
  ecology: TreeEcologySample,
  height: number,
  normalY: number,
  roll: number,
): TreeSpeciesId | null {
  const weights: { species: TreeSpeciesId; weight: number }[] = [
    { species: "oak", weight: speciesEcologyWeight("oak", ecology, height, normalY, settings) },
    { species: "pine", weight: speciesEcologyWeight("pine", ecology, height, normalY, settings) },
    { species: "dead", weight: speciesEcologyWeight("dead", ecology, height, normalY, settings) },
  ];
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let cursor = roll * total;
  for (const entry of weights) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.species;
  }
  return weights[weights.length - 1]?.species ?? null;
}

function treeSuppressionRadius(
  species: TreeSpeciesId,
  ecology: TreeEcologySample,
  settings: TreeSettings,
  gridX: number,
  gridZ: number,
): number {
  const base = settings.placement.minSpacingM;
  const speciesFactor = species === "oak" ? 1.15 : species === "pine" ? 0.95 : 0.8;
  const jitterRange = settings.ecology.clustering.minSpacingJitter;
  const jitter = 1 + (treeHash2(gridX, gridZ, settings.seed + 907) * 2 - 1) * jitterRange;
  return Math.max(0, base * speciesFactor * ecology.scaleMultiplier * jitter);
}
