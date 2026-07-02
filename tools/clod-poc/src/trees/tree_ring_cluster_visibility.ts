import { TREE_GPU_RING_CELL, treeGpuRingGrid } from "../gpu/tree_ring_compute.js";
import type { VegetationTerrainRejectionConfig } from "../vegetation/terrain_rejection_config.js";
import {
  buildVegetationSlotPrefilter,
  VegetationSlotPrefilterCache,
  type VegetationSlotPrefilterDecision,
} from "../vegetation/vegetation_slot_prefilter.js";
import type { TerrainHeightSampler, VegetationVisibilityReason } from "../vegetation/vegetation_visibility_provider.js";
import type { TreeSettings } from "./tree_config.js";
import { type TreeTerrainSampler } from "./tree_instances.js";

export const TREE_RING_CLUSTER_DIM_CELLS = 16;

export interface TreeRingClusterVisibilityOptions {
  centerX: number;
  centerZ: number;
  cameraY: number;
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
  clusterDimCells?: number;
  terrainRevision?: number;
  providerRevision?: number;
  cache?: TreeRingClusterVisibilityCache;
  cacheConfig?: Pick<VegetationTerrainRejectionConfig, "decisionCacheEnabled" | "cameraBucketM">;
}

export interface TreeRingClusterVisibilityMask {
  grid: number;
  clusterDimCells: number;
  clusterGrid: number;
  words: Uint32Array;
  activeSlotIndices: Uint32Array;
  hiddenClusters: number;
  visibleClusters: number;
  unknownKeptClusters: number;
  candidateSlotsBeforePrefilter: number;
  candidateSlotsAfterPrefilter: number;
  skippedCandidateEstimate: number;
  cacheHits: number;
  cacheMisses: number;
  reasonCounts: Record<VegetationVisibilityReason, number>;
}

export type TreeRingClusterVisibilityDecision = VegetationSlotPrefilterDecision;

export class TreeRingClusterVisibilityCache extends VegetationSlotPrefilterCache {}

export function buildTreeRingClusterVisibilityMask(options: TreeRingClusterVisibilityOptions): TreeRingClusterVisibilityMask {
  const grid = treeGpuRingGrid(options.settings);
  const clusterDimCells = Math.max(1, Math.floor(options.clusterDimCells ?? TREE_RING_CLUSTER_DIM_CELLS));
  const prefilter = buildVegetationSlotPrefilter({
    kind: "tree",
    centerX: options.centerX,
    centerZ: options.centerZ,
    cameraY: options.cameraY,
    worldCells: options.worldCells,
    grid,
    cell: TREE_GPU_RING_CELL,
    clusterDimSlots: clusterDimCells,
    visibility: {
      enabled: options.settings.gpu.enabled && options.settings.gpu.terrainVisibility.enabled,
      minDistanceM: options.settings.gpu.terrainVisibility.minDistanceM,
      sampleCount: options.settings.gpu.terrainVisibility.sampleCount,
      heightMarginM: options.settings.gpu.terrainVisibility.heightMarginM,
      crownHeightM: options.settings.gpu.terrainVisibility.crownHeightM,
    },
    sampler: createTerrainHeightSampler(options.sampler),
    terrainRevision: options.terrainRevision,
    providerRevision: options.providerRevision,
    cache: options.cache,
    cacheConfig: options.cacheConfig,
  });
  return {
    grid: prefilter.grid,
    clusterDimCells: prefilter.clusterDimSlots,
    clusterGrid: prefilter.clusterGrid,
    words: prefilter.clusterWords,
    activeSlotIndices: prefilter.activeSlotIndices,
    hiddenClusters: prefilter.rejectedClusters,
    visibleClusters: prefilter.visibleClusters,
    unknownKeptClusters: prefilter.unknownKeptClusters,
    candidateSlotsBeforePrefilter: prefilter.candidateSlotsBeforePrefilter,
    candidateCountAfterPrefilter: prefilter.candidateSlotsAfterPrefilter,
    skippedCandidateEstimate: prefilter.skippedCandidateEstimate,
    cacheHits: prefilter.cacheHits,
    cacheMisses: prefilter.cacheMisses,
    reasonCounts: prefilter.reasonCounts,
  } as TreeRingClusterVisibilityMask;
}

export function treeRingSlotClusterVisible(mask: TreeRingClusterVisibilityMask | null | undefined, slot: number): boolean {
  if (!mask) return true;
  const safeSlot = Math.max(0, Math.floor(slot));
  const slotX = safeSlot % mask.grid;
  const slotZ = Math.floor(safeSlot / mask.grid);
  const clusterX = Math.min(mask.clusterGrid - 1, Math.floor(slotX / mask.clusterDimCells));
  const clusterZ = Math.min(mask.clusterGrid - 1, Math.floor(slotZ / mask.clusterDimCells));
  return mask.words[clusterZ * mask.clusterGrid + clusterX] !== 0;
}

export function treeRingClusterMaskByteLength(settings: TreeSettings, clusterDimCells = TREE_RING_CLUSTER_DIM_CELLS): number {
  const grid = treeGpuRingGrid(settings);
  const clusterGrid = Math.max(1, Math.ceil(grid / Math.max(1, Math.floor(clusterDimCells))));
  return clusterGrid * clusterGrid * Uint32Array.BYTES_PER_ELEMENT;
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
