// Stone-overlay configuration. Mirrors `assets/config/stones.yaml` so placement stays
// config-driven and the TypeScript/Rust implementations can be diffed. Slope is terrain
// normal.y (1 = flat, lower = steeper), matching the PoC terrain API and the grass system.

import { load } from "js-yaml";
import type { RockPreset } from "./rock_builder.js";

export type StoneClass = "large" | "medium" | "small";

export const STONE_CLASSES: readonly StoneClass[] = ["large", "medium", "small"] as const;

export interface StoneClassConfig {
  /** target world radius range (m); per-instance scale hits a value in this band */
  radiusMin: number;
  radiusMax: number;
  /** visible out to this many metres */
  maxDistance: number;
  /** base fraction of radius sunk into the ground on flat terrain */
  sink: number;
  /** icosphere subdivision levels, near → far (drives mesh LOD pool) */
  lodDetails: number[];
  /** distinct meshes generated per class */
  variants: number;
  /** preset pool this class draws from (context biases the choice in scatter) */
  presets: RockPreset[];
  /** parity flag with the Rust shadow LOD policy; the PoC does not cull shadows */
  shadows: boolean;
}

export interface StoneSettings {
  enabled: boolean;
  seedSalt: number;
  /** scatter grid spacing (m) */
  cellSizeM: number;
  /** hard cap on rendered instances */
  maxInstances: number;
  /** global density multiplier (0 disables, 1 = nominal) */
  density: number;
  /** normal.y at/above which slope imposes no penalty */
  slopeReposeStart: number;
  /** normal.y below which the site is fully rejected (too steep, stones can't rest) */
  slopeRepose: number;
  /** reject candidates below WATER_LEVEL + this margin (m) */
  waterMarginM: number;
  /** optional deep-water rejection proxy for future river-depth fields */
  standingWaterCutoffM: number;
  /** extra large-stone weight in streambeds */
  streamLargeBias: number;
  /** uphill cliff probe distances (m) */
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
  /** bed = slope * sinkSlopeMultiplier + 1, deepening sink on slopes */
  sinkSlopeMultiplier: number;
  /** max lean (rad) toward the terrain normal */
  normalLean: number;
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

export const DEFAULT_STONE_SETTINGS: StoneSettings = {
  enabled: false,
  seedSalt: 931777,
  cellSizeM: 2.1,
  maxInstances: 120000,
  density: 1.0,
  slopeReposeStart: 0.78,
  slopeRepose: 0.5,
  waterMarginM: 0.5,
  standingWaterCutoffM: 0.0,
  streamLargeBias: 0.16,
  cliffProbeNearM: 8.0,
  cliffProbeFarM: 18.0,
  cliffRiseStart: 0.7,
  cliffRiseEnd: 1.3,
  streambedSandStart: 0.0,
  streambedSandEnd: 1.0,
  snowFade: 0.85,
  rockExposureWeight: 0.85,
  screeWeight: 0.85,
  cliffAboveWeight: 1.15,
  streamWeight: 1.5,
  baseSoilWeight: 0.16,
  patchClumpMin: 0.35,
  patchClumpCellMult: 3.0,
  sinkSlopeMultiplier: 0.9,
  normalLean: 0.4,
  debug: {
    classColors: false,
    largeOnly: false,
    mediumOnly: false,
    smallOnly: false,
    rejectedWaterMap: false,
    slopeReposeHeatmap: false,
    streambedHeatmap: false,
    cliffAboveHeatmap: false,
    rockBasePatchHeatmap: false,
    candidateGrid: false,
  },
  classes: {
    large: {
      radiusMin: 0.6,
      radiusMax: 2.2,
      maxDistance: 900,
      sink: 0.3,
      lodDetails: [3, 2],
      variants: 4,
      presets: ["talus", "boulder"],
      shadows: true,
    },
    medium: {
      radiusMin: 0.2,
      radiusMax: 0.6,
      maxDistance: 280,
      sink: 0.26,
      lodDetails: [2, 1],
      variants: 4,
      presets: ["cobble", "talus"],
      shadows: false,
    },
    small: {
      radiusMin: 0.06,
      radiusMax: 0.2,
      maxDistance: 90,
      sink: 0.22,
      lodDetails: [1],
      variants: 4,
      presets: ["cobble"],
      shadows: false,
    },
  },
};

/** Base class-selection weights before context bias (small most common). */
export const CLASS_BASE_WEIGHTS: Record<StoneClass, number> = {
  large: 0.1,
  medium: 0.32,
  small: 0.58,
};

interface StoneYamlClassConfig {
  radius_min?: number;
  radius_max?: number;
  max_distance_m?: number;
  sink?: number;
  lod_details?: number[];
  variants?: number;
  presets?: RockPreset[];
  shadows?: boolean;
}

interface StoneYamlConfig {
  enabled?: boolean;
  seed_salt?: number;
  cell_size_m?: number;
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
  stream_weight?: number;
  base_soil_weight?: number;
  patch_clump_min?: number;
  patch_clump_cell_mult?: number;
  sink_slope_multiplier?: number;
  normal_lean?: number;
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

function classFromYaml(base: StoneClassConfig, raw: StoneYamlClassConfig | undefined): StoneClassConfig {
  if (!raw) return { ...base, lodDetails: [...base.lodDetails], presets: [...base.presets] };
  return {
    radiusMin: raw.radius_min ?? base.radiusMin,
    radiusMax: raw.radius_max ?? base.radiusMax,
    maxDistance: raw.max_distance_m ?? base.maxDistance,
    sink: raw.sink ?? base.sink,
    lodDetails: raw.lod_details ? [...raw.lod_details] : [...base.lodDetails],
    variants: raw.variants ?? base.variants,
    presets: raw.presets ? [...raw.presets] : [...base.presets],
    shadows: raw.shadows ?? base.shadows,
  };
}

export function parseStoneConfig(text: string): StoneSettings {
  const raw = (load(text) ?? {}) as StoneYamlConfig;
  const base = DEFAULT_STONE_SETTINGS;
  const debug: StoneDebugSettings = {
    classColors: raw.debug?.class_colors ?? raw.debug?.classColors ?? base.debug.classColors,
    largeOnly: raw.debug?.large_only ?? raw.debug?.largeOnly ?? base.debug.largeOnly,
    mediumOnly: raw.debug?.medium_only ?? raw.debug?.mediumOnly ?? base.debug.mediumOnly,
    smallOnly: raw.debug?.small_only ?? raw.debug?.smallOnly ?? base.debug.smallOnly,
    rejectedWaterMap: raw.debug?.rejected_water_map ?? raw.debug?.rejectedWaterMap ?? base.debug.rejectedWaterMap,
    slopeReposeHeatmap: raw.debug?.slope_repose_heatmap ?? raw.debug?.slopeReposeHeatmap ?? base.debug.slopeReposeHeatmap,
    streambedHeatmap: raw.debug?.streambed_heatmap ?? raw.debug?.streambedHeatmap ?? base.debug.streambedHeatmap,
    cliffAboveHeatmap: raw.debug?.cliff_above_heatmap ?? raw.debug?.cliffAboveHeatmap ?? base.debug.cliffAboveHeatmap,
    rockBasePatchHeatmap:
      raw.debug?.rock_base_patch_heatmap ?? raw.debug?.rockBasePatchHeatmap ?? base.debug.rockBasePatchHeatmap,
    candidateGrid: raw.debug?.candidate_grid ?? raw.debug?.candidateGrid ?? base.debug.candidateGrid,
  };
  return {
    enabled: raw.enabled ?? base.enabled,
    seedSalt: raw.seed_salt ?? base.seedSalt,
    cellSizeM: raw.cell_size_m ?? base.cellSizeM,
    maxInstances: raw.max_instances ?? base.maxInstances,
    density: raw.density ?? base.density,
    slopeReposeStart: raw.slope_repose_start ?? base.slopeReposeStart,
    slopeRepose: raw.slope_repose ?? base.slopeRepose,
    waterMarginM: raw.water_margin_m ?? base.waterMarginM,
    standingWaterCutoffM: raw.standing_water_cutoff_m ?? base.standingWaterCutoffM,
    streamLargeBias: raw.stream_large_bias ?? base.streamLargeBias,
    cliffProbeNearM: raw.cliff_probe_near_m ?? base.cliffProbeNearM,
    cliffProbeFarM: raw.cliff_probe_far_m ?? base.cliffProbeFarM,
    cliffRiseStart: raw.cliff_rise_start ?? base.cliffRiseStart,
    cliffRiseEnd: raw.cliff_rise_end ?? base.cliffRiseEnd,
    streambedSandStart: raw.streambed_sand_start ?? base.streambedSandStart,
    streambedSandEnd: raw.streambed_sand_end ?? base.streambedSandEnd,
    snowFade: raw.snow_fade ?? base.snowFade,
    rockExposureWeight: raw.rock_exposure_weight ?? base.rockExposureWeight,
    screeWeight: raw.scree_weight ?? base.screeWeight,
    cliffAboveWeight: raw.cliff_above_weight ?? base.cliffAboveWeight,
    streamWeight: raw.stream_weight ?? base.streamWeight,
    baseSoilWeight: raw.base_soil_weight ?? base.baseSoilWeight,
    patchClumpMin: raw.patch_clump_min ?? base.patchClumpMin,
    patchClumpCellMult: raw.patch_clump_cell_mult ?? base.patchClumpCellMult,
    sinkSlopeMultiplier: raw.sink_slope_multiplier ?? base.sinkSlopeMultiplier,
    normalLean: raw.normal_lean ?? base.normalLean,
    debug,
    classes: {
      large: classFromYaml(base.classes.large, raw.large),
      medium: classFromYaml(base.classes.medium, raw.medium),
      small: classFromYaml(base.classes.small, raw.small),
    },
  };
}
