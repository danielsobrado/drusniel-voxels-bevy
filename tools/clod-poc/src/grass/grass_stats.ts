import type { GrassGpuRingStats } from "../gpu/grass_ring_compute.js";
import type { VegetationTerrainRejectionReason } from "../vegetation/terrain_rejection_config.js";
import type { GrassShaderMode } from "./grass_config.js";

export interface GrassStats {
  mode: GrassShaderMode;
  blades: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  nearPatches: number;
  midPatches: number;
  coveragePatches: number;
  superPatches: number;
  generatedCandidates: number;
  acceptedCandidates: number;
  edgeSuppressedCandidates: number;
  earlyTerrainRejectedPatches?: number;
  earlyTerrainSkippedCandidates?: number;
  earlyTerrainReasonCounts?: Partial<Record<VegetationTerrainRejectionReason, number>>;
  patchRebuildCount: number;
  buildMs: number;
  midBladeCount: number;
  gpuRingStatus: GrassGpuRingStats["status"];
  gpuRingCandidateCount: number;
  gpuRingCandidateCountBeforePrefilter?: number;
  gpuRingCandidateCountAfterPrefilter?: number;
  gpuRingPrefilterTestedClusters: number;
  gpuRingPrefilterRejectedClusters: number;
  gpuRingPrefilterAcceptedClusters: number;
  gpuRingPrefilterUnknownKeptClusters: number;
  gpuRingVisibleNear: number;
  gpuRingVisibleMid: number;
  gpuRingVisibleFar: number;
  gpuRingVisibleSuper: number;
  gpuRingDispatchMs: number | null;
  gpuRingReadbackMs: number | null;
}

export interface GrassGenerationStats {
  generatedCandidates: number;
  acceptedCandidates: number;
  edgeSuppressedCandidates: number;
  earlyTerrainRejectedPatches?: number;
  earlyTerrainSkippedCandidates?: number;
  earlyTerrainReasonCounts?: Partial<Record<VegetationTerrainRejectionReason, number>>;
}
