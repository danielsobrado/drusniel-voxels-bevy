import {
  TREE_GPU_RING_CELL,
  TREE_GPU_RING_GROUP_COUNT,
  treeGpuRingGroupIndex,
  treeGpuRingGrid,
  treeGpuRingSlotCount,
} from "../gpu/tree_ring_compute.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { defaultTreeTerrainSampler, type TreeTerrainSampler } from "./tree_instances.js";
import { treeAcceptMask, treeLodRing, treeRingAcceptParams, treeRingLodParams, treeWorldCellFromSlot } from "./tree_ring_math.js";
import {
  TREE_RING_SHADOW_CASCADE_COUNT,
  treeRingShadowCasterCascadeIndices,
  treeRingShadowCasterGroupCount,
  treeRingShadowCasterGroupIndex,
} from "./tree_ring_shadow_casters.js";
import { treeRingValidationHash, treeRingValidationJitter } from "./tree_ring_lighting_proxies.js";
import { treeLodCastsShadow } from "./tree_system_shadow_policy.js";
import { isTreeClusterTerrainOccluded } from "./tree_terrain_occlusion.js";

export interface TreeRingValidationCountOptions {
  centerX: number;
  centerZ: number;
  cameraY?: number;
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
  frustumPlanes?: ArrayLike<number>;
  shadowCascadePlanes?: ArrayLike<number>;
  maxInstancesPerGroup: number;
  maxShadowCastersPerGroup?: number;
  activeSlotIndices?: ArrayLike<number>;
}

export interface TreeRingValidationCounts {
  counts: Record<TreeLod, number>;
  groupCounts: number[];
  overflowed: boolean;
  shadowGroupCounts: number[];
  shadowOverflowed: boolean;
}

export function generateTreeRingValidationCounts(options: TreeRingValidationCountOptions): TreeRingValidationCounts {
  const counts: Record<TreeLod, number> = { near: 0, mid: 0, far: 0, impostor: 0 };
  const rawGroupCounts = new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0);
  const rawShadowGroupCounts = new Array<number>(treeRingShadowCasterGroupCount(TREE_RING_SHADOW_CASCADE_COUNT)).fill(0);
  if (!options.settings.enabled) return finishCounts(counts, rawGroupCounts, rawShadowGroupCounts, options);

  const sampler = options.sampler ?? defaultTreeTerrainSampler;
  const settings = options.settings;
  const grid = treeGpuRingGrid(settings);
  const slots = treeGpuRingSlotCount(settings);
  const slotSource = options.activeSlotIndices;
  const slotIterations = slotSource ? slotSource.length : slots;
  const acceptParams = treeRingAcceptParams(settings);
  const lodParams = treeRingLodParams(settings);
  const ringLodParams = { ...lodParams, radius: Math.min(settings.distanceM, lodParams.radius) };
  const maxShadowCastersPerGroup = Math.max(0, Math.floor(options.maxShadowCastersPerGroup ?? 0));

  for (let slotIndex = 0; slotIndex < slotIterations; slotIndex++) {
    const slot = Math.floor(slotSource ? slotSource[slotIndex] ?? -1 : slotIndex);
    if (slot < 0 || slot >= slots) continue;

    const [cellX, cellZ] = treeWorldCellFromSlot(slot, grid, TREE_GPU_RING_CELL, options.centerX, options.centerZ);
    const [jitterX, jitterZ] = treeRingValidationJitter(cellX, cellZ, settings.seed, 1103);
    const x = (cellX + jitterX) * TREE_GPU_RING_CELL;
    const z = (cellZ + jitterZ) * TREE_GPU_RING_CELL;
    if (x <= 0 || z <= 0 || x >= options.worldCells || z >= options.worldCells) continue;

    const distance = Math.hypot(x - options.centerX, z - options.centerZ);
    if (distance > ringLodParams.radius + ringLodParams.band) continue;

    const terrainHeight = sampler.surfaceHeight(x, z);
    if (treeRingTerrainHiddenForValidation({ settings, sampler, centerX: options.centerX, centerZ: options.centerZ, cameraY: options.cameraY, x, z, terrainHeight, distance })) continue;

    const normalY = sampler.surfaceNormal(x, z)[1];
    const accept = treeAcceptMask(terrainHeight, normalY, x, z, acceptParams);
    if (treeRingValidationHash(cellX, cellZ, settings.seed, 809) >= accept) continue;

    const species = selectRingSpecies(settings, treeRingValidationHash(cellX, cellZ, settings.seed, 409));
    if (!species) continue;

    const ring = treeLodRing(distance, ringLodParams);
    countShadowCasterGroups({
      rawShadowGroupCounts,
      species,
      ring,
      settings,
      center: [x, terrainHeight + 4, z],
      shadowCascadePlanes: options.shadowCascadePlanes,
      maxShadowCastersPerGroup,
    });

    if (!treeRingPointInFrustum(x, terrainHeight + 4, z, 8, options.frustumPlanes)) continue;
    for (const lod of TREE_LODS) {
      if (!ring.active[lod]) continue;
      rawGroupCounts[treeGpuRingGroupIndex(species, lod)]++;
    }
  }

  return finishCounts(counts, rawGroupCounts, rawShadowGroupCounts, options);
}

function finishCounts(
  counts: Record<TreeLod, number>,
  rawGroupCounts: number[],
  rawShadowGroupCounts: number[],
  options: Pick<TreeRingValidationCountOptions, "maxInstancesPerGroup" | "maxShadowCastersPerGroup">,
): TreeRingValidationCounts {
  const maxInstancesPerGroup = Math.max(0, Math.floor(options.maxInstancesPerGroup));
  const maxShadowCastersPerGroup = Math.max(0, Math.floor(options.maxShadowCastersPerGroup ?? 0));
  const groupCounts = rawGroupCounts.map((count) => Math.min(count, maxInstancesPerGroup));
  const shadowGroupCounts = rawShadowGroupCounts.map((count) => Math.min(count, maxShadowCastersPerGroup));
  for (const species of TREE_SPECIES) {
    for (const lod of TREE_LODS) counts[lod] += groupCounts[treeGpuRingGroupIndex(species, lod)] ?? 0;
  }
  return {
    counts,
    groupCounts,
    overflowed: rawGroupCounts.some((count) => count > maxInstancesPerGroup),
    shadowGroupCounts,
    shadowOverflowed: rawShadowGroupCounts.some((count) => count > maxShadowCastersPerGroup),
  };
}

function countShadowCasterGroups(input: {
  rawShadowGroupCounts: number[];
  species: TreeSpeciesId;
  ring: ReturnType<typeof treeLodRing>;
  settings: TreeSettings;
  center: readonly [number, number, number];
  shadowCascadePlanes?: ArrayLike<number>;
  maxShadowCastersPerGroup: number;
}): void {
  if (!input.shadowCascadePlanes || input.maxShadowCastersPerGroup <= 0) return;
  for (const lod of TREE_LODS) {
    if (!input.ring.active[lod] || !treeLodCastsShadow(input.settings, lod)) continue;
    for (const cascade of treeRingShadowCasterCascadeIndices(input.center, 12, input.shadowCascadePlanes)) {
      input.rawShadowGroupCounts[treeRingShadowCasterGroupIndex(input.species, lod, cascade)]++;
    }
  }
}

function treeRingTerrainHiddenForValidation(input: {
  settings: TreeSettings;
  sampler: TreeTerrainSampler;
  centerX: number;
  centerZ: number;
  cameraY: number | undefined;
  x: number;
  z: number;
  terrainHeight: number;
  distance: number;
}): boolean {
  const visibility = input.settings.gpu.terrainVisibility;
  if (input.distance <= Math.max(0, visibility.minDistanceM)) return false;
  return isTreeClusterTerrainOccluded({
    sampler: { sampleHeight: (x, z) => {
      const height = input.sampler.surfaceHeight(x, z);
      return { height, unknown: !Number.isFinite(height) };
    } },
    settings: {
      enabled: input.settings.gpu.enabled && visibility.enabled,
      minDistanceM: visibility.minDistanceM,
      sampleCount: visibility.sampleCount,
      heightMarginM: visibility.heightMarginM,
      canopyHeightM: visibility.crownHeightM,
    },
    cameraX: input.centerX,
    cameraY: typeof input.cameraY === "number" && Number.isFinite(input.cameraY) ? input.cameraY : input.terrainHeight,
    cameraZ: input.centerZ,
    targetX: input.x,
    targetZ: input.z,
    targetGroundY: input.terrainHeight,
    targetRadiusM: 0,
  });
}

function selectRingSpecies(settings: TreeSettings, roll: number): TreeSpeciesId | null {
  const weights = TREE_SPECIES.map((species) => ({ species, weight: speciesWeight(settings, species) }));
  const total = weights.reduce((sum, entry) => entry.weight + sum, 0);
  if (total <= 0) return null;
  let cursor = roll * total;
  for (const entry of weights) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.species;
  }
  return weights[weights.length - 1]?.species ?? null;
}

function treeRingPointInFrustum(x: number, y: number, z: number, slack: number, planes?: ArrayLike<number>): boolean {
  if (!planes) return true;
  for (let plane = 0; plane < 6; plane++) {
    const offset = plane * 4;
    const distance = (planes[offset] ?? 0) * x + (planes[offset + 1] ?? 0) * y + (planes[offset + 2] ?? 0) * z + (planes[offset + 3] ?? 0);
    if (distance < -slack) return false;
  }
  return true;
}

function speciesWeight(settings: TreeSettings, species: TreeSpeciesId): number {
  const config = settings.species[species];
  return config.enabled ? Math.max(0, config.weight) : 0;
}
