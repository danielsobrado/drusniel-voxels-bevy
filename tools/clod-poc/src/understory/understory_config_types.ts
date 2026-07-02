export type UnderstoryClass = "shrub" | "fern" | "sapling" | "flower" | "dead_log" | "stump";
export type UnderstoryHeightPreference = "low" | "high" | "any";

export const UNDERSTORY_CLASSES: readonly UnderstoryClass[] = [
  "shrub",
  "fern",
  "sapling",
  "flower",
  "dead_log",
  "stump",
] as const;

export interface UnderstoryPlacementSettings {
  spacingM: number;
  jitter: number;
  slopeMinY: number;
  minHeightM: number;
  maxHeightM: number;
  minGroundWeight: number;
  minTreeInfluence: number;
}

export interface UnderstoryEcologySettings {
  enabled: boolean;
  forestInfluenceScaleM: number;
  forestEdgeWidthM: number;
  clearingPreference: number;
  moistureNoiseScaleM: number;
  moistureStrength: number;
  shadeStrength: number;
  densityNoiseScaleM: number;
  densityNoiseStrength: number;
  deadfallOldForestBias: number;
}

export interface UnderstoryClassSettings {
  enabled: boolean;
  weight: number;
  density: number;
  minScale: number;
  maxScale: number;
  heightPreference: UnderstoryHeightPreference;
  shadePreference: number;
  moisturePreference: number;
  forestEdgeBias: number;
  windWeight: number;
}

export interface UnderstoryTerrainClassWeights {
  density: number;
  shrub: number;
  fern: number;
  sapling: number;
  flower: number;
  dead_log: number;
  stump: number;
}

export interface UnderstoryTerrainWeights {
  grass: UnderstoryTerrainClassWeights;
  rock: UnderstoryTerrainClassWeights;
  sand: UnderstoryTerrainClassWeights;
  snow: UnderstoryTerrainClassWeights;
}

export interface UnderstoryRenderSettings {
  debugColorByClass: boolean;
  alphaTest: number;
  shadows: boolean;
  maxShadowClass: UnderstoryClass;
}

export interface UnderstoryGpuSettings {
  enabled: boolean;
  fallbackToCpu: boolean;
  debugForceCpu: boolean;
  maxVisible: number;
  workgroupSize: 32 | 64 | 128 | 256;
  readbackVisibleLists: boolean;
  debugShowGpuCounts: boolean;
  debugValidateAgainstCpu: boolean;
}

export interface UnderstorySettings {
  enabled: boolean;
  seed: number;
  distanceM: number;
  refreshDistanceM: number;
  maxNewPatchesPerFrame: number;
  maxInstances: number;
  placement: UnderstoryPlacementSettings;
  ecology: UnderstoryEcologySettings;
  terrain: UnderstoryTerrainWeights;
  classes: Record<UnderstoryClass, UnderstoryClassSettings>;
  render: UnderstoryRenderSettings;
  gpu: UnderstoryGpuSettings;
}

export interface UnderstoryYamlClass {
  enabled?: boolean;
  weight?: number;
  density?: number;
  min_scale?: number;
  max_scale?: number;
  height_preference?: unknown;
  shade_preference?: number;
  moisture_preference?: number;
  forest_edge_bias?: number;
  wind_weight?: number;
}

export interface UnderstoryYamlTerrainClass {
  density?: number;
  shrub?: number;
  fern?: number;
  sapling?: number;
  flower?: number;
  dead_log?: number;
  stump?: number;
}

export interface UnderstoryYamlGpu {
  enabled?: boolean;
  fallback_to_cpu?: boolean;
  debug_force_cpu?: boolean;
  max_visible?: number;
  workgroup_size?: number;
  readback_visible_lists?: boolean;
  debug_show_gpu_counts?: boolean;
  debug_validate_against_cpu?: boolean;
}

export interface UnderstoryYamlConfig {
  understory?: {
    enabled?: boolean;
    seed?: number;
    distance_m?: number;
    refresh_distance_m?: number;
    max_new_patches_per_frame?: number;
    max_instances?: number;
    placement?: {
      spacing_m?: number;
      jitter?: number;
      slope_min_y?: number;
      min_height_m?: number;
      max_height_m?: number;
      min_ground_weight?: number;
      min_tree_influence?: number;
    };
    ecology?: {
      enabled?: boolean;
      forest_influence_scale_m?: number;
      forest_edge_width_m?: number;
      clearing_preference?: number;
      moisture_noise_scale_m?: number;
      moisture_strength?: number;
      shade_strength?: number;
      density_noise_scale_m?: number;
      density_noise_strength?: number;
      deadfall_old_forest_bias?: number;
    };
    terrain?: Partial<Record<"grass" | "rock" | "sand" | "snow", UnderstoryYamlTerrainClass>>;
    classes?: Partial<Record<UnderstoryClass, UnderstoryYamlClass>>;
    render?: {
      debug_color_by_class?: boolean;
      alpha_test?: number;
      shadows?: boolean;
      max_shadow_class?: unknown;
    };
    gpu?: UnderstoryYamlGpu;
  };
}
