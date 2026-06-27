import { load } from "js-yaml";

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

// GPU-ring scatter settings (mirrors TreeGpuSettings). When the renderer is
// WebGPU and `enabled`, understory is scattered + culled on the GPU and drawn
// indirectly instead of the CPU per-frame patch scatter. `fallbackToCpu` keeps
// the legacy CPU path when GPU init/dispatch fails or the device is unsupported.
// `debugForceCpu` forces the CPU path unconditionally for profiling.
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

interface UnderstoryYamlClass {
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

interface UnderstoryYamlTerrainClass {
  density?: number;
  shrub?: number;
  fern?: number;
  sapling?: number;
  flower?: number;
  dead_log?: number;
  stump?: number;
}

interface UnderstoryYamlConfig {
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

interface UnderstoryYamlGpu {
  enabled?: boolean;
  fallback_to_cpu?: boolean;
  debug_force_cpu?: boolean;
  max_visible?: number;
  workgroup_size?: number;
  readback_visible_lists?: boolean;
  debug_show_gpu_counts?: boolean;
  debug_validate_against_cpu?: boolean;
}

const terrainDefaults = (
  density: number,
  shrub: number,
  fern: number,
  sapling: number,
  flower: number,
  deadLog: number,
  stump: number,
): UnderstoryTerrainClassWeights => ({ density, shrub, fern, sapling, flower, dead_log: deadLog, stump });

export const DEFAULT_UNDERSTORY_TERRAIN_WEIGHTS: UnderstoryTerrainWeights = {
  grass: terrainDefaults(1.20, 1.00, 1.18, 0.92, 1.30, 0.60, 0.65),
  rock: terrainDefaults(0.48, 0.62, 0.24, 0.55, 0.08, 1.35, 1.28),
  sand: terrainDefaults(0.62, 0.44, 0.22, 0.24, 0.75, 0.48, 0.44),
  snow: terrainDefaults(0.18, 0.30, 0.10, 0.12, 0.02, 1.60, 1.35),
};

export const DEFAULT_UNDERSTORY_GPU_SETTINGS: UnderstoryGpuSettings = {
  enabled: true,
  fallbackToCpu: true,
  debugForceCpu: false,
  maxVisible: 12_000,
  workgroupSize: 64,
  readbackVisibleLists: true,
  debugShowGpuCounts: true,
  debugValidateAgainstCpu: false,
};

export const DEFAULT_UNDERSTORY_SETTINGS: UnderstorySettings = {
  enabled: true,
  seed: 9137,
  distanceM: 150,
  refreshDistanceM: 12,
  maxNewPatchesPerFrame: 2,
  maxInstances: 12000,
  placement: {
    spacingM: 3.0,
    jitter: 0.55,
    slopeMinY: 0.68,
    minHeightM: 8,
    maxHeightM: 52,
    minGroundWeight: 0.12,
    minTreeInfluence: 0.0,
  },
  ecology: {
    enabled: true,
    forestInfluenceScaleM: 36,
    forestEdgeWidthM: 18,
    clearingPreference: 0.55,
    moistureNoiseScaleM: 80,
    moistureStrength: 0.65,
    shadeStrength: 0.75,
    densityNoiseScaleM: 28,
    densityNoiseStrength: 0.55,
    deadfallOldForestBias: 0.75,
  },
  terrain: cloneUnderstoryTerrainWeights(DEFAULT_UNDERSTORY_TERRAIN_WEIGHTS),
  classes: {
    shrub: classDefaults(0.30, 1.0, 0.7, 1.6, "any", 0.55, 0.45, 0.65, 0.35),
    fern: classDefaults(0.24, 1.0, 0.55, 1.25, "low", 0.85, 0.80, 0.25, 0.55),
    sapling: classDefaults(0.16, 0.55, 0.45, 1.15, "any", 0.45, 0.50, 0.55, 0.45),
    flower: classDefaults(0.18, 0.85, 0.35, 0.95, "low", 0.15, 0.45, 0.85, 0.65),
    dead_log: classDefaults(0.08, 0.22, 0.8, 1.9, "any", 0.75, 0.55, 0.30, 0.0),
    stump: classDefaults(0.04, 0.16, 0.7, 1.4, "any", 0.65, 0.45, 0.25, 0.0),
  },
  render: {
    debugColorByClass: false,
    alphaTest: 0.45,
    shadows: false,
    maxShadowClass: "shrub",
  },
  gpu: { ...DEFAULT_UNDERSTORY_GPU_SETTINGS },
};

export function cloneUnderstorySettings(settings: UnderstorySettings = DEFAULT_UNDERSTORY_SETTINGS): UnderstorySettings {
  return {
    ...settings,
    placement: { ...settings.placement },
    ecology: { ...settings.ecology },
    terrain: cloneUnderstoryTerrainWeights(settings.terrain),
    classes: {
      shrub: { ...settings.classes.shrub },
      fern: { ...settings.classes.fern },
      sapling: { ...settings.classes.sapling },
      flower: { ...settings.classes.flower },
      dead_log: { ...settings.classes.dead_log },
      stump: { ...settings.classes.stump },
    },
    render: { ...settings.render },
    gpu: { ...settings.gpu },
  };
}

export function parseUnderstoryConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): UnderstorySettings {
  const fallback = cloneUnderstorySettings();
  if (!text || text.trim() === "") return fallback;

  let rawConfig: UnderstoryYamlConfig;
  try {
    rawConfig = (load(text) ?? {}) as UnderstoryYamlConfig;
  } catch (error) {
    warn?.(`[understory-config] failed to parse config/understory.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }

  const raw = rawConfig.understory ?? {};
  return {
    enabled: readBoolean(raw.enabled, fallback.enabled),
    seed: Math.floor(readNumber(raw.seed, fallback.seed)),
    distanceM: readNumberInRange(raw.distance_m, fallback.distanceM, 0, 2000),
    refreshDistanceM: readNumberInRange(raw.refresh_distance_m, fallback.refreshDistanceM, 0.1, 512),
    maxNewPatchesPerFrame: readIntegerInRange(raw.max_new_patches_per_frame, fallback.maxNewPatchesPerFrame, 1, 128),
    maxInstances: readIntegerInRange(raw.max_instances, fallback.maxInstances, 0, 2_000_000),
    placement: {
      spacingM: readNumberInRange(raw.placement?.spacing_m, fallback.placement.spacingM, 0.25, 64),
      jitter: readNumberInRange(raw.placement?.jitter, fallback.placement.jitter, 0, 1.5),
      slopeMinY: readNumberInRange(raw.placement?.slope_min_y, fallback.placement.slopeMinY, 0, 1),
      minHeightM: readNumberInRange(raw.placement?.min_height_m, fallback.placement.minHeightM, -1024, 4096),
      maxHeightM: readNumberInRange(raw.placement?.max_height_m, fallback.placement.maxHeightM, -1024, 4096),
      minGroundWeight: readNumberInRange(raw.placement?.min_ground_weight, fallback.placement.minGroundWeight, 0, 1),
      minTreeInfluence: readNumberInRange(raw.placement?.min_tree_influence, fallback.placement.minTreeInfluence, 0, 1),
    },
    ecology: {
      enabled: readBoolean(raw.ecology?.enabled, fallback.ecology.enabled),
      forestInfluenceScaleM: readNumberInRange(raw.ecology?.forest_influence_scale_m, fallback.ecology.forestInfluenceScaleM, 1, 2048),
      forestEdgeWidthM: readNumberInRange(raw.ecology?.forest_edge_width_m, fallback.ecology.forestEdgeWidthM, 0.1, 512),
      clearingPreference: readNumberInRange(raw.ecology?.clearing_preference, fallback.ecology.clearingPreference, 0, 1),
      moistureNoiseScaleM: readNumberInRange(raw.ecology?.moisture_noise_scale_m, fallback.ecology.moistureNoiseScaleM, 1, 2048),
      moistureStrength: readNumberInRange(raw.ecology?.moisture_strength, fallback.ecology.moistureStrength, 0, 1),
      shadeStrength: readNumberInRange(raw.ecology?.shade_strength, fallback.ecology.shadeStrength, 0, 1),
      densityNoiseScaleM: readNumberInRange(raw.ecology?.density_noise_scale_m, fallback.ecology.densityNoiseScaleM, 1, 2048),
      densityNoiseStrength: readNumberInRange(raw.ecology?.density_noise_strength, fallback.ecology.densityNoiseStrength, 0, 1),
      deadfallOldForestBias: readNumberInRange(raw.ecology?.deadfall_old_forest_bias, fallback.ecology.deadfallOldForestBias, 0, 2),
    },
    terrain: readUnderstoryTerrainWeights(raw.terrain, fallback.terrain),
    classes: {
      shrub: readClass(fallback.classes.shrub, raw.classes?.shrub),
      fern: readClass(fallback.classes.fern, raw.classes?.fern),
      sapling: readClass(fallback.classes.sapling, raw.classes?.sapling),
      flower: readClass(fallback.classes.flower, raw.classes?.flower),
      dead_log: readClass(fallback.classes.dead_log, raw.classes?.dead_log),
      stump: readClass(fallback.classes.stump, raw.classes?.stump),
    },
    render: {
      debugColorByClass: readBoolean(raw.render?.debug_color_by_class, fallback.render.debugColorByClass),
      alphaTest: readNumberInRange(raw.render?.alpha_test, fallback.render.alphaTest, 0, 1),
      shadows: readBoolean(raw.render?.shadows, fallback.render.shadows),
      maxShadowClass: readUnderstoryClass(raw.render?.max_shadow_class, fallback.render.maxShadowClass),
    },
    gpu: readUnderstoryGpuSettings(raw.gpu, fallback.gpu),
  };
}

function readUnderstoryTerrainWeights(
  raw: Partial<Record<"grass" | "rock" | "sand" | "snow", UnderstoryYamlTerrainClass>> | undefined,
  fallback: UnderstoryTerrainWeights,
): UnderstoryTerrainWeights {
  return {
    grass: readTerrainClass(fallback.grass, raw?.grass),
    rock: readTerrainClass(fallback.rock, raw?.rock),
    sand: readTerrainClass(fallback.sand, raw?.sand),
    snow: readTerrainClass(fallback.snow, raw?.snow),
  };
}

function readTerrainClass(
  fallback: UnderstoryTerrainClassWeights,
  raw: UnderstoryYamlTerrainClass | undefined,
): UnderstoryTerrainClassWeights {
  return {
    density: readNumberAtLeast(raw?.density, fallback.density, 0),
    shrub: readNumberAtLeast(raw?.shrub, fallback.shrub, 0),
    fern: readNumberAtLeast(raw?.fern, fallback.fern, 0),
    sapling: readNumberAtLeast(raw?.sapling, fallback.sapling, 0),
    flower: readNumberAtLeast(raw?.flower, fallback.flower, 0),
    dead_log: readNumberAtLeast(raw?.dead_log, fallback.dead_log, 0),
    stump: readNumberAtLeast(raw?.stump, fallback.stump, 0),
  };
}

function cloneUnderstoryTerrainWeights(weights: UnderstoryTerrainWeights): UnderstoryTerrainWeights {
  return {
    grass: { ...weights.grass },
    rock: { ...weights.rock },
    sand: { ...weights.sand },
    snow: { ...weights.snow },
  };
}

function readUnderstoryGpuSettings(
  raw: UnderstoryYamlGpu | undefined,
  fallback: UnderstoryGpuSettings,
): UnderstoryGpuSettings {
  return {
    enabled: readBoolean(raw?.enabled, fallback.enabled),
    fallbackToCpu: readBoolean(raw?.fallback_to_cpu, fallback.fallbackToCpu),
    debugForceCpu: readBoolean(raw?.debug_force_cpu, fallback.debugForceCpu),
    maxVisible: readIntegerInRange(raw?.max_visible, fallback.maxVisible, 0, 2_000_000),
    workgroupSize: readUnderstoryGpuWorkgroupSize(raw?.workgroup_size, fallback.workgroupSize),
    readbackVisibleLists: readBoolean(raw?.readback_visible_lists, fallback.readbackVisibleLists),
    debugShowGpuCounts: readBoolean(raw?.debug_show_gpu_counts, fallback.debugShowGpuCounts),
    debugValidateAgainstCpu: readBoolean(raw?.debug_validate_against_cpu, fallback.debugValidateAgainstCpu),
  };
}

function readUnderstoryGpuWorkgroupSize(
  value: unknown,
  fallback: UnderstoryGpuSettings["workgroupSize"],
): UnderstoryGpuSettings["workgroupSize"] {
  if (value === 32 || value === 64 || value === 128 || value === 256) return value;
  return fallback;
}

function classDefaults(
  weight: number,
  density: number,
  minScale: number,
  maxScale: number,
  heightPreference: UnderstoryHeightPreference,
  shadePreference: number,
  moisturePreference: number,
  forestEdgeBias: number,
  windWeight: number,
): UnderstoryClassSettings {
  return {
    enabled: true,
    weight,
    density,
    minScale,
    maxScale,
    heightPreference,
    shadePreference,
    moisturePreference,
    forestEdgeBias,
    windWeight,
  };
}

function readClass(fallback: UnderstoryClassSettings, raw: UnderstoryYamlClass | undefined): UnderstoryClassSettings {
  const minScale = readNumberInRange(raw?.min_scale, fallback.minScale, 0.01, 16);
  const maxScale = Math.max(minScale, readNumberInRange(raw?.max_scale, fallback.maxScale, 0.01, 16));
  return {
    enabled: readBoolean(raw?.enabled, fallback.enabled),
    weight: readNumberAtLeast(raw?.weight, fallback.weight, 0),
    density: readNumberAtLeast(raw?.density, fallback.density, 0),
    minScale,
    maxScale,
    heightPreference: readHeightPreference(raw?.height_preference, fallback.heightPreference),
    shadePreference: readNumberInRange(raw?.shade_preference, fallback.shadePreference, 0, 1),
    moisturePreference: readNumberInRange(raw?.moisture_preference, fallback.moisturePreference, 0, 1),
    forestEdgeBias: readNumberInRange(raw?.forest_edge_bias, fallback.forestEdgeBias, 0, 2),
    windWeight: readNumberInRange(raw?.wind_weight, fallback.windWeight, 0, 1),
  };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNumberAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

function readNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  return clamp(readNumber(value, fallback), min, max);
}

function readIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(readNumberInRange(value, fallback, min, max));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readHeightPreference(value: unknown, fallback: UnderstoryHeightPreference): UnderstoryHeightPreference {
  return value === "low" || value === "high" || value === "any" ? value : fallback;
}

function readUnderstoryClass(value: unknown, fallback: UnderstoryClass): UnderstoryClass {
  return UNDERSTORY_CLASSES.includes(value as UnderstoryClass) ? value as UnderstoryClass : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
