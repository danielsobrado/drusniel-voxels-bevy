import { getTerrainFieldCoreConfig } from "../gpu/terrain_field_core.js";
import { BIOME_IDS, BiomeRegionField } from "../world_source/biome_region_field.js";
import type { TerrainSummaryField } from "./terrain_summary_types.js";

export function gridIndex(res: number, x: number, z: number): number {
  return z * res + x;
}

export function cellCenter(res: number, worldSize: number, fx: number, fz: number): [number, number] {
  const cellSize = worldSize / res;
  return [(fx + 0.5) * cellSize, (fz + 0.5) * cellSize];
}

export function defaultBiomeSampler(): (x: number, z: number, height: number) => number {
  const terrainConfig = getTerrainFieldCoreConfig();
  const biomeField = new BiomeRegionField({
    seed: terrainConfig.seed,
    seaLevel: terrainConfig.seaLevel,
    islandShape: terrainConfig.islandShape,
  });
  return (x, z, height) => biomeField.sample(x, z, height).biome;
}

export function outsideSummaryFootprint(field: TerrainSummaryField, x: number, z: number): boolean {
  return x < 0 || x > field.worldSize || z < 0 || z > field.worldSize;
}

export function summaryCellSize(field: TerrainSummaryField): number {
  return Math.max(1, field.worldSize / Math.max(1, field.res));
}

export function sampleAnalyticNormal(field: TerrainSummaryField, x: number, z: number): [number, number, number] | null {
  if (!field.analyticHeightSampler) return null;
  const e = summaryCellSize(field);
  const hL = field.analyticHeightSampler(x - e, z);
  const hR = field.analyticHeightSampler(x + e, z);
  const hD = field.analyticHeightSampler(x, z - e);
  const hU = field.analyticHeightSampler(x, z + e);
  if (!Number.isFinite(hL) || !Number.isFinite(hR) || !Number.isFinite(hD) || !Number.isFinite(hU)) {
    return null;
  }
  const nx = (hL - hR) / (2 * e);
  const ny = 1;
  const nz = (hD - hU) / (2 * e);
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function canopyBiomeGate(biomeId: number): number {
  if (biomeId === BIOME_IDS.forest) return 1;
  if (biomeId === BIOME_IDS.swamp) return 0.65;
  if (biomeId === BIOME_IDS.meadows) return 0.2;
  return 0;
}

export function extendedRes(field: TerrainSummaryField, farRadius: number): number {
  const extent = 2 * farRadius;
  return Math.max(field.res, Math.min(512, Math.round(field.res * (extent / field.worldSize))));
}

export function hash(x: number, y: number, s: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 113.5) * 43758.5453;
  return n - Math.floor(n);
}

export function fbm(x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let i = 0; i < 2; i++) {
    v += amp * (Math.sin(fx) + Math.sin(fy * 1.3)) * 0.5;
    fx *= 2;
    fy *= 2;
    amp *= 0.5;
  }
  return v;
}

export function smooth01(edge0: number, edge1: number, t: number): number {
  const v = clamp01((t - edge0) / (edge1 - edge0));
  return v * v * (3 - 2 * v);
}
