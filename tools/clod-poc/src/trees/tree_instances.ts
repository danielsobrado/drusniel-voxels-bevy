import * as THREE from "three";
import { terrainWeights, surfaceHeight, surfaceNormal } from "../terrain/terrain.js";
import type { PageFootprint } from "../types.js";
import { treeHash2, treeRandomSigned } from "./tree_hash.js";
import { selectTreeSpecies } from "./tree_species.js";
import { TREE_SPECIES, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { treeMaterialDensity } from "./tree_material_bias.js";
import {
  ecologyAcceptanceProbability,
  sampleTreeEcology,
  speciesEcologyWeight,
  type TreeEcologySample,
} from "./tree_ecology.js";

export const TREE_STRUCTURAL_VARIANTS = 4;

const TREE_CONTACT_OFFSET_PER_SCALE_M = -0.12;
export interface TreeTerrainSampler {
  readonly sourceRevision?: number | (() => number);
  surfaceHeight(x: number, z: number): number;
  surfaceNormal(x: number, z: number): [number, number, number];
  materialWeights(height: number, normalY: number): [number, number, number, number];
}

export interface TreeInstance {
  position: [number, number, number];
  species: TreeSpeciesId;
  variant: number;
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
      const materialDensity = treeMaterialDensity(settings, weights);
      const groundWeight = (weights[0] + weights[1] * 0.25) * materialDensity;
      const threshold = treeHash2(gridX, gridZ, settings.seed + 307);
      if (groundWeight < settings.placement.minGroundWeight || (!settings.ecology.enabled && threshold > groundWeight)) {
        stats.rejectedMaterial++;
        continue;
      }

      const ecology = settings.ecology.enabled ? sampleTreeEcology(x, z, height, normalY, groundWeight, settings) : null;
      if (ecology && treeHash2(gridX, gridZ, settings.seed + 701) > ecologyAcceptanceProbability(ecology, settings)) {
        stats.rejectedMaterial++;
        continue;
      }
      const species = selectTreeSpeciesForInstance(settings, treeHash2(gridX, gridZ, settings.seed + 409), height, normalY, weights, ecology);
      if (!species) { stats.rejectedMaterial++; continue; }
      const speciesSettings = settings.species[species];
      const variant = Math.floor(treeHash2(gridX, gridZ, settings.seed + 509) * TREE_STRUCTURAL_VARIANTS) % TREE_STRUCTURAL_VARIANTS;
      const scale = (0.82 + treeHash2(gridX, gridZ, settings.seed + 601) * 0.42) * (ecology?.scaleMultiplier ?? 1);
      const rotationY = treeHash2(gridX, gridZ, settings.seed + 907) * Math.PI * 2;
      ranked.push({
        priority: treeInstancePriority(gridX, gridZ, settings.seed, ecology, species, height, normalY, settings, weights),
        suppressionRadius: speciesSettings.crownRadiusM * scale,
        instance: {
          position: [x, height + TREE_CONTACT_OFFSET_PER_SCALE_M * scale, z],
          species,
          variant,
          scale,
          rotationY,
          normalY,
        },
      });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  const accepted: TreeInstance[] = [];
  for (const candidate of ranked) {
    if (accepted.length >= limit) break;
    if (accepted.some((existing) => {
      const dx = existing.position[0] - candidate.instance.position[0];
      const dz = existing.position[2] - candidate.instance.position[2];
      const minDistance = Math.max(settings.placement.minSpacingM, candidate.suppressionRadius * 0.45);
      return dx * dx + dz * dz < Math.max(minSpacingSq, minDistance * minDistance);
    })) continue;
    stats.acceptedCandidates++;
    accepted.push(candidate.instance);
  }
  return accepted;
}

function selectTreeSpeciesForInstance(
  settings: TreeSettings,
  roll: number,
  height: number,
  normalY: number,
  materialWeights: readonly [number, number, number, number],
  ecology: TreeEcologySample | null,
): TreeSpeciesId | null {
  if (!ecology || !settings.ecology.enabled) return selectTreeSpecies(settings, roll);
  let total = 0;
  const weighted = TREE_SPECIES.map((species) => {
    const weight = speciesEcologyWeight(species, ecology, height, normalY, settings, materialWeights);
    total += weight;
    return { species, weight };
  });
  if (total <= 0) return null;
  let cursor = roll * total;
  for (const candidate of weighted) {
    cursor -= candidate.weight;
    if (cursor <= 0) return candidate.species;
  }
  return weighted[weighted.length - 1]?.species ?? null;
}

function treeInstancePriority(
  gridX: number,
  gridZ: number,
  seed: number,
  ecology: TreeEcologySample | null,
  species: TreeSpeciesId,
  height: number,
  normalY: number,
  settings: TreeSettings,
  materialWeights: readonly [number, number, number, number],
): number {
  const base = treeHash2(gridX, gridZ, seed + 503);
  if (!ecology) return base;
  const density = ecologyAcceptanceProbability(ecology, settings);
  const speciesWeight = speciesEcologyWeight(species, ecology, height, normalY, settings, materialWeights);
  return base * (1 - Math.min(0.25, density * 0.1)) + speciesWeight * -0.01;
}
