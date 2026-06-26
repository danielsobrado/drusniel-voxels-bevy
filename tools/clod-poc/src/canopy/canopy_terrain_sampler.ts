import * as THREE from "three";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { sampleSkirtHeight, summaryBaseLevel } from "../clod/terrain_summary.js";
import { surfaceHeightCore } from "../gpu/terrain_field_core.js";

export interface TerrainSample {
  height: number;
  normal: { x: number; y: number; z: number };
  slope: number;
  materialHint: number;
  water: boolean;
}

export interface CanopyTerrainSampler {
  sample(x: number, z: number): TerrainSample;
}

const DEFAULT_WATER_LEVEL = 0.5;

function slopeFromNormal(ny: number): number {
  return Math.max(0, Math.min(1, 1 - ny));
}

function estimateNormal(
  sampler: (x: number, z: number) => number,
  x: number,
  z: number,
  eps = 2,
): { x: number; y: number; z: number } {
  const hL = sampler(x - eps, z);
  const hR = sampler(x + eps, z);
  const hD = sampler(x, z - eps);
  const hU = sampler(x, z + eps);
  const nx = (hL - hR) / (2 * eps);
  const nz = (hD - hU) / (2 * eps);
  const len = Math.hypot(nx, 1, nz) || 1;
  return { x: nx / len, y: 1 / len, z: nz / len };
}

export function createSummaryTerrainSampler(
  summary: TerrainSummaryField,
  farRadius: number,
  waterLevel = DEFAULT_WATER_LEVEL,
): CanopyTerrainSampler {
  const baseLevel = summaryBaseLevel(summary);
  const heightAt = (x: number, z: number) =>
    sampleSkirtHeight(summary, x, z, farRadius, baseLevel, 1.0);

  return {
    sample(x: number, z: number): TerrainSample {
      const height = heightAt(x, z);
      const normal = estimateNormal(heightAt, x, z);
      return {
        height,
        normal,
        slope: slopeFromNormal(normal.y),
        materialHint: 0,
        water: height < waterLevel,
      };
    },
  };
}

export function createAnalyticTerrainSampler(waterLevel = DEFAULT_WATER_LEVEL): CanopyTerrainSampler {
  const heightAt = (x: number, z: number) => surfaceHeightCore(x, z);
  return {
    sample(x: number, z: number): TerrainSample {
      const height = heightAt(x, z);
      const normal = estimateNormal(heightAt, x, z);
      return {
        height,
        normal,
        slope: slopeFromNormal(normal.y),
        materialHint: 0,
        water: height < waterLevel,
      };
    },
  };
}

export function createBlendedTerrainSampler(
  summary: TerrainSummaryField | null,
  farRadius: number,
  waterLevel = DEFAULT_WATER_LEVEL,
): CanopyTerrainSampler {
  if (!summary) return createAnalyticTerrainSampler(waterLevel);
  return createSummaryTerrainSampler(summary, farRadius, waterLevel);
}

/** Optional normal as THREE.Vector3 for consumers that need it. */
export function terrainSampleNormal3(sample: TerrainSample): THREE.Vector3 {
  return new THREE.Vector3(sample.normal.x, sample.normal.y, sample.normal.z);
}
