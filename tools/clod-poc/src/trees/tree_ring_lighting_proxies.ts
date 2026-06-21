import {
  TREE_GPU_RING_CELL,
  TREE_GPU_RING_GROUP_COUNT,
  treeGpuRingGroupIndex,
  treeGpuRingGrid,
  treeGpuRingSlotCount,
} from "../gpu/tree_ring_compute.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import {
  defaultTreeTerrainSampler,
  type TreeTerrainSampler,
} from "./tree_instances.js";
import {
  treeAcceptMask,
  treeLodRing,
  treeRingAcceptParams,
  treeRingLodParams,
  treeWorldCellFromSlot,
} from "./tree_ring_math.js";

export const TREE_GPU_RING_LIGHTING_PROXY_CAP = 2000;

export interface TreeRingLightingProxy {
  x: number;
  z: number;
  height: number;
  scale: number;
  crownRadius: number;
  species: TreeSpeciesId;
}

export interface TreeRingLightingProxyOptions {
  centerX: number;
  centerZ: number;
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
  maxProxies?: number;
}

export interface TreeRingValidationCountOptions extends TreeRingLightingProxyOptions {
  frustumPlanes?: ArrayLike<number>;
  maxInstancesPerGroup: number;
}

export interface TreeRingValidationCounts {
  counts: Record<TreeLod, number>;
  groupCounts: number[];
  overflowed: boolean;
}

export function treeRingLightingProxyKey(options: TreeRingLightingProxyOptions): string {
  const centerCellX = Math.round(options.centerX / TREE_GPU_RING_CELL);
  const centerCellZ = Math.round(options.centerZ / TREE_GPU_RING_CELL);
  return [
    centerCellX,
    centerCellZ,
    options.worldCells,
    options.settings.seed,
    options.settings.distanceM,
    options.settings.placement.minHeightM,
    options.settings.placement.maxHeightM,
    options.settings.placement.slopeMinY,
    options.settings.placement.minGroundWeight,
    options.settings.ecology.density.baseDensity,
    options.settings.ecology.clustering.clusterScaleM,
    options.settings.ecology.clustering.clusterStrength,
    options.settings.ecology.clustering.clusterThreshold,
    speciesWeight(options.settings, "oak"),
    speciesWeight(options.settings, "pine"),
    speciesWeight(options.settings, "dead"),
    Math.max(0, Math.floor(options.maxProxies ?? TREE_GPU_RING_LIGHTING_PROXY_CAP)),
  ].join("|");
}

export function generateTreeRingLightingProxies(options: TreeRingLightingProxyOptions): TreeRingLightingProxy[] {
  if (!options.settings.enabled) return [];
  const maxProxies = Math.max(0, Math.floor(options.maxProxies ?? TREE_GPU_RING_LIGHTING_PROXY_CAP));
  if (maxProxies <= 0) return [];
  const sampler = options.sampler ?? defaultTreeTerrainSampler;
  const settings = options.settings;
  const grid = treeGpuRingGrid(settings);
  const slots = treeGpuRingSlotCount(settings);
  const acceptParams = treeRingAcceptParams(settings);
  const ranked: { priority: number; proxy: TreeRingLightingProxy }[] = [];

  for (let slot = 0; slot < slots; slot++) {
    const [cellX, cellZ] = treeWorldCellFromSlot(slot, grid, TREE_GPU_RING_CELL, options.centerX, options.centerZ);
    const x = (cellX + treeRingHash(cellX, cellZ, settings.seed, 1103)) * TREE_GPU_RING_CELL;
    const z = (cellZ + treeRingHash(cellX, cellZ, settings.seed, 1200)) * TREE_GPU_RING_CELL;
    if (x <= 0 || z <= 0 || x >= options.worldCells || z >= options.worldCells) continue;
    const distance = Math.hypot(x - options.centerX, z - options.centerZ);
    if (distance > settings.distanceM + settings.lod.crossfadeBandM) continue;

    const terrainHeight = sampler.surfaceHeight(x, z);
    const normalY = sampler.surfaceNormal(x, z)[1];
    const accept = treeAcceptMask(terrainHeight, normalY, x, z, acceptParams);
    if (treeRingHash(cellX, cellZ, settings.seed, 809) >= accept) continue;

    const species = selectRingSpecies(settings, treeRingHash(cellX, cellZ, settings.seed, 409));
    if (!species) continue;
    const speciesSettings = settings.species[species];
    if (terrainHeight < speciesSettings.minHeightM || terrainHeight > speciesSettings.maxHeightM) continue;
    const scale = 0.82 + treeRingHash(cellX, cellZ, settings.seed, 601) * 0.42;
    ranked.push({
      priority: treeRingHash(cellX, cellZ, settings.seed, 503),
      proxy: {
        x,
        z,
        height: (speciesSettings.trunkHeightM + speciesSettings.crownRadiusM * 2) * scale,
        scale,
        crownRadius: speciesSettings.crownRadiusM * scale,
        species,
      },
    });
  }

  ranked.sort((a, b) => a.priority - b.priority);
  return ranked.slice(0, maxProxies).map(({ proxy }) => proxy);
}

export function generateTreeRingValidationCounts(options: TreeRingValidationCountOptions): TreeRingValidationCounts {
  const counts: Record<TreeLod, number> = { near: 0, mid: 0, far: 0, impostor: 0 };
  const rawGroupCounts = new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0);
  if (!options.settings.enabled) return { counts, groupCounts: rawGroupCounts, overflowed: false };

  const sampler = options.sampler ?? defaultTreeTerrainSampler;
  const settings = options.settings;
  const grid = treeGpuRingGrid(settings);
  const slots = treeGpuRingSlotCount(settings);
  const acceptParams = treeRingAcceptParams(settings);
  const lodParams = treeRingLodParams(settings);
  const ringLodParams = { ...lodParams, radius: Math.min(settings.distanceM, lodParams.radius) };
  const maxInstancesPerGroup = Math.max(0, Math.floor(options.maxInstancesPerGroup));

  for (let slot = 0; slot < slots; slot++) {
    const [cellX, cellZ] = treeWorldCellFromSlot(slot, grid, TREE_GPU_RING_CELL, options.centerX, options.centerZ);
    const x = (cellX + treeRingHash(cellX, cellZ, settings.seed, 1103)) * TREE_GPU_RING_CELL;
    const z = (cellZ + treeRingHash(cellX, cellZ, settings.seed, 1200)) * TREE_GPU_RING_CELL;
    if (x <= 0 || z <= 0 || x >= options.worldCells || z >= options.worldCells) continue;

    const distance = Math.hypot(x - options.centerX, z - options.centerZ);
    if (distance > ringLodParams.radius + ringLodParams.band) continue;

    const terrainHeight = sampler.surfaceHeight(x, z);
    const normalY = sampler.surfaceNormal(x, z)[1];
    const accept = treeAcceptMask(terrainHeight, normalY, x, z, acceptParams);
    if (treeRingHash(cellX, cellZ, settings.seed, 809) >= accept) continue;
    if (!treeRingPointInFrustum(x, terrainHeight + 4, z, 8, options.frustumPlanes)) continue;

    const species = selectRingSpecies(settings, treeRingHash(cellX, cellZ, settings.seed, 409));
    if (!species) continue;

    const ring = treeLodRing(distance, ringLodParams);
    for (const lod of TREE_LODS) {
      if (!ring.active[lod]) continue;
      rawGroupCounts[treeGpuRingGroupIndex(species, lod)]++;
    }
  }

  const groupCounts = rawGroupCounts.map((count) => Math.min(count, maxInstancesPerGroup));
  for (const species of TREE_SPECIES) {
    for (const lod of TREE_LODS) {
      counts[lod] += groupCounts[treeGpuRingGroupIndex(species, lod)] ?? 0;
    }
  }

  return {
    counts,
    groupCounts,
    overflowed: rawGroupCounts.some((count) => count > maxInstancesPerGroup),
  };
}

function treeRingHash(cellX: number, cellZ: number, seed: number, salt: number): number {
  const x = cellX + seed + salt;
  const z = cellZ + seed * 0.37 + salt * 1.17;
  return fract(Math.sin(x * 41.3 + z * 289.1) * 43758.5453);
}

function selectRingSpecies(settings: TreeSettings, roll: number): TreeSpeciesId | null {
  const weights = TREE_SPECIES.map((species) => ({ species, weight: speciesWeight(settings, species) }));
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let cursor = roll * total;
  for (const entry of weights) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.species;
  }
  return weights[weights.length - 1]?.species ?? null;
}

function treeRingPointInFrustum(
  x: number,
  y: number,
  z: number,
  slack: number,
  planes?: ArrayLike<number>,
): boolean {
  if (!planes) return true;
  for (let plane = 0; plane < 6; plane++) {
    const offset = plane * 4;
    const distance =
      (planes[offset] ?? 0) * x +
      (planes[offset + 1] ?? 0) * y +
      (planes[offset + 2] ?? 0) * z +
      (planes[offset + 3] ?? 0);
    if (distance < -slack) return false;
  }
  return true;
}

function speciesWeight(settings: TreeSettings, species: TreeSpeciesId): number {
  const config = settings.species[species];
  return config.enabled ? Math.max(0, config.weight) : 0;
}

function fract(value: number): number {
  return value - Math.floor(value);
}
