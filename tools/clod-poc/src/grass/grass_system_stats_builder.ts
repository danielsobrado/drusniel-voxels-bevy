import type { GrassGpuRingStats } from "../gpu/grass_ring_compute.js";
import type { GrassShaderMode, GrassTier } from "./grass_config.js";
import type { GrassGenerationStats, GrassStats } from "./grass_stats.js";
import type { GrassPatch } from "./grass_system_support.js";

export interface BuildGrassStatsInput {
  mode: GrassShaderMode;
  ringMode: boolean;
  activeGpu: boolean;
  patches: readonly GrassPatch[];
  ringMeshes: readonly { visible: boolean }[];
  ringTierCounts: Record<GrassTier, number>;
  ringBladeCount: number;
  bladeCount: number;
  generationStats: GrassGenerationStats;
  patchRebuildCount: number;
  buildMs: number;
  gpuRingStats: GrassGpuRingStats;
}

export function buildGrassStats(input: BuildGrassStatsInput): GrassStats {
  if (input.ringMode) {
    return buildRingStats(input);
  }
  return buildPatchStats(input);
}

function buildRingStats(input: BuildGrassStatsInput): GrassStats {
  const visiblePatches = input.activeGpu ? input.ringMeshes.filter((mesh) => mesh.visible).length : 0;
  const patchCount = input.activeGpu ? input.ringMeshes.length : input.patches.length;
  const gpu = input.gpuRingStats;
  return {
    mode: input.mode,
    blades: input.activeGpu ? input.ringBladeCount : input.bladeCount,
    patches: patchCount,
    visiblePatches,
    culledPatches: patchCount - visiblePatches,
    nearPatches: input.activeGpu ? (input.ringTierCounts.near > 0 ? 1 : 0) : input.patches.filter((p) => p.visibleTier === "near").length,
    midPatches: input.activeGpu ? (input.ringTierCounts.mid > 0 ? 1 : 0) : input.patches.filter((p) => p.visibleTier === "mid").length,
    coveragePatches: input.activeGpu ? (input.ringTierCounts.far > 0 ? 1 : 0) : input.patches.filter((p) => p.visibleTier === "far").length,
    superPatches: input.activeGpu ? (input.ringTierCounts.super > 0 ? 1 : 0) : input.patches.filter((p) => p.visibleTier === "super").length,
    generatedCandidates: gpu.generatedCandidates,
    acceptedCandidates: gpu.acceptedCandidates,
    edgeSuppressedCandidates: input.generationStats.edgeSuppressedCandidates,
    earlyTerrainRejectedPatches: input.generationStats.earlyTerrainRejectedPatches,
    earlyTerrainSkippedCandidates: input.generationStats.earlyTerrainSkippedCandidates,
    earlyTerrainReasonCounts: input.generationStats.earlyTerrainReasonCounts,
    patchRebuildCount: input.patchRebuildCount,
    buildMs: input.buildMs,
    midBladeCount: input.activeGpu
      ? input.ringTierCounts.mid + input.ringTierCounts.far + input.ringTierCounts.super
      : input.patches.reduce((sum, p) => sum + p.midBladeCount, 0),
    gpuRingStatus: gpu.status,
    gpuRingCandidateCount: gpu.candidateCount,
    gpuRingCandidateCountBeforePrefilter: gpu.candidateCountBeforePrefilter,
    gpuRingCandidateCountAfterPrefilter: gpu.candidateCountAfterPrefilter,
    gpuRingPrefilterTestedClusters: gpu.prefilterTestedClusters,
    gpuRingPrefilterRejectedClusters: gpu.prefilterRejectedClusters,
    gpuRingPrefilterAcceptedClusters: gpu.prefilterAcceptedClusters,
    gpuRingPrefilterUnknownKeptClusters: gpu.prefilterUnknownKeptClusters,
    gpuRingVisibleNear: gpu.counts.near,
    gpuRingVisibleMid: gpu.counts.mid,
    gpuRingVisibleFar: gpu.counts.far,
    gpuRingVisibleSuper: gpu.counts.super,
    gpuRingDispatchMs: gpu.submitMs,
    gpuRingReadbackMs: gpu.readbackMs,
  };
}

function buildPatchStats(input: BuildGrassStatsInput): GrassStats {
  let visiblePatches = 0;
  let nearPatches = 0;
  let midPatches = 0;
  let coveragePatches = 0;
  let superPatches = 0;
  let midBladeCount = 0;
  for (const patch of input.patches) {
    if (patch.visibleTier !== "hidden") visiblePatches++;
    if (patch.visibleTier === "near") nearPatches++;
    else if (patch.visibleTier === "mid") midPatches++;
    else if (patch.visibleTier === "far") coveragePatches++;
    else if (patch.visibleTier === "super") superPatches++;
    midBladeCount += patch.midBladeCount;
  }
  const gpu = input.gpuRingStats;
  return {
    mode: input.mode,
    blades: input.bladeCount,
    patches: input.patches.length,
    visiblePatches,
    culledPatches: input.patches.length - visiblePatches,
    nearPatches,
    midPatches,
    coveragePatches,
    superPatches,
    generatedCandidates: input.generationStats.generatedCandidates,
    acceptedCandidates: input.generationStats.acceptedCandidates,
    edgeSuppressedCandidates: input.generationStats.edgeSuppressedCandidates,
    earlyTerrainRejectedPatches: input.generationStats.earlyTerrainRejectedPatches,
    earlyTerrainSkippedCandidates: input.generationStats.earlyTerrainSkippedCandidates,
    earlyTerrainReasonCounts: input.generationStats.earlyTerrainReasonCounts,
    patchRebuildCount: input.patchRebuildCount,
    buildMs: input.buildMs,
    midBladeCount,
    gpuRingStatus: gpu.status,
    gpuRingCandidateCount: gpu.candidateCount,
    gpuRingCandidateCountBeforePrefilter: gpu.candidateCountBeforePrefilter,
    gpuRingCandidateCountAfterPrefilter: gpu.candidateCountAfterPrefilter,
    gpuRingPrefilterTestedClusters: gpu.prefilterTestedClusters,
    gpuRingPrefilterRejectedClusters: gpu.prefilterRejectedClusters,
    gpuRingPrefilterAcceptedClusters: gpu.prefilterAcceptedClusters,
    gpuRingPrefilterUnknownKeptClusters: gpu.prefilterUnknownKeptClusters,
    gpuRingVisibleNear: gpu.counts.near,
    gpuRingVisibleMid: gpu.counts.mid,
    gpuRingVisibleFar: gpu.counts.far,
    gpuRingVisibleSuper: gpu.counts.super,
    gpuRingDispatchMs: gpu.submitMs,
    gpuRingReadbackMs: gpu.readbackMs,
  };
}
