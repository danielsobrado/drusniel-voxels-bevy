import { getSunLightGpuAtlas } from "../terrain/sun_visibility/sun_light_gpu_atlas.js";
import {
  WATER_FOAM_MAX_COVERAGE,
  WATER_FOAM_MODEL_REVISION,
  WATER_FOAM_PATTERN_END,
  WATER_FOAM_PATTERN_START,
  WATER_FOAM_RIVER_SHORE_ATTENUATION,
  WATER_FOAM_SHADE_COVERAGE_FLOOR,
  WATER_FOAM_SHORE_DISTANCE_WEIGHT,
} from "./water_foam_model.js";
import { resolveWaterQualityTier, type WaterQualityTier } from "./water_quality_overrides.js";

export interface WaterFoamRuntimeDiagnostics {
  readonly modelRevision: number;
  readonly modelName: "coherent-fbm-flow-sun-v3";
  readonly qualityTier: WaterQualityTier;
  readonly maxCoverage: number;
  readonly patternStart: number;
  readonly patternEnd: number;
  readonly shoreDistanceWeight: number;
  readonly riverShoreAttenuation: number;
  readonly shadeCoverageFloor: number;
  readonly rapidEligibility: "speed-times-drop-times-river";
  readonly cpuFieldSamples: 0;
  readonly sunAtlas: {
    readonly valid: number;
    readonly version: number;
    readonly originX: number;
    readonly originZ: number;
    readonly worldSize: number;
    readonly width: number;
    readonly height: number;
  };
}

export function getWaterFoamRuntimeDiagnostics(
  searchParams: URLSearchParams,
): WaterFoamRuntimeDiagnostics {
  const atlas = getSunLightGpuAtlas();
  const image = atlas.texture.image as { width?: unknown; height?: unknown };
  return {
    modelRevision: WATER_FOAM_MODEL_REVISION,
    modelName: "coherent-fbm-flow-sun-v3",
    qualityTier: resolveWaterQualityTier(searchParams),
    maxCoverage: WATER_FOAM_MAX_COVERAGE,
    patternStart: WATER_FOAM_PATTERN_START,
    patternEnd: WATER_FOAM_PATTERN_END,
    shoreDistanceWeight: WATER_FOAM_SHORE_DISTANCE_WEIGHT,
    riverShoreAttenuation: WATER_FOAM_RIVER_SHORE_ATTENUATION,
    shadeCoverageFloor: WATER_FOAM_SHADE_COVERAGE_FLOOR,
    rapidEligibility: "speed-times-drop-times-river",
    cpuFieldSamples: 0,
    sunAtlas: {
      valid: atlas.valid,
      version: atlas.version,
      originX: atlas.originX,
      originZ: atlas.originZ,
      worldSize: atlas.worldSize,
      width: finiteDimension(image.width),
      height: finiteDimension(image.height),
    },
  };
}

function finiteDimension(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}
