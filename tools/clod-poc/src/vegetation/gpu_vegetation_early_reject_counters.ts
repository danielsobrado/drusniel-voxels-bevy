import type { GrassStats } from "../grass.js";
import type { TreeStats } from "../trees/index.js";
import type { UnderstoryStats } from "../understory/index.js";

export interface GpuVegetationEarlyRejectCounters {
  vegetationGpuClustersTotal: number;
  vegetationGpuClustersRejectedEarly: number;
  vegetationGpuClustersAccepted: number;
  vegetationGpuClustersSummaryMissing: number;
  vegetationGpuClustersRevisionMismatch: number;
  vegetationGpuClustersFallbackAccepted: number;
  vegetationGpuFarSummaryConsulted: number;
  vegetationGpuSourceFarSummary: number;
  vegetationGpuSourceTerrainSampler: number;
  vegetationGpuSourceFallback: number;
  vegetationGpuCandidatesBudgetBeforeReject: number;
  vegetationGpuCandidatesBudgetAfterReject: number;
  vegetationGpuCandidatesGenerated: number;
  vegetationGpuRejectOutsideTerrain: number;
  vegetationGpuRejectTerrainHidden: number;
  vegetationGpuRejectNoCoverage: number;
  vegetationGpuRejectInvalidSurface: number;
  vegetationGpuRejectTooFar: number;
  vegetationGpuRejectBelowWater: number;
  vegetationGpuEarlyRejectMs: number;
  treeGpuClustersTotal: number;
  treeGpuClustersRejectedEarly: number;
  treeGpuClustersAccepted: number;
  treeGpuRejectTerrainHidden: number;
  treeGpuRejectNoCoverage: number;
  treeGpuRejectSummaryMissing: number;
  treeGpuPrefilterFarSummaryConsulted: number;
  treeGpuSourceFarSummary: number;
  treeGpuSourceTerrainSampler: number;
  treeGpuSourceFallback: number;
  grassGpuClustersTotal: number;
  grassGpuClustersRejectedEarly: number;
  grassGpuClustersAccepted: number;
  grassGpuRejectTerrainHidden: number;
  grassGpuRejectNoCoverage: number;
  grassGpuRejectSummaryMissing: number;
  grassGpuPrefilterFarSummaryConsulted: number;
  grassGpuSourceFarSummary: number;
  grassGpuSourceTerrainSampler: number;
  grassGpuSourceFallback: number;
  understoryGpuClustersTotal: number;
  understoryGpuClustersRejectedEarly: number;
  understoryGpuClustersAccepted: number;
  understoryGpuRejectTerrainHidden: number;
  understoryGpuRejectNoCoverage: number;
  understoryGpuRejectSummaryMissing: number;
  understoryGpuPrefilterFarSummaryConsulted: number;
  understoryGpuSourceFarSummary: number;
  understoryGpuSourceTerrainSampler: number;
  understoryGpuSourceFallback: number;
  "grassReject.wrong_biome": number;
  "grassReject.too_steep": number;
  "grassReject.below_water": number;
  "grassReject.height_range": number;
  "grassReject.outside_world": number;
  "grassReject.terrain_hidden": number;
  "grassReject.unknown_kept": number;
  "treeReject.wrong_biome": number;
  "treeReject.too_steep": number;
  "treeReject.below_water": number;
  "treeReject.height_range": number;
  "treeReject.outside_world": number;
  "treeReject.terrain_hidden": number;
  "understoryReject.wrong_biome": number;
  "understoryReject.too_steep": number;
  "understoryReject.below_water": number;
  "understoryReject.height_range": number;
  "understoryReject.outside_world": number;
  "understoryReject.terrain_hidden": number;
}

type GrassStatsWithConsulted = GrassStats & { gpuRingPrefilterFarSummaryConsulted?: number };
type UnderstoryStatsWithConsulted = UnderstoryStats & { gpuPrefilterFarSummaryConsulted?: number };

export function emptyGpuVegetationEarlyRejectCounters(): GpuVegetationEarlyRejectCounters {
  return {
    vegetationGpuClustersTotal: 0,
    vegetationGpuClustersRejectedEarly: 0,
    vegetationGpuClustersAccepted: 0,
    vegetationGpuClustersSummaryMissing: 0,
    vegetationGpuClustersRevisionMismatch: 0,
    vegetationGpuClustersFallbackAccepted: 0,
    vegetationGpuFarSummaryConsulted: 0,
    vegetationGpuSourceFarSummary: 0,
    vegetationGpuSourceTerrainSampler: 0,
    vegetationGpuSourceFallback: 0,
    vegetationGpuCandidatesBudgetBeforeReject: 0,
    vegetationGpuCandidatesBudgetAfterReject: 0,
    vegetationGpuCandidatesGenerated: 0,
    vegetationGpuRejectOutsideTerrain: 0,
    vegetationGpuRejectTerrainHidden: 0,
    vegetationGpuRejectNoCoverage: 0,
    vegetationGpuRejectInvalidSurface: 0,
    vegetationGpuRejectTooFar: 0,
    vegetationGpuRejectBelowWater: 0,
    vegetationGpuEarlyRejectMs: 0,
    treeGpuClustersTotal: 0,
    treeGpuClustersRejectedEarly: 0,
    treeGpuClustersAccepted: 0,
    treeGpuRejectTerrainHidden: 0,
    treeGpuRejectNoCoverage: 0,
    treeGpuRejectSummaryMissing: 0,
    treeGpuPrefilterFarSummaryConsulted: 0,
    treeGpuSourceFarSummary: 0,
    treeGpuSourceTerrainSampler: 0,
    treeGpuSourceFallback: 0,
    grassGpuClustersTotal: 0,
    grassGpuClustersRejectedEarly: 0,
    grassGpuClustersAccepted: 0,
    grassGpuRejectTerrainHidden: 0,
    grassGpuRejectNoCoverage: 0,
    grassGpuRejectSummaryMissing: 0,
    grassGpuPrefilterFarSummaryConsulted: 0,
    grassGpuSourceFarSummary: 0,
    grassGpuSourceTerrainSampler: 0,
    grassGpuSourceFallback: 0,
    understoryGpuClustersTotal: 0,
    understoryGpuClustersRejectedEarly: 0,
    understoryGpuClustersAccepted: 0,
    understoryGpuRejectTerrainHidden: 0,
    understoryGpuRejectNoCoverage: 0,
    understoryGpuRejectSummaryMissing: 0,
    understoryGpuPrefilterFarSummaryConsulted: 0,
    understoryGpuSourceFarSummary: 0,
    understoryGpuSourceTerrainSampler: 0,
    understoryGpuSourceFallback: 0,
    "grassReject.wrong_biome": 0,
    "grassReject.too_steep": 0,
    "grassReject.below_water": 0,
    "grassReject.height_range": 0,
    "grassReject.outside_world": 0,
    "grassReject.terrain_hidden": 0,
    "grassReject.unknown_kept": 0,
    "treeReject.wrong_biome": 0,
    "treeReject.too_steep": 0,
    "treeReject.below_water": 0,
    "treeReject.height_range": 0,
    "treeReject.outside_world": 0,
    "treeReject.terrain_hidden": 0,
    "understoryReject.wrong_biome": 0,
    "understoryReject.too_steep": 0,
    "understoryReject.below_water": 0,
    "understoryReject.height_range": 0,
    "understoryReject.outside_world": 0,
    "understoryReject.terrain_hidden": 0,
  };
}

export function aggregateGpuVegetationEarlyRejectCounters(input: {
  treeStats?: TreeStats | null;
  grassStats?: GrassStats | null;
  understoryStats?: UnderstoryStats | null;
}): GpuVegetationEarlyRejectCounters {
  const counters = emptyGpuVegetationEarlyRejectCounters();

  addTreeCounters(counters, input.treeStats ?? null);
  addGrassCounters(counters, input.grassStats ?? null);
  addUnderstoryCounters(counters, input.understoryStats ?? null);

  return counters;
}

function addTreeCounters(counters: GpuVegetationEarlyRejectCounters, tree: TreeStats | null): void {
  if (!tree) return;
  const total = tree.gpuPrefilterTestedClusters ?? 0;
  const rejected = tree.gpuPrefilterRejectedClusters ?? 0;
  const accepted = tree.gpuPrefilterAcceptedClusters ?? 0;
  const missing = tree.gpuPrefilterUnknownKeptClusters ?? 0;
  const farSummary = tree.gpuPrefilterSourceFarSummary ?? 0;
  const consulted = tree.gpuPrefilterFarSummaryConsulted ?? farSummary;
  const sampler = tree.gpuPrefilterSourceTerrainSampler ?? 0;
  const fallback = tree.gpuPrefilterSourceFallback ?? 0;

  counters.treeGpuClustersTotal += total;
  counters.treeGpuClustersRejectedEarly += rejected;
  counters.treeGpuClustersAccepted += accepted;
  counters.treeGpuRejectTerrainHidden += rejected;
  counters.treeGpuRejectSummaryMissing += missing;
  counters.treeGpuPrefilterFarSummaryConsulted += consulted;
  counters.treeGpuSourceFarSummary += farSummary;
  counters.treeGpuSourceTerrainSampler += sampler;
  counters.treeGpuSourceFallback += fallback;
  counters["treeReject.wrong_biome"] += tree.earlyTerrainBiomePatches ?? 0;
  counters["treeReject.too_steep"] += tree.earlyTerrainSteepPatches ?? 0;
  counters["treeReject.below_water"] += tree.earlyTerrainWaterPatches ?? 0;
  counters["treeReject.height_range"] += tree.earlyTerrainHeightPatches ?? 0;
  counters["treeReject.outside_world"] += tree.earlyTerrainOutsidePatches ?? 0;
  counters["treeReject.terrain_hidden"] += tree.earlyTerrainHiddenPatches ?? rejected;

  counters.vegetationGpuClustersTotal += total;
  counters.vegetationGpuClustersRejectedEarly += rejected;
  counters.vegetationGpuClustersAccepted += accepted;
  counters.vegetationGpuClustersSummaryMissing += missing;
  counters.vegetationGpuFarSummaryConsulted += consulted;
  counters.vegetationGpuSourceFarSummary += farSummary;
  counters.vegetationGpuSourceTerrainSampler += sampler;
  counters.vegetationGpuSourceFallback += fallback;
  counters.vegetationGpuCandidatesBudgetBeforeReject += tree.gpuCandidateCountBeforePrefilter ?? tree.gpuCandidateCount ?? 0;
  counters.vegetationGpuCandidatesBudgetAfterReject += tree.gpuCandidateCountAfterPrefilter ?? tree.gpuCandidateCount ?? 0;
  counters.vegetationGpuCandidatesGenerated += tree.gpuCandidateCount ?? 0;
  counters.vegetationGpuRejectTerrainHidden += rejected;
  counters.vegetationGpuRejectNoCoverage += tree.earlyTerrainBiomePatches ?? 0;
  counters.vegetationGpuRejectBelowWater += tree.earlyTerrainWaterPatches ?? 0;
  counters.vegetationGpuRejectOutsideTerrain += tree.earlyTerrainOutsidePatches ?? 0;
}

function addGrassCounters(counters: GpuVegetationEarlyRejectCounters, grass: GrassStats | null): void {
  if (!grass) return;
  const grassWithConsulted = grass as GrassStatsWithConsulted;
  const before = grass.gpuRingCandidateCountBeforePrefilter ?? grass.gpuRingCandidateCount ?? 0;
  const after = grass.gpuRingCandidateCountAfterPrefilter ?? grass.gpuRingCandidateCount ?? 0;
  const total = grass.gpuRingPrefilterTestedClusters ?? estimateClusterCount(before, after);
  const rejected = grass.gpuRingPrefilterRejectedClusters ?? Math.max(0, total - (grass.gpuRingPrefilterAcceptedClusters ?? total));
  const accepted = grass.gpuRingPrefilterAcceptedClusters ?? Math.max(0, total - rejected);
  const missing = grass.gpuRingPrefilterUnknownKeptClusters ?? 0;
  const reasonCounts = grass.earlyTerrainReasonCounts ?? {};
  const wrongBiome = reasonCounts.wrong_biome ?? 0;
  const tooSteep = reasonCounts.too_steep ?? 0;
  const belowWater = reasonCounts.below_water ?? 0;
  const heightRange = reasonCounts.height_range ?? 0;
  const outsideWorld = reasonCounts.outside_world ?? 0;
  const unknownKept = reasonCounts.unknown_kept ?? 0;
  const terrainHidden = reasonCounts.terrain_hidden ?? rejected;
  const farSummary = grass.gpuRingPrefilterSourceFarSummary ?? 0;
  const consulted = grassWithConsulted.gpuRingPrefilterFarSummaryConsulted ?? farSummary;
  const sampler = grass.gpuRingPrefilterSourceTerrainSampler ?? 0;
  const fallback = grass.gpuRingPrefilterSourceFallback ?? 0;

  counters.grassGpuClustersTotal += total;
  counters.grassGpuClustersRejectedEarly += rejected;
  counters.grassGpuClustersAccepted += accepted;
  counters.grassGpuRejectTerrainHidden += terrainHidden;
  counters.grassGpuRejectNoCoverage += wrongBiome;
  counters.grassGpuRejectSummaryMissing += missing;
  counters.grassGpuPrefilterFarSummaryConsulted += consulted;
  counters.grassGpuSourceFarSummary += farSummary;
  counters.grassGpuSourceTerrainSampler += sampler;
  counters.grassGpuSourceFallback += fallback;
  counters["grassReject.wrong_biome"] += wrongBiome;
  counters["grassReject.too_steep"] += tooSteep;
  counters["grassReject.below_water"] += belowWater;
  counters["grassReject.height_range"] += heightRange;
  counters["grassReject.outside_world"] += outsideWorld;
  counters["grassReject.terrain_hidden"] += terrainHidden;
  counters["grassReject.unknown_kept"] += unknownKept;

  counters.vegetationGpuClustersTotal += total;
  counters.vegetationGpuClustersRejectedEarly += rejected;
  counters.vegetationGpuClustersAccepted += accepted;
  counters.vegetationGpuClustersSummaryMissing += missing;
  counters.vegetationGpuFarSummaryConsulted += consulted;
  counters.vegetationGpuSourceFarSummary += farSummary;
  counters.vegetationGpuSourceTerrainSampler += sampler;
  counters.vegetationGpuSourceFallback += fallback;
  counters.vegetationGpuCandidatesBudgetBeforeReject += before;
  counters.vegetationGpuCandidatesBudgetAfterReject += after;
  counters.vegetationGpuCandidatesGenerated += grass.generatedCandidates ?? 0;
  counters.vegetationGpuRejectTerrainHidden += terrainHidden;
  counters.vegetationGpuRejectNoCoverage += wrongBiome;
  counters.vegetationGpuRejectBelowWater += belowWater;
  counters.vegetationGpuRejectOutsideTerrain += outsideWorld;
  counters.vegetationGpuRejectInvalidSurface += heightRange + tooSteep;
}

function addUnderstoryCounters(counters: GpuVegetationEarlyRejectCounters, understory: UnderstoryStats | null): void {
  if (!understory) return;
  const understoryWithConsulted = understory as UnderstoryStatsWithConsulted;
  const before = understory.gpuCandidateCountBeforePrefilter ?? understory.gpuCandidateCount ?? 0;
  const after = understory.gpuCandidateCountAfterPrefilter ?? understory.gpuCandidateCount ?? 0;
  const total = understory.gpuPrefilterTestedClusters ?? estimateClusterCount(before, after);
  const rejected = understory.gpuPrefilterRejectedClusters ?? Math.max(0, total - (understory.gpuPrefilterAcceptedClusters ?? total));
  const accepted = understory.gpuPrefilterAcceptedClusters ?? Math.max(0, total - rejected);
  const missing = understory.gpuPrefilterUnknownKeptClusters ?? 0;
  const reasonCounts = understory.earlyTerrainReasonCounts ?? {};
  const wrongBiome = reasonCounts.wrong_biome ?? 0;
  const tooSteep = reasonCounts.too_steep ?? 0;
  const belowWater = reasonCounts.below_water ?? 0;
  const heightRange = reasonCounts.height_range ?? 0;
  const outsideWorld = reasonCounts.outside_world ?? 0;
  const terrainHidden = reasonCounts.terrain_hidden ?? rejected;
  const farSummary = understory.gpuPrefilterSourceFarSummary ?? 0;
  const consulted = understoryWithConsulted.gpuPrefilterFarSummaryConsulted ?? farSummary;
  const sampler = understory.gpuPrefilterSourceTerrainSampler ?? 0;
  const fallback = understory.gpuPrefilterSourceFallback ?? 0;

  counters.understoryGpuClustersTotal += total;
  counters.understoryGpuClustersRejectedEarly += rejected;
  counters.understoryGpuClustersAccepted += accepted;
  counters.understoryGpuRejectTerrainHidden += terrainHidden;
  counters.understoryGpuRejectNoCoverage += wrongBiome;
  counters.understoryGpuRejectSummaryMissing += missing;
  counters.understoryGpuPrefilterFarSummaryConsulted += consulted;
  counters.understoryGpuSourceFarSummary += farSummary;
  counters.understoryGpuSourceTerrainSampler += sampler;
  counters.understoryGpuSourceFallback += fallback;
  counters["understoryReject.wrong_biome"] += wrongBiome;
  counters["understoryReject.too_steep"] += tooSteep;
  counters["understoryReject.below_water"] += belowWater;
  counters["understoryReject.height_range"] += heightRange;
  counters["understoryReject.outside_world"] += outsideWorld;
  counters["understoryReject.terrain_hidden"] += terrainHidden;

  counters.vegetationGpuClustersTotal += total;
  counters.vegetationGpuClustersRejectedEarly += rejected;
  counters.vegetationGpuClustersAccepted += accepted;
  counters.vegetationGpuClustersSummaryMissing += missing;
  counters.vegetationGpuFarSummaryConsulted += consulted;
  counters.vegetationGpuSourceFarSummary += farSummary;
  counters.vegetationGpuSourceTerrainSampler += sampler;
  counters.vegetationGpuSourceFallback += fallback;
  counters.vegetationGpuCandidatesBudgetBeforeReject += before;
  counters.vegetationGpuCandidatesBudgetAfterReject += after;
  counters.vegetationGpuCandidatesGenerated += understory.gpuCandidateCount ?? 0;
  counters.vegetationGpuRejectTerrainHidden += terrainHidden;
  counters.vegetationGpuRejectNoCoverage += wrongBiome;
  counters.vegetationGpuRejectBelowWater += belowWater;
  counters.vegetationGpuRejectOutsideTerrain += outsideWorld;
  counters.vegetationGpuRejectInvalidSurface += heightRange + tooSteep;
}

function estimateClusterCount(before: number, after: number): number {
  if (before <= 0 && after <= 0) return 0;
  return Math.max(1, Math.ceil(Math.max(before, after) / (16 * 16)));
}
