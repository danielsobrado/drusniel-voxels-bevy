export * from "./stone_config_types.js";
export * from "./stone_config_defaults.js";

import { load } from "js-yaml";
import { ROCK_PRESETS, type RockPreset } from "./rock_builder.js";
import type {
  StoneClassConfig,
  StoneDebugSettings,
  StoneSettings,
  StoneTerrainClassWeights,
  StoneTerrainWeights,
  StoneYamlClassConfig,
  StoneYamlConfig,
  StoneYamlTerrainClassWeights,
  StoneYamlTerrainWeights,
} from "./stone_config_types.js";
import { DEFAULT_STONE_SETTINGS } from "./stone_config_defaults.js";

type WarnHandler = (message: string) => void;

const ROCK_PRESET_KEYS = Object.keys(ROCK_PRESETS) as RockPreset[];

function classFromYaml(base: StoneClassConfig, raw: StoneYamlClassConfig | null | undefined): StoneClassConfig {
  if (!isRecord(raw)) return cloneStoneClassConfig(base);
  const radiusMin = readNumberAtLeast(raw.radius_min, base.radiusMin, 0.001);
  const radiusMax = Math.max(radiusMin, readNumberAtLeast(raw.radius_max, base.radiusMax, radiusMin));
  return {
    radiusMin,
    radiusMax,
    maxDistance: readNumberAtLeast(raw.max_distance_m, base.maxDistance, 0),
    sink: readNumberAtLeast(raw.sink, base.sink, 0),
    lodDetails: readLodDetails(raw.lod_details, base.lodDetails),
    variants: readIntegerAtLeast(raw.variants, base.variants, 1),
    presets: readPresets(raw.presets, base.presets),
    shadows: readBoolean(raw.shadows, base.shadows),
  };
}

function cloneStoneClassConfig(config: StoneClassConfig): StoneClassConfig {
  return { ...config, lodDetails: [...config.lodDetails], presets: [...config.presets] };
}

function terrainClassFromYaml(
  base: StoneTerrainClassWeights,
  raw: StoneYamlTerrainClassWeights | undefined,
): StoneTerrainClassWeights {
  return {
    density: readNumberAtLeast(raw?.density, base.density, 0),
    large: readNumberAtLeast(raw?.large, base.large, 0),
    medium: readNumberAtLeast(raw?.medium, base.medium, 0),
    small: readNumberAtLeast(raw?.small, base.small, 0),
  };
}

function terrainFromYaml(base: StoneTerrainWeights, raw: StoneYamlTerrainWeights | undefined): StoneTerrainWeights {
  const lowHeightM = readNumber(raw?.low_height_m, base.lowHeightM);
  const highHeightM = Math.max(lowHeightM, readNumber(raw?.high_height_m, base.highHeightM));
  return {
    lowHeightM,
    highHeightM,
    heightBlendM: readNumberAtLeast(raw?.height_blend_m, base.heightBlendM, 0.001),
    grass: terrainClassFromYaml(base.grass, raw?.grass),
    rock: terrainClassFromYaml(base.rock, raw?.rock),
    sand: terrainClassFromYaml(base.sand, raw?.sand),
    snow: terrainClassFromYaml(base.snow, raw?.snow),
    low: terrainClassFromYaml(base.low, raw?.low),
    mid: terrainClassFromYaml(base.mid, raw?.mid),
    high: terrainClassFromYaml(base.high, raw?.high),
  };
}

export function parseStoneConfig(
  text: string | null | undefined,
  warn: WarnHandler | null = console.warn,
): StoneSettings {
  const raw = readStoneYamlRoot(text, warn);
  const base = DEFAULT_STONE_SETTINGS;
  const slopeRepose = readNumberInRange(raw.slope_repose, base.slopeRepose, 0, 0.999);
  const slopeReposeStart = Math.max(slopeRepose + 0.001, readNumberInRange(raw.slope_repose_start, base.slopeReposeStart, 0, 1));
  const cliffProbeNearM = readNumberAtLeast(raw.cliff_probe_near_m, base.cliffProbeNearM, 0.001);
  const streambedSandStart = readNumberAtLeast(raw.streambed_sand_start, base.streambedSandStart, 0);
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
    enabled: readBoolean(raw.enabled, base.enabled),
    seedSalt: readInteger(raw.seed_salt, base.seedSalt),
    cellSizeM: readNumberAtLeast(raw.cell_size_m, base.cellSizeM, 0.1),
    ringRadiusM: readNumberAtLeast(raw.ring_radius_m, base.ringRadiusM, 0),
    ringRefreshDistanceM: readNumberAtLeast(raw.ring_refresh_distance_m, base.ringRefreshDistanceM, 0.1),
    ringEdgeFadeM: readNumberAtLeast(raw.ring_edge_fade_m, base.ringEdgeFadeM, 0),
    maxInstances: readIntegerAtLeast(raw.max_instances, base.maxInstances, 0),
    density: readNumberAtLeast(raw.density, base.density, 0),
    slopeReposeStart,
    slopeRepose,
    waterMarginM: readNumberAtLeast(raw.water_margin_m, base.waterMarginM, 0),
    standingWaterCutoffM: readNumberAtLeast(raw.standing_water_cutoff_m, base.standingWaterCutoffM, 0),
    streamLargeBias: readNumberAtLeast(raw.stream_large_bias, base.streamLargeBias, 0),
    cliffProbeNearM,
    cliffProbeFarM: Math.max(cliffProbeNearM + 0.001, readNumberAtLeast(raw.cliff_probe_far_m, base.cliffProbeFarM, cliffProbeNearM + 0.001)),
    cliffRiseStart: readNumber(raw.cliff_rise_start, base.cliffRiseStart),
    cliffRiseEnd: readNumber(raw.cliff_rise_end, base.cliffRiseEnd),
    streambedSandStart,
    streambedSandEnd: Math.max(streambedSandStart + 0.001, readNumberAtLeast(raw.streambed_sand_end, base.streambedSandEnd, streambedSandStart + 0.001)),
    snowFade: readNumberInRange(raw.snow_fade, base.snowFade, 0, 1),
    rockExposureWeight: readNumberAtLeast(raw.rock_exposure_weight, base.rockExposureWeight, 0),
    screeWeight: readNumberAtLeast(raw.scree_weight, base.screeWeight, 0),
    cliffAboveWeight: readNumberAtLeast(raw.cliff_above_weight, base.cliffAboveWeight, 0),
    streamWeight: readNumberAtLeast(raw.stream_weight, base.streamWeight, 0),
    baseSoilWeight: readNumberAtLeast(raw.base_soil_weight ?? raw.rock_base_patch_weight, base.baseSoilWeight, 0),
    patchClumpMin: readNumberAtLeast(raw.patch_clump_min, base.patchClumpMin, 0),
    patchClumpCellMult: readNumberAtLeast(raw.patch_clump_cell_mult, base.patchClumpCellMult, 0.001),
    sinkSlopeMultiplier: readNumberAtLeast(raw.sink_slope_multiplier, base.sinkSlopeMultiplier, 0),
    normalLean: readNumberAtLeast(raw.normal_lean, base.normalLean, 0),
    terrain: terrainFromYaml(base.terrain, raw.terrain),
    debug,
    classes: {
      large: classFromYaml(base.classes.large, raw.large),
      medium: classFromYaml(base.classes.medium, raw.medium),
      small: classFromYaml(base.classes.small, raw.small),
    },
  };
}

function readStoneYamlRoot(text: string | null | undefined, warn: WarnHandler | null): StoneYamlConfig {
  try {
    const parsed = text && text.trim() !== "" ? load(text) : {};
    if (isRecord(parsed)) return parsed as StoneYamlConfig;
    if (parsed != null) warn?.("[stone-config] config/stones.yaml root must be an object; using defaults");
  } catch (error) {
    warn?.(`[stone-config] failed to parse config/stones.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {};
}

function readPresets(value: unknown, fallback: readonly RockPreset[]): RockPreset[] {
  if (!Array.isArray(value)) return [...fallback];
  const presets = value.filter(isRockPreset);
  return presets.length > 0 ? presets : [...fallback];
}

function isRockPreset(value: unknown): value is RockPreset {
  return typeof value === "string" && ROCK_PRESET_KEYS.includes(value as RockPreset);
}

function readLodDetails(value: unknown, fallback: readonly number[]): number[] {
  if (!Array.isArray(value)) return [...fallback];
  const details = value
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    .map((entry) => Math.max(0, Math.min(4, Math.floor(entry))));
  return details.length > 0 ? details : [...fallback];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readInteger(value: unknown, fallback: number): number {
  return Math.floor(readNumber(value, fallback));
}

function readIntegerAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, Math.floor(readNumber(value, fallback)));
}

function readNumberAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

function readNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, readNumber(value, fallback)));
}
