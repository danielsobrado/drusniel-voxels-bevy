import { TREE_GPU_RING_CELL, treeGpuRingGrid } from "../gpu/tree_ring_compute.js";
import { DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG, type VegetationTerrainRejectionConfig } from "../vegetation/terrain_rejection_config.js";
import { quantizeTerrainRejectionBucket } from "../vegetation/terrain_rejection_cache.js";
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

export interface TreeRingClusterVisibilityDecision {
  visible: boolean;
  reason: VegetationVisibilityReason;
}

export interface TreeRingClusterVisibilityCacheStats {
  hits: number;
  misses: number;
  entries: number;
  evictions: number;
}

interface ClusterProbe {
  x: number;
  z: number;
}

interface CacheEntry {
  decision: TreeRingClusterVisibilityDecision;
  lastUsed: number;
}

export class TreeRingClusterVisibilityCache {
  private readonly entries = new Map<string, CacheEntry>();
  private clock = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly maxEntries = DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheMaxEntries) {}

  get(key: string): TreeRingClusterVisibilityDecision | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    this.hits++;
    entry.lastUsed = ++this.clock;
    return entry.decision;
  }

  set(key: string, decision: TreeRingClusterVisibilityDecision): void {
    if (this.maxEntries <= 0) return;
    this.entries.set(key, { decision, lastUsed: ++this.clock });
    this.prune();
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): TreeRingClusterVisibilityCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      evictions: this.evictions,
    };
  }

  private prune(): void {
    while (this.entries.size > this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestUsed = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
        if (entry.lastUsed < oldestUsed) {
          oldestUsed = entry.lastUsed;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      this.entries.delete(oldestKey);
      this.evictions++;
    }
  }
}

export function buildTreeRingClusterVisibilityMask(options: TreeRingClusterVisibilityOptions): TreeRingClusterVisibilityMask {
  const grid = treeGpuRingGrid(options.settings);
  const clusterDimCells = Math.max(1, Math.floor(options.clusterDimCells ?? TREE_RING_CLUSTER_DIM_CELLS));
  const clusterGrid = Math.max(1, Math.ceil(grid / clusterDimCells));
  const words = new Uint32Array(clusterGrid * clusterGrid);
  const activeSlots: number[] = [];
  const reasonCounts = createReasonCounts();
  const provider = createVegetationVisibilityProvider();
  const terrainSampler = createTerrainHeightSampler(options.sampler);
  const cacheEnabled = (options.cacheConfig?.decisionCacheEnabled ?? DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheEnabled) && !!options.cache;
  const cacheStatsBefore = options.cache?.stats() ?? null;
  let hiddenClusters = 0;
  let visibleClusters = 0;
  let unknownKeptClusters = 0;
  let skippedCandidateEstimate = 0;

  for (let clusterZ = 0; clusterZ < clusterGrid; clusterZ++) {
    for (let clusterX = 0; clusterX < clusterGrid; clusterX++) {
      const index = clusterIndex(clusterX, clusterZ, clusterGrid);
      const cacheKey = cacheEnabled ? treeRingClusterVisibilityCacheKey({ clusterX, clusterZ, grid, clusterDimCells, options }) : "";
      const result = cacheEnabled ? options.cache!.get(cacheKey) ?? evaluateAndCacheCluster({
        cache: options.cache!,
        cacheKey,
        clusterX,
        clusterZ,
        grid,
        clusterDimCells,
        provider,
        terrainSampler,
        options,
      }) : evaluateClusterVisibility({
        clusterX,
        clusterZ,
        grid,
        clusterDimCells,
        provider,
        terrainSampler,
        options,
      });
      const clusterSlots = slotsForCluster(clusterX, clusterZ, grid, clusterDimCells);
      reasonCounts[result.reason]++;
      if (result.reason === "unknown_kept") unknownKeptClusters++;
      words[index] = result.visible ? 1 : 0;
      if (result.visible) {
        visibleClusters++;
        activeSlots.push(...clusterSlots);
      } else {
        hiddenClusters++;
        skippedCandidateEstimate += clusterSlots.length;
      }
    }
  }

  const cacheStatsAfter = options.cache?.stats() ?? null;
  const candidateSlotsBeforePrefilter = grid * grid;
  return {
    grid,
    clusterDimCells,
    clusterGrid,
    words,
    activeSlotIndices: Uint32Array.from(activeSlots),
    hiddenClusters,
    visibleClusters,
    unknownKeptClusters,
    candidateSlotsBeforePrefilter,
    candidateSlotsAfterPrefilter: activeSlots.length,
    skippedCandidateEstimate,
    cacheHits: cacheStatsBefore && cacheStatsAfter ? cacheStatsAfter.hits - cacheStatsBefore.hits : 0,
    cacheMisses: cacheStatsBefore && cacheStatsAfter ? cacheStatsAfter.misses - cacheStatsBefore.misses : 0,
    reasonCounts,
  };
}

export function treeRingSlotClusterVisible(clusterMask: TreeRingClusterVisibilityMask | null | undefined, slot: number): boolean {
  if (!clusterMask) return true;
  const safeSlot = Math.max(0, Math.floor(slot));
  const slotX = safeSlot % clusterMask.grid;
  const slotZ = Math.floor(safeSlot / clusterMask.grid);
  const clusterX = Math.min(clusterMask.clusterGrid - 1, Math.floor(slotX / clusterMask.clusterDimCells));
  const clusterZ = Math.min(clusterMask.clusterGrid - 1, Math.floor(slotZ / clusterMask.clusterDimCells));
  return clusterMask.words[clusterIndex(clusterX, clusterZ, clusterMask.clusterGrid)] !== 0;
}

export function treeRingClusterMaskByteLength(settings: TreeSettings, clusterDimCells = TREE_RING_CLUSTER_DIM_CELLS): number {
  const grid = treeGpuRingGrid(settings);
  const clusterGrid = Math.max(1, Math.ceil(grid / Math.max(1, Math.floor(clusterDimCells))));
  return clusterGrid * clusterGrid * Uint32Array.BYTES_PER_ELEMENT;
}

function evaluateAndCacheCluster(input: {
  cache: TreeRingClusterVisibilityCache;
  cacheKey: string;
  clusterX: number;
  clusterZ: number;
  grid: number;
  clusterDimCells: number;
  provider: ReturnType<typeof createVegetationVisibilityProvider>;
  terrainSampler: TerrainHeightSampler | undefined;
  options: TreeRingClusterVisibilityOptions;
}): TreeRingClusterVisibilityDecision {
  const decision = evaluateClusterVisibility(input);
  input.cache.set(input.cacheKey, decision);
  return decision;
}

function evaluateClusterVisibility(input: {
  clusterX: number;
  clusterZ: number;
  grid: number;
  clusterDimCells: number;
  provider: ReturnType<typeof createVegetationVisibilityProvider>;
  terrainSampler: TerrainHeightSampler | undefined;
  options: TreeRingClusterVisibilityOptions;
}): TreeRingClusterVisibilityDecision {
  const probes = clusterProbes(input.clusterX, input.clusterZ, input.grid, input.clusterDimCells, input.options);
  let hiddenProbeCount = 0;
  for (const probe of probes) {
    const targetSample = input.terrainSampler?.sampleHeight(probe.x, probe.z);
    if (!targetSample || targetSample.unknown || !Number.isFinite(targetSample.height)) {
      return { visible: true, reason: "unknown_kept" };
    }
    const result = input.provider.sampleTerrainVisibility({
      sampler: input.terrainSampler,
      settings: {
        enabled: input.options.settings.gpu.enabled && input.options.settings.gpu.terrainVisibility.enabled,
        minDistanceM: input.options.settings.gpu.terrainVisibility.minDistanceM,
        sampleCount: input.options.settings.gpu.terrainVisibility.sampleCount,
        heightMarginM: input.options.settings.gpu.terrainVisibility.heightMarginM,
        crownHeightM: input.options.settings.gpu.terrainVisibility.crownHeightM,
      },
      cameraX: input.options.centerX,
      cameraY: input.options.cameraY,
      cameraZ: input.options.centerZ,
      targetX: probe.x,
      targetZ: probe.z,
      targetGroundY: targetSample.height,
      targetRadiusM: clusterRadiusM(input.clusterDimCells),
    });
    if (result.visible) return { visible: true, reason: result.reason };
    hiddenProbeCount++;
  }
  return hiddenProbeCount === probes.length
    ? { visible: false, reason: "terrain_hidden" }
    : { visible: true, reason: "visible" };
}

function clusterProbes(
  clusterX: number,
  clusterZ: number,
  grid: number,
  clusterDimCells: number,
  options: TreeRingClusterVisibilityOptions,
): ClusterProbe[] {
  const startX = clusterX * clusterDimCells;
  const startZ = clusterZ * clusterDimCells;
  const endX = Math.min(grid - 1, startX + clusterDimCells - 1);
  const endZ = Math.min(grid - 1, startZ + clusterDimCells - 1);
  const centerX = Math.min(grid - 1, startX + Math.floor((endX - startX) / 2));
  const centerZ = Math.min(grid - 1, startZ + Math.floor((endZ - startZ) / 2));
  const slotPairs: Array<readonly [number, number]> = [
    nearestSlotToCamera([[startX, startZ], [startX, endZ], [endX, startZ], [endX, endZ], [centerX, centerZ]], grid, options),
    [centerX, centerZ],
    [startX, startZ],
    [startX, endZ],
    [endX, startZ],
    [endX, endZ],
  ];
  const seen = new Set<string>();
  const probes: ClusterProbe[] = [];
  for (const [slotX, slotZ] of slotPairs) {
    const key = `${slotX}|${slotZ}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [cellX, cellZ] = treeWorldCell(slotX, slotZ, grid, TREE_GPU_RING_CELL, options.centerX, options.centerZ);
    probes.push({ x: cellX * TREE_GPU_RING_CELL, z: cellZ * TREE_GPU_RING_CELL });
  }
  return probes;
}

function nearestSlotToCamera(
  slots: Array<readonly [number, number]>,
  grid: number,
  options: TreeRingClusterVisibilityOptions,
): readonly [number, number] {
  let nearest = slots[0] ?? [0, 0];
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const [cellX, cellZ] = treeWorldCell(slot[0], slot[1], grid, TREE_GPU_RING_CELL, options.centerX, options.centerZ);
    const x = cellX * TREE_GPU_RING_CELL;
    const z = cellZ * TREE_GPU_RING_CELL;
    const dist = Math.hypot(x - options.centerX, z - options.centerZ);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = slot;
    }
  }
  return nearest;
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

function slotsForCluster(clusterX: number, clusterZ: number, grid: number, clusterDimCells: number): number[] {
  const startX = clusterX * clusterDimCells;
  const startZ = clusterZ * clusterDimCells;
  const endX = Math.min(grid - 1, startX + clusterDimCells - 1);
  const endZ = Math.min(grid - 1, startZ + clusterDimCells - 1);
  const slots: number[] = [];
  for (let slotZ = startZ; slotZ <= endZ; slotZ++) {
    for (let slotX = startX; slotX <= endX; slotX++) {
      slots.push(slotZ * grid + slotX);
    }
  }
  return slots;
}

function treeRingClusterVisibilityCacheKey(input: {
  clusterX: number;
  clusterZ: number;
  grid: number;
  clusterDimCells: number;
  options: TreeRingClusterVisibilityOptions;
}): string {
  const visibility = input.options.settings.gpu.terrainVisibility;
  const bucketM = input.options.cacheConfig?.cameraBucketM ?? DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.cameraBucketM;
  return [
    "tree",
    input.clusterX,
    input.clusterZ,
    input.grid,
    input.clusterDimCells,
    quantizeTerrainRejectionBucket(input.options.centerX, bucketM),
    quantizeTerrainRejectionBucket(input.options.centerZ, bucketM),
    quantizeTerrainRejectionBucket(input.options.cameraY, bucketM),
    Math.floor(input.options.worldCells),
    input.options.settings.seed,
    input.options.settings.distanceM,
    visibility.enabled ? 1 : 0,
    visibility.minDistanceM,
    visibility.sampleCount,
    visibility.heightMarginM,
    visibility.crownHeightM,
    input.options.terrainRevision ?? 0,
    input.options.providerRevision ?? 0,
  ].join("|");
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
