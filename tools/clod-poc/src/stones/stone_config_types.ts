import type { RockPreset } from "./rock_builder.js";

export type StoneClass = "large" | "medium" | "small";

export const STONE_CLASSES: readonly StoneClass[] = ["large", "medium", "small"] as const;

export interface StoneClassConfig {
  radiusMin: number;
  radiusMax: number;
  maxDistance: number;
  sink: number;
  lodDetails: number[];
  variants: number;
  presets: RockPreset[];
  shadows: boolean;
}

export interface StoneTerrainClassWeights {
  density: number;
  large: number;
  medium: number;
  small: number;
}

export interface StoneTerrainWeights {
  lowHeightM: number;
  highHeightM: number;
  heightBlendM: number;
  grass: StoneTerrainClassWeights;
  rock: StoneTerrainClassWeights;
  sand: StoneTerrainClassWeights;
  snow: StoneTerrainClassWeights;
  low: StoneTerrainClassWeights;
  mid: StoneTerrainClassWeights;
  high: StoneTerrainClassWeights;
}

export interface StoneSettings {
  enabled: boolean;
  seedSalt: number;
  cellSizeM: number;
  ringRadiusM: number;
  ringRefreshDistanceM: number;
  ringEdgeFadeM: number;
  maxInstances: number;
  density: number;
  slopeReposeStart: number;
  slopeRepose: number;
  waterMarginM: number;
  standingWaterCutoffM: number;
  streamLargeBias: number;
  cliffProbeNearM: number;
  cliffProbeFarM: number;
  cliffRiseStart: number;
  cliffRiseEnd: number;
  streambedSandStart: number;
  streambedSandEnd: number;
  snowFade: number;
  rockExposureWeight: number;
  screeWeight: number;
  cliffAboveWeight: number;
  streamWeight: number;
  baseSoilWeight: number;
  patchClumpMin: number;
  patchClumpCellMult: number;
  sinkSlopeMultiplier: number;
  normalLean: number;
  terrain: StoneTerrainWeights;
  debug: StoneDebugSettings;
  classes: Record<StoneClass, StoneClassConfig>;
}

export interface StoneDebugSettings {
  classColors: boolean;
  largeOnly: boolean;
  mediumOnly: boolean;
  smallOnly: boolean;
  rejectedWaterMap: boolean;
  slopeReposeHeatmap: boolean;
  streambedHeatmap: boolean;
  cliffAboveHeatmap: boolean;
  rockBasePatchHeatmap: boolean;
  candidateGrid: boolean;
}

export interface StoneYamlClassConfig {
  radius_min?: number;
  radius_max?: number;
  max_distance_m?: number;
  sink?: number;
  lod_details?: unknown;
  variants?: number;
  presets?: unknown;
  shadows?: boolean;
}

export interface StoneYamlTerrainClassWeights {
  density?: number;
  large?: number;
  medium?: number;
  small?: number;
}

export interface StoneYamlTerrainWeights {
  low_height_m?: number;
  high_height_m?: number;
  height_blend_m?: number;
  grass?: StoneYamlTerrainClassWeights;
  rock?: StoneYamlTerrainClassWeights;
  sand?: StoneYamlTerrainClassWeights;
  snow?: StoneYamlTerrainClassWeights;
  low?: StoneYamlTerrainClassWeights;
  mid?: StoneYamlTerrainClassWeights;
  high?: StoneYamlTerrainClassWeights;
}

export interface StoneYamlConfig {
  enabled?: boolean;
  seed_salt?: number;
  cell_size_m?: number;
  ring_radius_m?: number;
  ring_refresh_distance_m?: number;
  ring_edge_fade_m?: number;
  max_instances?: number;
  density?: number;
  slope_repose_start?: number;
  slope_repose?: number;
  water_margin_m?: number;
  standing_water_cutoff_m?: number;
  stream_large_bias?: number;
  cliff_probe_near_m?: number;
  cliff_probe_far_m?: number;
  cliff_rise_start?: number;
  cliff_rise_end?: number;
  streambed_sand_start?: number;
  streambed_sand_end?: number;
  snow_fade?: number;
  rock_exposure_weight?: number;
  scree_weight?: number;
  cliff_above_weight?: number;
  rock_base_patch_weight?: number;
  stream_weight?: number;
  base_soil_weight?: number;
  patch_clump_min?: number;
  patch_clump_cell_mult?: number;
  sink_slope_multiplier?: number;
  normal_lean?: number;
  terrain?: StoneYamlTerrainWeights;
  debug?: Partial<Record<keyof StoneDebugSettings, boolean>> & {
    class_colors?: boolean;
    large_only?: boolean;
    medium_only?: boolean;
    small_only?: boolean;
    rejected_water_map?: boolean;
    slope_repose_heatmap?: boolean;
    streambed_heatmap?: boolean;
    cliff_above_heatmap?: boolean;
    rock_base_patch_heatmap?: boolean;
    candidate_grid?: boolean;
  };
  large?: StoneYamlClassConfig;
  medium?: StoneYamlClassConfig;
  small?: StoneYamlClassConfig;
}

