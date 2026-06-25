import { load } from "js-yaml";
import {
  DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG,
  DEFAULT_SHADOW_PROXY_CONFIG,
} from "../config/longViewDefaults.js";
import type {
  LongViewSunShadowsConfig,
  ShadowProxyConfig,
  ShadowProxyShadowSide,
} from "./shadowProxyTypes.js";

interface LongViewYamlConfig {
  long_view?: {
    shadow_proxy?: Record<string, unknown>;
    sun_shadows?: {
      enabled?: boolean;
    };
  };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value < min ? fallback : value;
}

function readShadowSide(value: unknown, fallback: ShadowProxyShadowSide): ShadowProxyShadowSide {
  if (value === "front" || value === "back" || value === "double") return value;
  return fallback;
}

function parseShadowProxyConfig(
  raw: Record<string, unknown> | undefined,
  fallback: ShadowProxyConfig,
): ShadowProxyConfig {
  if (!raw) return { ...fallback };
  return {
    enabled: readBoolean(raw.enabled, fallback.enabled),
    gridRes: Math.floor(readNumber(raw.grid_res, fallback.gridRes, 2)),
    startM: readNumber(raw.start_m, fallback.startM, 0),
    endM: readNumber(raw.end_m, fallback.endM, 1),
    heightBiasM: readNumber(raw.height_bias_m, fallback.heightBiasM),
    minHeightM: readNumber(raw.min_height_m, fallback.minHeightM),
    maxHeightM: readNumber(raw.max_height_m, fallback.maxHeightM),
    edgeFadeM: readNumber(raw.edge_fade_m, fallback.edgeFadeM, 0),
    castShadow: readBoolean(raw.cast_shadow, fallback.castShadow),
    receiveShadow: readBoolean(raw.receive_shadow, fallback.receiveShadow),
    mainPassColorWrite: readBoolean(raw.main_pass_color_write, fallback.mainPassColorWrite),
    mainPassDepthWrite: readBoolean(raw.main_pass_depth_write, fallback.mainPassDepthWrite),
    shadowSide: readShadowSide(raw.shadow_side, fallback.shadowSide),
    lightShadowMapSize: Math.floor(readNumber(raw.light_shadow_map_size, fallback.lightShadowMapSize, 256)),
    lightShadowCameraExtentM: readNumber(raw.light_shadow_camera_extent_m, fallback.lightShadowCameraExtentM, 1),
    lightShadowCameraNearM: readNumber(raw.light_shadow_camera_near_m, fallback.lightShadowCameraNearM, 0.01),
    lightShadowCameraFarM: readNumber(raw.light_shadow_camera_far_m, fallback.lightShadowCameraFarM, 1),
    lightShadowBias: readNumber(raw.light_shadow_bias, fallback.lightShadowBias),
    lightShadowNormalBias: readNumber(raw.light_shadow_normal_bias, fallback.lightShadowNormalBias, 0),
    debugVisibleProxy: readBoolean(raw.debug_visible_proxy, fallback.debugVisibleProxy),
    debugWireframe: readBoolean(raw.debug_wireframe, fallback.debugWireframe),
    debugFreezeProxy: readBoolean(raw.debug_freeze_proxy, fallback.debugFreezeProxy),
    debugShowBounds: readBoolean(raw.debug_show_bounds, fallback.debugShowBounds),
  };
}

export function parseLongViewSunShadowsConfig(
  yamlText: string,
  fallback: LongViewSunShadowsConfig = DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG,
): LongViewSunShadowsConfig {
  if (!yamlText.trim()) return cloneLongViewSunShadowsConfig(fallback);
  const parsed = load(yamlText) as LongViewYamlConfig;
  const root = parsed.long_view;
  return {
    enabled: readBoolean(root?.sun_shadows?.enabled, fallback.enabled),
    shadowProxy: parseShadowProxyConfig(root?.shadow_proxy, fallback.shadowProxy),
  };
}

export function applyShadowProxySceneOverrides(
  config: ShadowProxyConfig,
  scene: string | null,
): ShadowProxyConfig {
  const next = { ...config };
  switch (scene) {
    case "long-view-shadow-proxy-off":
      next.enabled = false;
      break;
    case "long-view-shadow-proxy-debug-visible":
      next.enabled = true;
      next.debugVisibleProxy = true;
      break;
    case "long-view-shadow-proxy-basic":
    case "long-view-shadow-proxy-forest":
      next.enabled = true;
      break;
    case "long-view-shadow-proxy-low-sun":
      next.enabled = true;
      break;
    default:
      break;
  }
  return next;
}

export function applyShadowProxyDebugQueryOverrides(
  config: ShadowProxyConfig,
  searchParams: URLSearchParams,
): ShadowProxyConfig {
  const next = { ...config };
  if (searchParams.get("shadowProxyDebugVisible") === "1") next.debugVisibleProxy = true;
  if (searchParams.get("shadowProxyDebugVisible") === "0") next.debugVisibleProxy = false;
  if (searchParams.get("shadowProxyWireframe") === "1") next.debugWireframe = true;
  if (searchParams.get("shadowProxyWireframe") === "0") next.debugWireframe = false;
  if (searchParams.get("shadowProxyFreeze") === "1") next.debugFreezeProxy = true;
  if (searchParams.get("shadowProxyShowBounds") === "1") next.debugShowBounds = true;
  if (searchParams.get("shadowProxy") === "0") next.enabled = false;
  if (searchParams.get("shadowProxy") === "1") next.enabled = true;
  return next;
}

export function cloneShadowProxyConfig(config: ShadowProxyConfig): ShadowProxyConfig {
  return { ...config };
}

export function cloneLongViewSunShadowsConfig(config: LongViewSunShadowsConfig): LongViewSunShadowsConfig {
  return {
    enabled: config.enabled,
    shadowProxy: cloneShadowProxyConfig(config.shadowProxy),
  };
}

export { DEFAULT_SHADOW_PROXY_CONFIG };
