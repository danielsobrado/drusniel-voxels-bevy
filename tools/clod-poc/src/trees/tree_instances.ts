import * as THREE from "three";
import { materialWeights, surfaceHeight, surfaceNormal } from "../terrain.js";
import type { PageFootprint } from "../types.js";
import { treeHash2, treeRandomSigned } from "./tree_hash.js";
import { selectTreeSpecies } from "./tree_species.js";
import type { TreeSettings, TreeSpeciesId } from "./tree_config.js";

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
  materialWeights,
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
  const ranked: { priority: number; instance: TreeInstance }[] = [];
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
      if (groundWeight < settings.placement.minGroundWeight || threshold > groundWeight) {
        stats.rejectedMaterial++;
        continue;
      }

      const species = selectTreeSpecies(settings, treeHash2(gridX, gridZ, settings.seed + 409));
      if (!species) {
        stats.rejectedMaterial++;
        continue;
      }
      const speciesSettings = settings.species[species];
      if (height < speciesSettings.minHeightM || height > speciesSettings.maxHeightM) {
        stats.rejectedHeight++;
        continue;
      }

      if (minSpacingSq > 0 && ranked.some(({ instance }) => {
        const dx = instance.position[0] - x;
        const dz = instance.position[2] - z;
        return dx * dx + dz * dz < minSpacingSq;
      })) {
        stats.rejectedMaterial++;
        continue;
      }

      stats.acceptedCandidates++;
      ranked.push({
        priority: treeHash2(gridX, gridZ, settings.seed + 503),
        instance: {
          position: [x, height, z],
          species,
          scale: 0.82 + treeHash2(gridX, gridZ, settings.seed + 601) * 0.42,
          rotationY: treeHash2(gridX, gridZ, settings.seed + 701) * Math.PI * 2,
          normalY,
        },
      });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  return ranked.slice(0, limit).map(({ instance }) => instance);
}
