import { load } from "js-yaml";
import type { WaterFarSummaryReflectionConfig } from "./water_config_types.js";
import { readBoolean, readNumber, recordFrom } from "./water_config_readers.js";

export function parseWaterFarReflectionConfig(
  text: string,
  defaults: WaterFarSummaryReflectionConfig,
): WaterFarSummaryReflectionConfig {
  const root = recordFrom(load(text));
  const raw = recordFrom(root.far_summary_reflection ?? root.farSummaryReflection);
  return sanitizeWaterFarReflectionConfig({
    enabled: readBoolean(raw.enabled, defaults.enabled),
    sourceResolution: readNumber(raw.source_resolution ?? raw.sourceResolution, defaults.sourceResolution),
    sourceSpanM: readNumber(raw.source_span_m ?? raw.sourceSpanM, defaults.sourceSpanM),
    sourceSnapM: readNumber(raw.source_snap_m ?? raw.sourceSnapM, defaults.sourceSnapM),
    sourceBuildCellsPerFrame: readNumber(
      raw.source_build_cells_per_frame ?? raw.sourceBuildCellsPerFrame,
      defaults.sourceBuildCellsPerFrame,
    ),
    maxSteps: readNumber(raw.max_steps ?? raw.maxSteps, defaults.maxSteps),
    startDistanceM: readNumber(raw.start_distance_m ?? raw.startDistanceM, defaults.startDistanceM),
    maxDistanceM: readNumber(raw.max_distance_m ?? raw.maxDistanceM, defaults.maxDistanceM),
    stepGrowth: readNumber(raw.step_growth ?? raw.stepGrowth, defaults.stepGrowth),
    thicknessM: readNumber(raw.thickness_m ?? raw.thicknessM, defaults.thicknessM),
    terrainStrength: readNumber(raw.terrain_strength ?? raw.terrainStrength, defaults.terrainStrength),
    propStrength: readNumber(raw.prop_strength ?? raw.propStrength, defaults.propStrength),
  });
}

export function resolveWaterFarReflectionConfig(
  parsed: WaterFarSummaryReflectionConfig,
  searchParams: URLSearchParams,
): WaterFarSummaryReflectionConfig {
  const query = searchParams.get("waterFarReflection");
  if (query === null) return parsed;
  return { ...parsed, enabled: query === "1" || query.toLowerCase() === "true" };
}

export function sanitizeWaterFarReflectionConfig(
  config: WaterFarSummaryReflectionConfig,
): WaterFarSummaryReflectionConfig {
  const sourceResolution = Math.max(2, integer(config.sourceResolution, 65));
  const sourceSpanM = positive(config.sourceSpanM, 1024);
  const sourceCellSizeM = sourceSpanM / Math.max(1, sourceResolution - 1);
  const startDistanceM = positive(config.startDistanceM, 16);
  const maxDistanceM = Math.max(startDistanceM, positive(config.maxDistanceM, 320));
  return {
    enabled: config.enabled === true,
    sourceResolution,
    sourceSpanM,
    sourceSnapM: positive(config.sourceSnapM, sourceCellSizeM),
    sourceBuildCellsPerFrame: Math.max(1, integer(config.sourceBuildCellsPerFrame, 512)),
    maxSteps: clamp(integer(config.maxSteps, 6), 5, 8),
    startDistanceM,
    maxDistanceM,
    stepGrowth: Math.max(1.01, positive(config.stepGrowth, 1.8)),
    thicknessM: positive(config.thicknessM, 18),
    terrainStrength: clamp(finite(config.terrainStrength, 0.52), 0, 1),
    propStrength: clamp(finite(config.propStrength, 0.72), 0, 1),
  };
}

function integer(value: number, fallback: number): number {
  return Math.floor(finite(value, fallback));
}

function positive(value: number, fallback: number): number {
  const parsed = finite(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
