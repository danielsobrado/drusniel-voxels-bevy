export * from "./understory_config_types.js";
export * from "./understory_config_defaults.js";

import { load } from "js-yaml";
import {
  UNDERSTORY_CLASSES,
  type UnderstoryClass,
  type UnderstoryHeightPreference,
  type UnderstoryClassSettings,
  type UnderstoryGpuSettings,
  type UnderstorySettings,
  type UnderstoryTerrainClassWeights,
  type UnderstoryTerrainWeights,
  type UnderstoryYamlClass,
  type UnderstoryYamlGpu,
  type UnderstoryYamlTerrainClass,
  type UnderstoryYamlConfig,
} from "./understory_config_types.js";
import { cloneUnderstorySettings } from "./understory_config_defaults.js";

const DEFAULT_UNDERSTORY_RUNTIME_BUDGET = {
  distanceM: 110,
  refreshDistanceM: 16,
  maxNewPatchesPerFrame: 1,
  maxInstances: 10000,
  gpuMaxVisible: 24000,
} as const;

export function parseUnderstoryConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): UnderstorySettings {
  const fallback = cloneUnderstorySettings();
  if (!text || text.trim() === "") return applyDefaultRuntimeBudget(fallback);

  let rawConfig: UnderstoryYamlConfig;
  try {
    rawConfig = (load(text) ?? {}) as UnderstoryYamlConfig;
  } catch (error) {
    warn?.(`[understory-config] failed to parse config/understory.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`);
    return applyDefaultRuntimeBudget(fallback);
  }

  const raw = rawConfig.understory ?? {};
  return applyDefaultRuntimeBudget({
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
  });
}

function applyDefaultRuntimeBudget(settings: UnderstorySettings): UnderstorySettings {
  const budget = DEFAULT_UNDERSTORY_RUNTIME_BUDGET;
  return {
    ...settings,
    distanceM: Math.min(settings.distanceM, budget.distanceM),
    refreshDistanceM: Math.max(settings.refreshDistanceM, budget.refreshDistanceM),
    maxNewPatchesPerFrame: Math.min(settings.maxNewPatchesPerFrame, budget.maxNewPatchesPerFrame),
    maxInstances: Math.min(settings.maxInstances, budget.maxInstances),
    gpu: {
      ...settings.gpu,
      maxVisible: Math.min(settings.gpu.maxVisible, budget.gpuMaxVisible),
    },
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
