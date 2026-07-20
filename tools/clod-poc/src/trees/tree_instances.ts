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
import { treeVariantIndex } from "./tree_variant_selection.js";
import { vegetationStableIdentity, VEGETATION_CATEGORY, VEGETATION_SCHEMA_VERSION } from "../vegetation/gpu_authority/pcg2d.js";
import { createAcceptedTreeCompetitionSampler } from "./morphology/accepted_competition.js";
import { deriveTreeInstanceMorphology } from "./morphology/derive.js";
import type {
  TreeEcologySample as TreeMorphologyEcologySample,
  TreeIdentity,
  TreeInstanceMorphology,
  TreeTerrainSample,
} from "./morphology/types.js";

export const TREE_STRUCTURAL_VARIANTS = 4;

const TREE_CONTACT_OFFSET_PER_SCALE_M = -0.12;
const TREE_PLACEMENT_DEBUG_SAMPLE_LIMIT = 4096;

export type TreePlacementDebugReason = "accepted" | "outside" | "slope" | "height" | "material" | "ecology" | "species";

export interface TreePlacementDebugSample {
  readonly reason: TreePlacementDebugReason;
  readonly position: [number, number, number];
}

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
  identity: TreeIdentity;
  morphology: TreeInstanceMorphology;
}

interface PendingTreeInstance extends Omit<TreeInstance, "morphology"> {
  morphologyTerrain: TreeTerrainSample;
  morphologyEcology: TreeMorphologyEcologySample;
}

interface RankedTreeCandidate {
  priority: number;
  instance: PendingTreeInstance;
  suppressionRadius: number;
}

export interface TreeGenerationStats {
  generatedCandidates: number;
  acceptedCandidates: number;
  rejectedSlope: number;
  rejectedHeight: number;
  rejectedMaterial: number;
  debugSamples: TreePlacementDebugSample[];
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
    debugSamples: [],
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
  const ranked: RankedTreeCandidate[] = [];
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
        recordPlacementDebugSample(settings, stats, "outside", x, 0, z);
        continue;
      }

      const height = sampler.surfaceHeight(x, z);
      const surfaceNormalSample = sampler.surfaceNormal(x, z);
      const normalY = surfaceNormalSample[1];
      if (normalY < settings.placement.slopeMinY) {
        stats.rejectedSlope++;
        recordPlacementDebugSample(settings, stats, "slope", x, height, z);
        continue;
      }
      if (height < settings.placement.minHeightM || height > settings.placement.maxHeightM) {
        stats.rejectedHeight++;
        recordPlacementDebugSample(settings, stats, "height", x, height, z);
        continue;
      }

      const weights = sampler.materialWeights(height, normalY);
      const materialDensity = treeMaterialDensity(settings, weights);
      const groundWeight = (weights[0] + weights[1] * 0.25) * materialDensity;
      const threshold = treeHash2(gridX, gridZ, settings.seed + 307);
      if (groundWeight < settings.placement.minGroundWeight || (!settings.ecology.enabled && threshold > groundWeight)) {
        stats.rejectedMaterial++;
        recordPlacementDebugSample(settings, stats, "material", x, height, z);
        continue;
      }

      const ecology = settings.ecology.enabled ? sampleTreeEcology(x, z, height, normalY, groundWeight, settings) : null;
      if (ecology && treeHash2(gridX, gridZ, settings.seed + 701) > ecologyAcceptanceProbability(ecology, settings)) {
        stats.rejectedMaterial++;
        recordPlacementDebugSample(settings, stats, "ecology", x, height, z);
        continue;
      }
      const species = selectTreeSpeciesForInstance(settings, treeHash2(gridX, gridZ, settings.seed + 409), height, normalY, weights, ecology);
      if (!species) {
        stats.rejectedMaterial++;
        recordPlacementDebugSample(settings, stats, "species", x, height, z);
        continue;
      }
      const speciesSettings = settings.species[species];
      const variant = treeVariantIndex(x, z, settings.seed, TREE_STRUCTURAL_VARIANTS);
      const scale = (0.82 + treeHash2(gridX, gridZ, settings.seed + 601) * 0.42) * (ecology?.scaleMultiplier ?? 1);
      const rotationY = treeHash2(gridX, gridZ, settings.seed + 907) * Math.PI * 2;
      const [stableIdLo, stableIdHi] = vegetationStableIdentity({
        worldSeed: settings.seed,
        category: VEGETATION_CATEGORY.TREE,
        schemaVersion: VEGETATION_SCHEMA_VERSION,
        globalCellX: gridX,
        globalCellZ: gridZ,
        classId: TREE_SPECIES.indexOf(species),
      });
      const identity: TreeIdentity = { stableIdLo, stableIdHi };
      const slopeLength = Math.hypot(surfaceNormalSample[0], surfaceNormalSample[2]);
      const zone = settings.ecology.speciesZones[species];
      const moisture = ecology?.moisture ?? 0.5;
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
          identity,
          morphologyTerrain: {
            slope01: Math.max(0, Math.min(1, slopeLength)),
            downhillDirectionXZ: slopeLength > 1e-8
              ? [surfaceNormalSample[0] / slopeLength, surfaceNormalSample[2] / slopeLength]
              : [0, 0],
            exposure01: Math.max(0, Math.min(1, 1 - normalY)),
            exposedRootPotential: Math.max(0, Math.min(1, 1 - normalY)),
          },
          morphologyEcology: {
            oldForestBias: zone.oldForestBias * (ecology?.forestDensity ?? 0.5),
            moisture,
            moistureSuitability: 1 - Math.min(1, Math.abs(moisture - zone.moisturePreference)),
            temperatureSuitability: 1 - Math.min(1, Math.abs(height - 34) / 58),
            stress: Math.max(0, Math.min(1, (1 - (ecology?.terrainSuitability ?? 0.75)) * 0.65 + (1 - normalY) * 0.35)),
          },
        },
      });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  const accepted: PendingTreeInstance[] = [];
  for (const candidate of ranked) {
    if (accepted.length >= limit) break;
    if (accepted.some((existing) => {
      const dx = existing.position[0] - candidate.instance.position[0];
      const dz = existing.position[2] - candidate.instance.position[2];
      const minDistance = Math.max(settings.placement.minSpacingM, candidate.suppressionRadius * 0.45);
      return dx * dx + dz * dz < Math.max(minSpacingSq, minDistance * minDistance);
    })) continue;
    stats.acceptedCandidates++;
    recordPlacementDebugSample(
      settings,
      stats,
      "accepted",
      candidate.instance.position[0],
      candidate.instance.position[1],
      candidate.instance.position[2],
    );
    accepted.push(candidate.instance);
  }

  const competition = createAcceptedTreeCompetitionSampler(accepted.map((instance) => ({
    identity: instance.identity,
    positionXZ: [instance.position[0], instance.position[2]],
    crownRadiusM: settings.species[instance.species].crownRadiusM * instance.scale,
  })));
  return accepted.map((pending): TreeInstance => {
    const { morphologyTerrain, morphologyEcology, ...instance } = pending;
    return {
      ...instance,
      morphology: deriveTreeInstanceMorphology(
        instance.identity,
        instance.species,
        morphologyTerrain,
        morphologyEcology,
        competition.sample(instance.identity),
        settings.species[instance.species].morphologyRuntime,
      ),
    };
  });
}

function recordPlacementDebugSample(
  settings: TreeSettings,
  stats: TreeGenerationStats,
  reason: TreePlacementDebugReason,
  x: number,
  y: number,
  z: number,
): void {
  if (!settings.render.placementDebug || stats.debugSamples.length >= TREE_PLACEMENT_DEBUG_SAMPLE_LIMIT) return;
  stats.debugSamples.push({ reason, position: [x, y + 0.25, z] });
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
