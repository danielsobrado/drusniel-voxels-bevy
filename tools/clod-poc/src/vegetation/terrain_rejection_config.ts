export interface VegetationGpuEarlyRejectConfig {
  enabled: boolean;
  debugValidateCpuOracle: boolean;
  debugReadbackCounters: boolean;
  statsHz: number;
  minClusterSize: number;
  maxRejectedUnknownRatio: number;
  rejectKinds: {
    trees: boolean;
    grass: boolean;
    understory: boolean;
  };
  conservative: {
    acceptWhenSummaryMissing: boolean;
    acceptWhenRevisionMismatch: boolean;
    minCoverageToAccept: number;
  };
}

export interface VegetationTerrainRejectionConfig {
  enabled: boolean;
  gpuEarlyReject: VegetationGpuEarlyRejectConfig;
  staticRulesEnabled: boolean;
  viewRulesEnabled: boolean;
  decisionCacheEnabled: boolean;
  decisionCacheMaxEntries: number;
  cameraBucketM: number;
  viewMinDistanceM: number;
  viewSampleCount: number;
  viewHeightMarginM: number;
  grassCrownHeightM: number;
  understoryCrownHeightM: number;
}

const DEFAULT_GPU_EARLY_REJECT_ENABLED = parseBooleanFlag(
  browserSearchParams()?.get("gpuEarlyReject"),
  false,
);

export const DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG: VegetationGpuEarlyRejectConfig = {
  enabled: DEFAULT_GPU_EARLY_REJECT_ENABLED,
  debugValidateCpuOracle: false,
  debugReadbackCounters: false,
  statsHz: 4,
  minClusterSize: 16,
  maxRejectedUnknownRatio: 0,
  rejectKinds: {
    trees: true,
    grass: true,
    understory: true,
  },
  conservative: {
    acceptWhenSummaryMissing: true,
    acceptWhenRevisionMismatch: true,
    minCoverageToAccept: 0.05,
  },
};

export const DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG: VegetationTerrainRejectionConfig = {
  enabled: DEFAULT_GPU_EARLY_REJECT_ENABLED,
  gpuEarlyReject: DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG,
  staticRulesEnabled: false,
  viewRulesEnabled: true,
  decisionCacheEnabled: true,
  decisionCacheMaxEntries: 8192,
  cameraBucketM: 8,
  viewMinDistanceM: 96,
  viewSampleCount: 6,
  viewHeightMarginM: 1.75,
  grassCrownHeightM: 0.75,
  understoryCrownHeightM: 2.5,
};

export function resolveVegetationTerrainRejectionConfig(
  params: URLSearchParams | null = browserSearchParams(),
): VegetationTerrainRejectionConfig {
  const gpuFlag = params?.get("gpuEarlyReject");
  const debugOracle = params?.get("gpuEarlyRejectDebugOracle");
  const debugReadback = params?.get("gpuEarlyRejectDebugReadback");
  const gpuEarlyReject = {
    ...DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG,
    enabled: parseBooleanFlag(gpuFlag, DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG.enabled),
    debugValidateCpuOracle: parseBooleanFlag(debugOracle, DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG.debugValidateCpuOracle),
    debugReadbackCounters: parseBooleanFlag(debugReadback, DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG.debugReadbackCounters),
    rejectKinds: { ...DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG.rejectKinds },
    conservative: { ...DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG.conservative },
  };
  return {
    ...DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG,
    enabled: gpuEarlyReject.enabled,
    gpuEarlyReject,
  };
}

export type VegetationTerrainRejectionReason =
  | "accepted"
  | "visible"
  | "near_forced_visible"
  | "disabled"
  | "missing_sampler"
  | "unknown_kept"
  | "terrain_hidden"
  | "below_water"
  | "wrong_biome"
  | "too_steep"
  | "height_range"
  | "outside_world";

export interface VegetationTerrainRejectionDecision {
  reject: boolean;
  reason: VegetationTerrainRejectionReason;
  skippedCandidateEstimate: number;
}

function browserSearchParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function parseBooleanFlag(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined || value === "") return fallback;
  if (value === "0" || value === "false" || value === "off") return false;
  if (value === "1" || value === "true" || value === "on") return true;
  return fallback;
}
