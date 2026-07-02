export interface VegetationTerrainRejectionConfig {
  enabled: boolean;
  staticRulesEnabled: boolean;
  viewRulesEnabled: boolean;
  decisionCacheEnabled: boolean;
  decisionCacheMaxEntries: number;
  cameraBucketM: number;
}

export const DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG: VegetationTerrainRejectionConfig = {
  enabled: true,
  staticRulesEnabled: true,
  viewRulesEnabled: true,
  decisionCacheEnabled: true,
  decisionCacheMaxEntries: 8192,
  cameraBucketM: 8,
};

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
