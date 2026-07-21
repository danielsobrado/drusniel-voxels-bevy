import type { HydrologyConfig } from "./hydrologyConfig.js";
import type { WaterConfig } from "./water_config_types.js";
import { parseWaterNormalModel, type WaterNormalModel } from "./water_normal_models.js";

export interface WaterRuntimeOverrideOptions {
  clone(config: WaterConfig): WaterConfig;
  defaultHydrology: HydrologyConfig;
}

export function applyRuntimeRiverOverrides(config: WaterConfig, options: WaterRuntimeOverrideOptions): WaterConfig {
  const params = runtimeSearchParams();
  if (!params) return config;
  const next = options.clone(config);
  const source = params.get("waterSource");
  if (source === "hydrology" || source === "fake_bodies") next.source = source;
  next.hydrology.rivers.guaranteeFallbackRivers = queryBool(params, "riversFallback", next.hydrology.rivers.guaranteeFallbackRivers);
  next.hydrology.rivers.fallbackMainRiver = queryBool(params, "riverMain", next.hydrology.rivers.fallbackMainRiver);
  next.hydrology.rivers.fallbackTributaries = queryBool(params, "riverTributaries", next.hydrology.rivers.fallbackTributaries);
  next.hydrology.rivers.widenRadius = queryNumber(params, "riverWidth", next.hydrology.rivers.widenRadius);
  next.hydrology.rivers.visibleDepthM = queryNumber(params, "riverVisibleDepth", next.hydrology.rivers.visibleDepthM);
  next.hydrology.rivers.carveDepthM = queryNumber(params, "riverCarveDepth", next.hydrology.rivers.carveDepthM);
  next.hydrology.rivers.flowSpeedMultiplier = queryNumber(params, "riverFlowSpeed", next.hydrology.rivers.flowSpeedMultiplier);
  next.visual.normalModel = readWaterNormalModelOverride(params, next.visual.normalModel);
  next.visual.foam.shoreStrength = queryNumber(params, "shoreFoamStrength", next.visual.foam.shoreStrength);
  next.visual.foam.riverStrength = queryNumber(params, "riverFoamStrength", next.visual.foam.riverStrength);
  for (const river of next.fakeBodies.rivers) {
    river.width = Math.max(0.1, river.width * Math.max(0.1, next.hydrology.rivers.widenRadius / options.defaultHydrology.rivers.widenRadius));
  }
  return next;
}

export function readWaterNormalModelOverride(
  params: URLSearchParams,
  fallback: WaterNormalModel,
): WaterNormalModel {
  return parseWaterNormalModel(params.get("waterNormalModel"), fallback);
}

function runtimeSearchParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function queryBool(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null) return fallback;
  return raw === "1" || raw === "true";
}

function queryNumber(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
