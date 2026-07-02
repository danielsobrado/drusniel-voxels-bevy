import {
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG,
  type VegetationTerrainRejectionConfig,
} from "./terrain_rejection_config.js";
import { quantizeTerrainRejectionBucket } from "./terrain_rejection_cache.js";
import {
  createVegetationVisibilityProvider,
  type TerrainHeightSampler,
  type TerrainVisibilitySettings,
  type VegetationVisibilityReason,
} from "./vegetation_visibility_provider.js";

export interface VegetationSlotPrefilterOptions {
  kind: string;
  centerX: number;
  centerZ: number;
  cameraY: number;
  worldCells: number;
  grid: number;
  cell: number;
  clusterDimSlots: number;
  visibility: TerrainVisibilitySettings;
  sampler?: TerrainHeightSampler;
  terrainRevision?: number;
  providerRevision?: number;
  cache?: VegetationSlotPrefilterCache;
  cacheConfig?: Pick<VegetationTerrainRejectionConfig, "decisionCacheEnabled" | "cameraBucketM">;
}

export interface VegetationSlotPrefilterResult {
  grid: number;
  clusterDimSlots: number;
  clusterGrid: number;
  clusterWords: Uint32Array;
  activeSlotIndices: Uint32Array;
  candidateSlotsBeforePrefilter: number;
  candidateSlotsAfterPrefilter: number;
  rejectedClusters: number;
  visibleClusters: number;
  unknownKeptClusters: number;
  skippedCandidateEstimate: number;
  cacheHits: number;
  cacheMisses: number;
  reasonCounts: Record<VegetationVisibilityReason, number>;
}

export interface VegetationSlotPrefilterDecision {
  visible: boolean;
  reason: VegetationVisibilityReason;
}

interface CacheEntry {
  decision: VegetationSlotPrefilterDecision;
  lastUsed: number;
}

interface SlotProbe {
  x: number;
  z: number;
}

export class VegetationSlotPrefilterCache {
  private readonly entries = new Map<string, CacheEntry>();
  private clock = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly maxEntries = DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheMaxEntries) {}

  get(key: string): VegetationSlotPrefilterDecision | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    this.hits++;
    entry.lastUsed = ++this.clock;
    return entry.decision;
  }

  set(key: string, decision: VegetationSlotPrefilterDecision): void {
    if (this.maxEntries <= 0) return;
    this.entries.set(key, { decision, lastUsed: ++this.clock });
    this.prune();
  }

  clear(): void {
    this.entries.clear();
    this.clock = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  stats(): { hits: number; misses: number; entries: number; evictions: number } {
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

export function buildVegetationSlotPrefilter(options: VegetationSlotPrefilterOptions): VegetationSlotPrefilterResult {
  const grid = Math.max(1, Math.floor(options.grid));
  const clusterDimSlots = Math.max(1, Math.floor(options.clusterDimSlots));
  const clusterGrid = Math.max(1, Math.ceil(grid / clusterDimSlots));
  const clusterWords = new Uint32Array(clusterGrid * clusterGrid);
  const activeSlots: number[] = [];
  const provider = createVegetationVisibilityProvider();
  const reasonCounts = createReasonCounts();
  const cacheEnabled = (options.cacheConfig?.decisionCacheEnabled ?? DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheEnabled) && !!options.cache;
  const cacheStatsBefore = options.cache?.stats() ?? null;
  let rejectedClusters = 0;
  let visibleClusters = 0;
  let unknownKeptClusters = 0;
  let skippedCandidateEstimate = 0;

  for (let clusterZ = 0; clusterZ < clusterGrid; clusterZ++) {
    for (let clusterX = 0; clusterX < clusterGrid; clusterX++) {
      const clusterIndex = clusterZ * clusterGrid + clusterX;
      const cacheKey = cacheEnabled ? slotPrefilterCacheKey({ clusterX, clusterZ, grid, clusterDimSlots, options }) : "";
      const decision = cacheEnabled
        ? options.cache!.get(cacheKey) ?? evaluateAndCache({ cache: options.cache!, cacheKey, clusterX, clusterZ, grid, clusterDimSlots, provider, options })
        : evaluateCluster({ clusterX, clusterZ, grid, clusterDimSlots, provider, options });
      const slots = slotsForCluster(clusterX, clusterZ, grid, clusterDimSlots);
      reasonCounts[decision.reason]++;
      if (decision.reason === "unknown_kept") unknownKeptClusters++;
      clusterWords[clusterIndex] = decision.visible ? 1 : 0;
      if (decision.visible) {
        visibleClusters++;
        activeSlots.push(...slots);
      } else {
        rejectedClusters++;
        skippedCandidateEstimate += slots.length;
      }
    }
  }

  const candidateSlotsBeforePrefilter = grid * grid;
  const cacheStatsAfter = options.cache?.stats() ?? null;
  return {
    grid,
    clusterDimSlots,
    clusterGrid,
    clusterWords,
    activeSlotIndices: Uint32Array.from(activeSlots),
    candidateSlotsBeforePrefilter,
    candidateSlotsAfterPrefilter: activeSlots.length,
    rejectedClusters,
    visibleClusters,
    unknownKeptClusters,
    skippedCandidateEstimate,
    cacheHits: cacheStatsBefore && cacheStatsAfter ? cacheStatsAfter.hits - cacheStatsBefore.hits : 0,
    cacheMisses: cacheStatsBefore && cacheStatsAfter ? cacheStatsAfter.misses - cacheStatsBefore.misses : 0,
    reasonCounts,
  };
}

function evaluateAndCache(input: {
  cache: VegetationSlotPrefilterCache;
  cacheKey: string;
  clusterX: number;
  clusterZ: number;
  grid: number;
  clusterDimSlots: number;
  provider: ReturnType<typeof createVegetationVisibilityProvider>;
  options: VegetationSlotPrefilterOptions;
}): VegetationSlotPrefilterDecision {
  const decision = evaluateCluster(input);
  input.cache.set(input.cacheKey, decision);
  return decision;
}

function evaluateCluster(input: {
  clusterX: number;
  clusterZ: number;
  grid: number;
  clusterDimSlots: number;
  provider: ReturnType<typeof createVegetationVisibilityProvider>;
  options: VegetationSlotPrefilterOptions;
}): VegetationSlotPrefilterDecision {
  if (!input.options.visibility.enabled) return { visible: true, reason: "disabled" };
  if (!input.options.sampler) return { visible: true, reason: "unknown_kept" };

  const probes = clusterProbes(input.clusterX, input.clusterZ, input.grid, input.clusterDimSlots, input.options);
  let hiddenProbeCount = 0;
  for (const probe of probes) {
    const targetSample = input.options.sampler.sampleHeight(probe.x, probe.z);
    if (!targetSample || targetSample.unknown || !Number.isFinite(targetSample.height)) {
      return { visible: true, reason: "unknown_kept" };
    }
    const result = input.provider.sampleTerrainVisibility({
      sampler: input.options.sampler,
      settings: input.options.visibility,
      cameraX: input.options.centerX,
      cameraY: input.options.cameraY,
      cameraZ: input.options.centerZ,
      targetX: probe.x,
      targetZ: probe.z,
      targetGroundY: targetSample.height,
      targetRadiusM: clusterRadiusM(input.options.cell, input.clusterDimSlots),
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
  clusterDimSlots: number,
  options: VegetationSlotPrefilterOptions,
): SlotProbe[] {
  const startX = clusterX * clusterDimSlots;
  const startZ = clusterZ * clusterDimSlots;
  const endX = Math.min(grid - 1, startX + clusterDimSlots - 1);
  const endZ = Math.min(grid - 1, startZ + clusterDimSlots - 1);
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
  const result: SlotProbe[] = [];
  for (const [slotX, slotZ] of slotPairs) {
    const key = `${slotX}|${slotZ}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [cellX, cellZ] = vegetationWorldCell(slotX, slotZ, grid, options.cell, options.centerX, options.centerZ);
    result.push({ x: cellX * options.cell, z: cellZ * options.cell });
  }
  return result;
}

function nearestSlotToCamera(
  slots: Array<readonly [number, number]>,
  grid: number,
  options: VegetationSlotPrefilterOptions,
): readonly [number, number] {
  let nearest = slots[0] ?? [0, 0];
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const [cellX, cellZ] = vegetationWorldCell(slot[0], slot[1], grid, options.cell, options.centerX, options.centerZ);
    const dist = Math.hypot(cellX * options.cell - options.centerX, cellZ * options.cell - options.centerZ);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = slot;
    }
  }
  return nearest;
}

function slotsForCluster(clusterX: number, clusterZ: number, grid: number, clusterDimSlots: number): number[] {
  const startX = clusterX * clusterDimSlots;
  const startZ = clusterZ * clusterDimSlots;
  const endX = Math.min(grid - 1, startX + clusterDimSlots - 1);
  const endZ = Math.min(grid - 1, startZ + clusterDimSlots - 1);
  const slots: number[] = [];
  for (let slotZ = startZ; slotZ <= endZ; slotZ++) {
    for (let slotX = startX; slotX <= endX; slotX++) slots.push(slotZ * grid + slotX);
  }
  return slots;
}

function vegetationWorldCell(slotX: number, slotZ: number, grid: number, cell: number, centerX: number, centerZ: number): readonly [number, number] {
  const safeGrid = Math.max(1, Math.floor(grid));
  const safeCell = Math.max(0.001, cell);
  const camCellX = centerX / safeCell;
  const camCellZ = centerZ / safeCell;
  return [
    Math.round((camCellX - slotX) / safeGrid) * safeGrid + slotX,
    Math.round((camCellZ - slotZ) / safeGrid) * safeGrid + slotZ,
  ];
}

function slotPrefilterCacheKey(input: {
  clusterX: number;
  clusterZ: number;
  grid: number;
  clusterDimSlots: number;
  options: VegetationSlotPrefilterOptions;
}): string {
  const bucketM = input.options.cacheConfig?.cameraBucketM ?? DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.cameraBucketM;
  const visibility = input.options.visibility;
  return [
    input.options.kind,
    input.clusterX,
    input.clusterZ,
    input.grid,
    input.clusterDimSlots,
    input.options.cell,
    quantizeTerrainRejectionBucket(input.options.centerX, bucketM),
    quantizeTerrainRejectionBucket(input.options.centerZ, bucketM),
    quantizeTerrainRejectionBucket(input.options.cameraY, bucketM),
    Math.floor(input.options.worldCells),
    visibility.enabled ? 1 : 0,
    visibility.minDistanceM,
    visibility.sampleCount,
    visibility.heightMarginM,
    visibility.crownHeightM,
    input.options.terrainRevision ?? 0,
    input.options.providerRevision ?? 0,
  ].join("|");
}

function clusterRadiusM(cell: number, clusterDimSlots: number): number {
  return Math.SQRT2 * Math.max(0.001, cell) * Math.max(1, clusterDimSlots) * 0.5;
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
