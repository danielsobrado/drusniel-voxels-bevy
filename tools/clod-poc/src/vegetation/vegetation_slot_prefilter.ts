import {
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG,
  resolveVegetationTerrainRejectionConfig,
  type VegetationTerrainRejectionConfig,
} from "./terrain_rejection_config.js";
import { quantizeTerrainRejectionBucket } from "./terrain_rejection_cache.js";
import {
  type TerrainHeightSampler,
  type TerrainVisibilitySettings,
  type VegetationVisibilityReason,
} from "./vegetation_visibility_provider.js";
import {
  createVegetationTerrainRejectProvider,
  type VegetationTerrainRejectProvider,
  type VegetationTerrainRejectReason,
  type VegetationTerrainRejectSource,
} from "./vegetation_terrain_reject_provider.js";
import type { VegetationClusterDescriptor, VegetationKind } from "./vegetation_cluster_descriptors.js";

export interface VegetationSlotPrefilterOptions {
  kind: string;
  centerX: number;
  centerZ: number;
  cameraY: number;
  worldCells: number;
  /** Infinite/island world: skip the [0, worldCells] box reject (terrain exists past the box). */
  unbounded?: boolean;
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
  farSummaryConsultedClusters: number;
  skippedCandidateEstimate: number;
  cacheHits: number;
  cacheMisses: number;
  reasonCounts: Record<VegetationVisibilityReason, number>;
  providerReasonCounts: Record<VegetationTerrainRejectReason, number>;
  sourceCounts: Record<VegetationTerrainRejectSource, number>;
}

export interface VegetationSlotPrefilterDecision {
  visible: boolean;
  reason: VegetationVisibilityReason;
  providerReason: VegetationTerrainRejectReason;
  source: VegetationTerrainRejectSource;
  farSummaryConsulted: boolean;
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
  const candidateSlotsBeforePrefilter = grid * grid;
  const runtimeConfig = resolveVegetationTerrainRejectionConfig();
  if (
    !runtimeConfig.enabled ||
    !runtimeConfig.gpuEarlyReject.enabled ||
    !runtimeConfig.viewRulesEnabled ||
    !kindEnabled(options.kind, runtimeConfig) ||
    clusterSizeM(options.cell, clusterDimSlots) < runtimeConfig.gpuEarlyReject.minClusterSize
  ) {
    return fullVisibilityPrefilterResult(grid, clusterDimSlots, clusterGrid, candidateSlotsBeforePrefilter);
  }

  const clusterWords = new Uint32Array(clusterGrid * clusterGrid);
  const activeSlotScratch = new Uint32Array(candidateSlotsBeforePrefilter);
  const provider = createVegetationTerrainRejectProvider();
  const reasonCounts = createReasonCounts();
  const providerReasonCounts = createProviderReasonCounts();
  const sourceCounts = createSourceCounts();
  const cacheEnabled = (options.cacheConfig?.decisionCacheEnabled ?? runtimeConfig.decisionCacheEnabled) && !!options.cache;
  const cacheStatsBefore = options.cache?.stats() ?? null;
  let activeSlotCount = 0;
  let rejectedClusters = 0;
  let visibleClusters = 0;
  let unknownKeptClusters = 0;
  let farSummaryConsultedClusters = 0;
  let skippedCandidateEstimate = 0;

  for (let clusterZ = 0; clusterZ < clusterGrid; clusterZ++) {
    for (let clusterX = 0; clusterX < clusterGrid; clusterX++) {
      const clusterIndex = clusterZ * clusterGrid + clusterX;
      const cacheKey = cacheEnabled ? slotPrefilterCacheKey({ clusterX, clusterZ, grid, clusterDimSlots, options }) : "";
      const decision = cacheEnabled
        ? options.cache!.get(cacheKey) ?? evaluateAndCache({ cache: options.cache!, cacheKey, clusterX, clusterZ, grid, clusterDimSlots, provider, options, runtimeConfig })
        : evaluateCluster({ clusterX, clusterZ, grid, clusterDimSlots, provider, options, runtimeConfig });
      reasonCounts[decision.reason]++;
      providerReasonCounts[decision.providerReason]++;
      sourceCounts[decision.source]++;
      if (decision.farSummaryConsulted) farSummaryConsultedClusters++;
      if (decision.reason === "unknown_kept" || decision.providerReason === "summaryMissing") unknownKeptClusters++;
      clusterWords[clusterIndex] = decision.visible ? 1 : 0;
      if (decision.visible) {
        visibleClusters++;
        activeSlotCount = appendClusterSlots(activeSlotScratch, activeSlotCount, clusterX, clusterZ, grid, clusterDimSlots);
      } else {
        rejectedClusters++;
        skippedCandidateEstimate += clusterSlotCount(clusterX, clusterZ, grid, clusterDimSlots);
      }
    }
  }

  const cacheStatsAfter = options.cache?.stats() ?? null;
  return {
    grid,
    clusterDimSlots,
    clusterGrid,
    clusterWords,
    activeSlotIndices: activeSlotScratch.subarray(0, activeSlotCount),
    candidateSlotsBeforePrefilter,
    candidateSlotsAfterPrefilter: activeSlotCount,
    rejectedClusters,
    visibleClusters,
    unknownKeptClusters,
    farSummaryConsultedClusters,
    skippedCandidateEstimate,
    cacheHits: cacheStatsBefore && cacheStatsAfter ? cacheStatsAfter.hits - cacheStatsBefore.hits : 0,
    cacheMisses: cacheStatsBefore && cacheStatsAfter ? cacheStatsAfter.misses - cacheStatsBefore.misses : 0,
    reasonCounts,
    providerReasonCounts,
    sourceCounts,
  };
}

function evaluateAndCache(input: {
  cache: VegetationSlotPrefilterCache;
  cacheKey: string;
  clusterX: number;
  clusterZ: number;
  grid: number;
  clusterDimSlots: number;
  provider: VegetationTerrainRejectProvider;
  options: VegetationSlotPrefilterOptions;
  runtimeConfig: VegetationTerrainRejectionConfig;
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
  provider: VegetationTerrainRejectProvider;
  options: VegetationSlotPrefilterOptions;
  runtimeConfig: VegetationTerrainRejectionConfig;
}): VegetationSlotPrefilterDecision {
  if (!input.options.visibility.enabled) {
    return { visible: true, reason: "disabled", providerReason: "accepted", source: "conservativeFallback", farSummaryConsulted: false };
  }

  const probes = clusterProbes(input.clusterX, input.clusterZ, input.grid, input.clusterDimSlots, input.options);
  let hiddenProbeCount = 0;
  let lastProviderReason: VegetationTerrainRejectReason = "accepted";
  let lastSource: VegetationTerrainRejectSource = "conservativeFallback";
  let farSummaryConsulted = false;
  for (const probe of probes) {
    const decision = input.provider.classifyCluster({
      descriptor: clusterDescriptorForProbe(input, probe),
      kind: normalizeKind(input.options.kind),
      cameraX: input.options.centerX,
      cameraY: input.options.cameraY,
      cameraZ: input.options.centerZ,
      worldCells: input.options.worldCells,
      unbounded: input.options.unbounded,
      visibility: input.options.visibility,
      sampler: input.options.sampler,
      terrainRevision: input.options.terrainRevision,
      providerRevision: input.options.providerRevision,
      acceptWhenSummaryMissing: input.runtimeConfig.gpuEarlyReject.conservative.acceptWhenSummaryMissing,
      acceptWhenRevisionMismatch: input.runtimeConfig.gpuEarlyReject.conservative.acceptWhenRevisionMismatch,
    });
    farSummaryConsulted ||= decision.farSummaryConsulted === true;
    lastProviderReason = decision.reason;
    lastSource = decision.source;
    if (!decision.reject) {
      return { visible: true, reason: sourceReason(decision), providerReason: decision.reason, source: decision.source, farSummaryConsulted };
    }
    hiddenProbeCount++;
  }
  return hiddenProbeCount === probes.length
    ? { visible: false, reason: sourceReasonFromProvider(lastProviderReason), providerReason: lastProviderReason, source: lastSource, farSummaryConsulted }
    : { visible: true, reason: "visible", providerReason: "accepted", source: lastSource, farSummaryConsulted };
}

function fullVisibilityPrefilterResult(
  grid: number,
  clusterDimSlots: number,
  clusterGrid: number,
  candidateSlotsBeforePrefilter: number,
): VegetationSlotPrefilterResult {
  const activeSlotIndices = new Uint32Array(candidateSlotsBeforePrefilter);
  for (let i = 0; i < activeSlotIndices.length; i++) activeSlotIndices[i] = i;
  const clusterWords = new Uint32Array(clusterGrid * clusterGrid);
  clusterWords.fill(1);
  const reasonCounts = createReasonCounts();
  reasonCounts.disabled = clusterWords.length;
  const providerReasonCounts = createProviderReasonCounts();
  providerReasonCounts.accepted = clusterWords.length;
  const sourceCounts = createSourceCounts();
  sourceCounts.conservativeFallback = clusterWords.length;
  return {
    grid,
    clusterDimSlots,
    clusterGrid,
    clusterWords,
    activeSlotIndices,
    candidateSlotsBeforePrefilter,
    candidateSlotsAfterPrefilter: candidateSlotsBeforePrefilter,
    rejectedClusters: 0,
    visibleClusters: clusterWords.length,
    unknownKeptClusters: 0,
    farSummaryConsultedClusters: 0,
    skippedCandidateEstimate: 0,
    cacheHits: 0,
    cacheMisses: 0,
    reasonCounts,
    providerReasonCounts,
    sourceCounts,
  };
}

function clusterDescriptorForProbe(input: {
  clusterX: number;
  clusterZ: number;
  clusterDimSlots: number;
  options: VegetationSlotPrefilterOptions;
}, probe: SlotProbe): VegetationClusterDescriptor {
  const radius = clusterRadiusM(input.options.cell, input.clusterDimSlots);
  return {
    id: input.clusterZ * 65536 + input.clusterX,
    kind: normalizeKind(input.options.kind),
    ring: 0,
    pageX: input.clusterX,
    pageZ: input.clusterZ,
    centerX: probe.x,
    centerZ: probe.z,
    halfSize: radius,
    minY: Number.NEGATIVE_INFINITY,
    maxY: Number.POSITIVE_INFINITY,
    seed: 0,
    densityBudget: Math.max(1, input.clusterDimSlots * input.clusterDimSlots),
    terrainRevision: input.options.terrainRevision ?? 0,
  };
}

function sourceReason(decision: ReturnType<VegetationTerrainRejectProvider["classifyCluster"]>): VegetationVisibilityReason {
  return decision.sourceReason ?? sourceReasonFromProvider(decision.reason);
}

function sourceReasonFromProvider(reason: VegetationTerrainRejectReason): VegetationVisibilityReason {
  if (reason === "terrainHidden") return "terrain_hidden";
  if (reason === "summaryMissing") return "unknown_kept";
  if (reason === "accepted") return "visible";
  return "terrain_hidden";
}

function normalizeKind(kind: string): VegetationKind {
  if (kind === "tree" || kind === "grass" || kind === "understory") return kind;
  return "grass";
}

function kindEnabled(kind: string, config: VegetationTerrainRejectionConfig): boolean {
  const normalized = normalizeKind(kind);
  if (normalized === "tree") return config.gpuEarlyReject.rejectKinds.trees;
  if (normalized === "grass") return config.gpuEarlyReject.rejectKinds.grass;
  return config.gpuEarlyReject.rejectKinds.understory;
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

function appendClusterSlots(target: Uint32Array, offset: number, clusterX: number, clusterZ: number, grid: number, clusterDimSlots: number): number {
  const startX = clusterX * clusterDimSlots;
  const startZ = clusterZ * clusterDimSlots;
  const endX = Math.min(grid - 1, startX + clusterDimSlots - 1);
  const endZ = Math.min(grid - 1, startZ + clusterDimSlots - 1);
  let cursor = offset;
  for (let slotZ = startZ; slotZ <= endZ; slotZ++) {
    const rowStart = slotZ * grid;
    for (let slotX = startX; slotX <= endX; slotX++) target[cursor++] = rowStart + slotX;
  }
  return cursor;
}

function clusterSlotCount(clusterX: number, clusterZ: number, grid: number, clusterDimSlots: number): number {
  const startX = clusterX * clusterDimSlots;
  const startZ = clusterZ * clusterDimSlots;
  const endX = Math.min(grid - 1, startX + clusterDimSlots - 1);
  const endZ = Math.min(grid - 1, startZ + clusterDimSlots - 1);
  return Math.max(0, endX - startX + 1) * Math.max(0, endZ - startZ + 1);
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

function clusterSizeM(cell: number, clusterDimSlots: number): number {
  return Math.max(0.001, cell) * Math.max(1, clusterDimSlots);
}

function clusterRadiusM(cell: number, clusterDimSlots: number): number {
  return Math.SQRT2 * clusterSizeM(cell, clusterDimSlots) * 0.5;
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

function createProviderReasonCounts(): Record<VegetationTerrainRejectReason, number> {
  return {
    outsideTerrain: 0,
    terrainHidden: 0,
    belowWaterOrInvalid: 0,
    tooFarForKind: 0,
    noCoverage: 0,
    summaryMissing: 0,
    accepted: 0,
  };
}

function createSourceCounts(): Record<VegetationTerrainRejectSource, number> {
  return {
    naadfFarSummary: 0,
    terrainVisibilitySampler: 0,
    conservativeFallback: 0,
  };
}
