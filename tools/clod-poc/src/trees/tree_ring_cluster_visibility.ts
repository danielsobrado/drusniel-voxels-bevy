import { TREE_GPU_RING_CELL, treeGpuRingGrid } from "../gpu/tree_ring_compute.js";
import {
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG,
  type VegetationTerrainRejectionConfig,
} from "../vegetation/terrain_rejection_config.js";
import { quantizeTerrainRejectionBucket } from "../vegetation/terrain_rejection_cache.js";
import {
  buildVegetationSlotPrefilter,
  VegetationSlotPrefilterCache,
  type VegetationSlotPrefilterDecision,
} from "../vegetation/vegetation_slot_prefilter.js";
import type { VegetationTerrainRejectSource } from "../vegetation/vegetation_terrain_reject_provider.js";
import type { TerrainHeightSampler, VegetationVisibilityReason } from "../vegetation/vegetation_visibility_provider.js";
import type { TreeSettings } from "./tree_config.js";
import { type TreeTerrainSampler } from "./tree_instances.js";

export const TREE_RING_CLUSTER_DIM_CELLS = 16;

export interface TreeRingClusterVisibilityOptions {
  centerX: number;
  centerZ: number;
  cameraY: number;
  worldCells: number;
  /** Infinite/island world: skip the [0, worldCells] box reject (terrain exists past the box). */
  unbounded?: boolean;
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
  farSummaryConsultedClusters: number;
  candidateSlotsBeforePrefilter: number;
  candidateSlotsAfterPrefilter: number;
  skippedCandidateEstimate: number;
  cacheHits: number;
  cacheMisses: number;
  reasonCounts: Record<VegetationVisibilityReason, number>;
  sourceCounts: Record<VegetationTerrainRejectSource, number>;
}

export type TreeRingClusterVisibilityDecision = VegetationSlotPrefilterDecision;

export class TreeRingClusterVisibilityCache extends VegetationSlotPrefilterCache {
  private lastMaskKey = "";
  private lastMask: TreeRingClusterVisibilityMask | null = null;

  getMask(key: string): TreeRingClusterVisibilityMask | null {
    return key === this.lastMaskKey ? this.lastMask : null;
  }

  setMask(key: string, mask: TreeRingClusterVisibilityMask): void {
    this.lastMaskKey = key;
    this.lastMask = mask;
  }

  override clear(): void {
    super.clear();
    this.lastMaskKey = "";
    this.lastMask = null;
  }
}

export function buildTreeRingClusterVisibilityMask(options: TreeRingClusterVisibilityOptions): TreeRingClusterVisibilityMask {
  const grid = treeGpuRingGrid(options.settings);
  const clusterDimCells = effectiveTreeRingClusterDimCells(options.clusterDimCells);
  const cacheKey = options.cache ? treeRingClusterVisibilityMaskCacheKey(options, grid, clusterDimCells) : "";
  const cached = cacheKey ? options.cache?.getMask(cacheKey) ?? null : null;
  if (cached) return {
    ...cached,
    cacheHits: cached.hiddenClusters + cached.visibleClusters,
    cacheMisses: 0,
  };
  const prefilter = buildVegetationSlotPrefilter({
    kind: "tree",
    centerX: options.centerX,
    centerZ: options.centerZ,
    cameraY: options.cameraY,
    worldCells: options.worldCells,
    unbounded: options.unbounded,
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
  const mask = {
    grid: prefilter.grid,
    clusterDimCells: prefilter.clusterDimSlots,
    clusterGrid: prefilter.clusterGrid,
    words: prefilter.clusterWords,
    activeSlotIndices: prefilter.activeSlotIndices,
    hiddenClusters: prefilter.rejectedClusters,
    visibleClusters: prefilter.visibleClusters,
    unknownKeptClusters: prefilter.unknownKeptClusters,
    farSummaryConsultedClusters: prefilter.farSummaryConsultedClusters,
    candidateSlotsBeforePrefilter: prefilter.candidateSlotsBeforePrefilter,
    candidateSlotsAfterPrefilter: prefilter.candidateSlotsAfterPrefilter,
    skippedCandidateEstimate: prefilter.skippedCandidateEstimate,
    cacheHits: prefilter.cacheHits,
    cacheMisses: prefilter.cacheMisses,
    reasonCounts: prefilter.reasonCounts,
    sourceCounts: prefilter.sourceCounts,
  };
  if (cacheKey) options.cache?.setMask(cacheKey, mask);
  return mask;
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
  const clusterGrid = Math.max(1, Math.ceil(grid / effectiveTreeRingClusterDimCells(clusterDimCells)));
  return clusterGrid * clusterGrid * Uint32Array.BYTES_PER_ELEMENT;
}

function effectiveTreeRingClusterDimCells(clusterDimCells = TREE_RING_CLUSTER_DIM_CELLS): number {
  const requested = Math.max(1, Math.floor(clusterDimCells));
  const minByPhysicalSize = Math.ceil(
    DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.gpuEarlyReject.minClusterSize / TREE_GPU_RING_CELL,
  );
  return Math.max(requested, minByPhysicalSize);
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

function treeRingClusterVisibilityMaskCacheKey(
  options: TreeRingClusterVisibilityOptions,
  grid: number,
  clusterDimCells: number,
): string {
  const visibility = options.settings.gpu.terrainVisibility;
  const bucketM = options.cacheConfig?.cameraBucketM ?? DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.cameraBucketM;
  return [
    "tree",
    grid,
    clusterDimCells,
    TREE_GPU_RING_CELL,
    quantizeTerrainRejectionBucket(options.centerX, bucketM),
    quantizeTerrainRejectionBucket(options.centerZ, bucketM),
    quantizeTerrainRejectionBucket(options.cameraY, bucketM),
    Math.floor(options.worldCells),
    options.settings.gpu.enabled ? 1 : 0,
    visibility.enabled ? 1 : 0,
    visibility.minDistanceM,
    visibility.sampleCount,
    visibility.heightMarginM,
    visibility.crownHeightM,
    options.terrainRevision ?? 0,
    options.providerRevision ?? 0,
  ].join("|");
}
