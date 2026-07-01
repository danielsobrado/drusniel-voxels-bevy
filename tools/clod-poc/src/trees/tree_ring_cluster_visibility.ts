import { TREE_GPU_RING_CELL, treeGpuRingGrid } from "../gpu/tree_ring_compute.js";
import {
  createVegetationVisibilityProvider,
  type TerrainHeightSampler,
  type VegetationVisibilityReason,
} from "../vegetation/vegetation_visibility_provider.js";
import type { TreeSettings } from "./tree_config.js";
import { type TreeTerrainSampler } from "./tree_instances.js";
import { treeWorldCell } from "./tree_ring_math.js";

export const TREE_RING_CLUSTER_DIM_CELLS = 16;

export interface TreeRingClusterVisibilityOptions {
  centerX: number;
  centerZ: number;
  cameraY: number;
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
  clusterDimCells?: number;
}

export interface TreeRingClusterVisibilityMask {
  grid: number;
  clusterDimCells: number;
  clusterGrid: number;
  mask: Uint8Array;
  hiddenClusters: number;
  visibleClusters: number;
  unknownKeptClusters: number;
  reasonCounts: Record<VegetationVisibilityReason, number>;
}

export function buildTreeRingClusterVisibilityMask(options: TreeRingClusterVisibilityOptions): TreeRingClusterVisibilityMask {
  const grid = treeGpuRingGrid(options.settings);
  const clusterDimCells = Math.max(1, Math.floor(options.clusterDimCells ?? TREE_RING_CLUSTER_DIM_CELLS));
  const clusterGrid = Math.max(1, Math.ceil(grid / clusterDimCells));
  const mask = new Uint8Array(clusterGrid * clusterGrid);
  const reasonCounts = createReasonCounts();
  const provider = createVegetationVisibilityProvider();
  const terrainSampler = createTerrainHeightSampler(options.sampler);
  let hiddenClusters = 0;
  let visibleClusters = 0;
  let unknownKeptClusters = 0;

  for (let clusterZ = 0; clusterZ < clusterGrid; clusterZ++) {
    for (let clusterX = 0; clusterX < clusterGrid; clusterX++) {
      const index = clusterIndex(clusterX, clusterZ, clusterGrid);
      const centerSlotX = Math.min(grid - 1, clusterX * clusterDimCells + Math.floor(clusterDimCells / 2));
      const centerSlotZ = Math.min(grid - 1, clusterZ * clusterDimCells + Math.floor(clusterDimCells / 2));
      const [cellX, cellZ] = treeWorldCell(centerSlotX, centerSlotZ, grid, TREE_GPU_RING_CELL, options.centerX, options.centerZ);
      const targetX = cellX * TREE_GPU_RING_CELL;
      const targetZ = cellZ * TREE_GPU_RING_CELL;
      const targetGroundY = terrainSampler?.sampleHeight(targetX, targetZ).height ?? 0;
      const result = provider.sampleTerrainVisibility({
        sampler: terrainSampler,
        settings: {
          enabled: options.settings.gpu.enabled && options.settings.gpu.terrainVisibility.enabled,
          minDistanceM: options.settings.gpu.terrainVisibility.minDistanceM,
          sampleCount: options.settings.gpu.terrainVisibility.sampleCount,
          heightMarginM: options.settings.gpu.terrainVisibility.heightMarginM,
          crownHeightM: options.settings.gpu.terrainVisibility.crownHeightM,
        },
        cameraX: options.centerX,
        cameraY: options.cameraY,
        cameraZ: options.centerZ,
        targetX,
        targetZ,
        targetGroundY,
        targetRadiusM: clusterRadiusM(clusterDimCells),
      });
      reasonCounts[result.reason]++;
      if (result.reason === "unknown_kept") unknownKeptClusters++;
      mask[index] = result.visible ? 1 : 0;
      if (result.visible) visibleClusters++;
      else hiddenClusters++;
    }
  }

  return { grid, clusterDimCells, clusterGrid, mask, hiddenClusters, visibleClusters, unknownKeptClusters, reasonCounts };
}

export function treeRingSlotClusterVisible(clusterMask: TreeRingClusterVisibilityMask | null | undefined, slot: number): boolean {
  if (!clusterMask) return true;
  const safeSlot = Math.max(0, Math.floor(slot));
  const slotX = safeSlot % clusterMask.grid;
  const slotZ = Math.floor(safeSlot / clusterMask.grid);
  const clusterX = Math.min(clusterMask.clusterGrid - 1, Math.floor(slotX / clusterMask.clusterDimCells));
  const clusterZ = Math.min(clusterMask.clusterGrid - 1, Math.floor(slotZ / clusterMask.clusterDimCells));
  return clusterMask.mask[clusterIndex(clusterX, clusterZ, clusterMask.clusterGrid)] !== 0;
}

export function treeRingClusterMaskByteLength(settings: TreeSettings, clusterDimCells = TREE_RING_CLUSTER_DIM_CELLS): number {
  const grid = treeGpuRingGrid(settings);
  const clusterGrid = Math.max(1, Math.ceil(grid / Math.max(1, Math.floor(clusterDimCells))));
  return clusterGrid * clusterGrid;
}

function createTerrainHeightSampler(sampler: TreeTerrainSampler | undefined): TerrainHeightSampler | undefined {
  if (!sampler) return undefined;
  return {
    sampleHeight: (x, z) => {
      const height = sampler.surfaceHeight(x, z);
      return { height, unknown: !Number.isFinite(height) };
    },
  };
}

function clusterRadiusM(clusterDimCells: number): number {
  return Math.SQRT2 * TREE_GPU_RING_CELL * Math.max(1, clusterDimCells) * 0.5;
}

function clusterIndex(clusterX: number, clusterZ: number, clusterGrid: number): number {
  return clusterZ * clusterGrid + clusterX;
}

function createReasonCounts(): Record<VegetationVisibilityReason, number> {
  return {
    visible: 0,
    terrain_hidden: 0,
    unknown_kept: 0,
    near_forced_visible: 0,
    disabled: 0,
  };
}
