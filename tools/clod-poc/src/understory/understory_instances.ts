import * as THREE from "three";
import { terrainWeights, surfaceHeight, surfaceNormal } from "../terrain.js";
import type { PageFootprint } from "../types.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import {
  sampleUnderstoryEcology,
  understoryClassWeight,
  type TreeInfluenceSampler,
  type UnderstoryEcologySample,
} from "./understory_ecology.js";
import { understoryHash2, understoryRandomSigned } from "./understory_hash.js";

export interface UnderstoryTerrainSampler {
  surfaceHeight(x: number, z: number): number;
  surfaceNormal(x: number, z: number): [number, number, number];
  materialWeights(height: number, normalY: number): [number, number, number, number];
  treeInfluence?: TreeInfluenceSampler;
}

export interface UnderstoryInstance {
  classId: UnderstoryClass;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  windPhase: number;
  normalY: number;
  ecology: UnderstoryEcologySample;
}

export interface UnderstoryGenerationStats {
  generatedCandidates: number;
  acceptedCandidates: number;
  rejectedSlope: number;
  rejectedHeight: number;
  rejectedMaterial: number;
  rejectedEcology: number;
  rejectedSpacing: number;
  acceptedShrub: number;
  acceptedFern: number;
  acceptedSapling: number;
  acceptedFlower: number;
  acceptedDeadLog: number;
  acceptedStump: number;
}

export const defaultUnderstoryTerrainSampler: UnderstoryTerrainSampler = {
  surfaceHeight,
  surfaceNormal,
  materialWeights: terrainWeights,
  // Note: when hydrology is active, surfaceHeight() returns the carved bed via terrainSurfaceOverride.
  // The GPU compute shader (understory_ring.compute.wgsl) uses surfaceHeightField() which is the
  // base procedural terrain without hydrology carving. This creates a CPU/GPU height mismatch in
  // hydrology regions. See TODO in understory_ring.compute.wgsl for the fix.
};

export function emptyUnderstoryGenerationStats(): UnderstoryGenerationStats {
  return {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    rejectedSlope: 0,
    rejectedHeight: 0,
    rejectedMaterial: 0,
    rejectedEcology: 0,
    rejectedSpacing: 0,
    acceptedShrub: 0,
    acceptedFern: 0,
    acceptedSapling: 0,
    acceptedFlower: 0,
    acceptedDeadLog: 0,
    acceptedStump: 0,
  };
}

export function generateUnderstoryInstances(
  footprint: PageFootprint,
  settings: UnderstorySettings,
  capacityLeft = settings.maxInstances,
  stats: UnderstoryGenerationStats = emptyUnderstoryGenerationStats(),
  sampler: UnderstoryTerrainSampler = defaultUnderstoryTerrainSampler,
  worldCells = Number.POSITIVE_INFINITY,
): UnderstoryInstance[] {
  const spacing = Math.max(0.25, settings.placement.spacingM);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  const limit = Math.max(0, Math.floor(capacityLeft));
  const ranked: { priority: number; spacingRadius: number; instance: UnderstoryInstance }[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      stats.generatedCandidates++;
      const gridX = Math.floor(footprint.minX / spacing) + column;
      const gridZ = Math.floor(footprint.minZ / spacing) + row;
      const baseX = footprint.minX + (column + 0.5) * spacing;
      const baseZ = footprint.minZ + (row + 0.5) * spacing;
      const x = THREE.MathUtils.clamp(
        baseX + understoryRandomSigned(gridX, gridZ, settings.seed + 101) * spacing * settings.placement.jitter,
        footprint.minX + 0.001,
        Math.min(footprint.maxX, worldCells) - 0.001,
      );
      const z = THREE.MathUtils.clamp(
        baseZ + understoryRandomSigned(gridX, gridZ, settings.seed + 211) * spacing * settings.placement.jitter,
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
      if (groundWeight < settings.placement.minGroundWeight) {
        stats.rejectedMaterial++;
        continue;
      }

      const ecology = sampleUnderstoryEcology(x, z, height, normalY, groundWeight, settings, sampler.treeInfluence);
      if (ecology.forestInfluence < settings.placement.minTreeInfluence) {
        stats.rejectedEcology++;
        continue;
      }
      const acceptance = THREE.MathUtils.clamp(
        0.06 + ecology.density * 0.42 + ecology.forestInfluence * 0.28 + ecology.forestEdge * 0.22 + ecology.clearing * 0.12,
        0,
        1,
      );
      if (understoryHash2(gridX, gridZ, settings.seed + 307) > acceptance) {
        stats.rejectedEcology++;
        continue;
      }

      const cls = selectUnderstoryClass(ecology, height, normalY, settings, understoryHash2(gridX, gridZ, settings.seed + 409));
      if (!cls) {
        stats.rejectedEcology++;
        continue;
      }
      const classDensity = settings.classes[cls].density;
      if (understoryHash2(gridX, gridZ, settings.seed + 509) > Math.min(1, classDensity)) {
        stats.rejectedEcology++;
        continue;
      }

      const spacingRadius = classSpacingRadius(cls, spacing);
      if (ranked.some(({ instance, spacingRadius: acceptedRadius }) => {
        const dx = instance.position[0] - x;
        const dz = instance.position[2] - z;
        const radius = Math.max(spacingRadius, acceptedRadius);
        return dx * dx + dz * dz < radius * radius;
      })) {
        stats.rejectedSpacing++;
        continue;
      }

      const config = settings.classes[cls];
      const scale = THREE.MathUtils.lerp(config.minScale, config.maxScale, understoryHash2(gridX, gridZ, settings.seed + 601));
      const instance: UnderstoryInstance = {
        classId: cls,
        position: [x, height, z],
        rotationY: understoryHash2(gridX, gridZ, settings.seed + 701) * Math.PI * 2,
        scale,
        windPhase: understoryHash2(gridX, gridZ, settings.seed + 809) * Math.PI * 2,
        normalY,
        ecology,
      };
      ranked.push({
        priority: understoryHash2(gridX, gridZ, settings.seed + 907),
        spacingRadius,
        instance,
      });
      stats.acceptedCandidates++;
      incrementClassStats(stats, cls);
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  return ranked.slice(0, limit).map(({ instance }) => instance);
}

export function selectUnderstoryClass(
  ecology: UnderstoryEcologySample,
  height: number,
  normalY: number,
  settings: UnderstorySettings,
  roll: number,
): UnderstoryClass | null {
  const weights = UNDERSTORY_CLASSES.map((classId) => ({
    classId,
    weight: understoryClassWeight(classId, ecology, height, normalY, settings),
  }));
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let cursor = roll * total;
  for (const entry of weights) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.classId;
  }
  return weights[weights.length - 1]?.classId ?? null;
}

function classSpacingRadius(cls: UnderstoryClass, spacing: number): number {
  if (cls === "dead_log" || cls === "stump") return spacing * 1.7;
  if (cls === "flower" || cls === "fern") return spacing * 0.55;
  return spacing * 0.9;
}

function incrementClassStats(stats: UnderstoryGenerationStats, cls: UnderstoryClass): void {
  if (cls === "shrub") stats.acceptedShrub++;
  else if (cls === "fern") stats.acceptedFern++;
  else if (cls === "sapling") stats.acceptedSapling++;
  else if (cls === "flower") stats.acceptedFlower++;
  else if (cls === "dead_log") stats.acceptedDeadLog++;
  else stats.acceptedStump++;
}
