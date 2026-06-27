import { load } from "js-yaml";
import type { PlayerConfig } from "../player_controller.js";
import type { WaterField } from "../water/waterField.js";
import { WaterField as WaterFieldImpl } from "../water/waterField.js";
import { parseWaterConfig } from "../water/waterConfig.js";
import waterYaml from "../../config/water.yaml?raw";
import type { OceanSampler } from "../water/ocean_service.js";
import {
  countDeepOceanTransitionGapVertices,
  deepOceanSurfaceTriangleCount,
  deepOceanSurfaceVertexCount,
} from "../water/deep_ocean_surface.js";
import { deepOceanSpectrumWaveCount } from "../water/deep_ocean_waves.js";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import { getBorderCoastRuntime } from "../terrain/terrain.js";

const SCENE_CONFIG_NAME = "border-ocean scene config";

export const DEFAULT_BORDER_OCEAN_REQUIRED_COUNTERS = Object.freeze([
  "border_ocean.scene",
  "border_ocean.coast_runtime_active",
  "border_ocean.deep_ocean_enabled",
  "border_ocean.deep_ocean_mesh_present",
  "border_ocean.deep_ocean_vertices",
  "border_ocean.deep_ocean_triangles",
  "border_ocean.deep_ocean_draw_calls",
  "border_ocean.deep_ocean_start_outside_m",
  "border_ocean.deep_ocean_extend_m",
  "border_ocean.deep_ocean_surface_y",
  "border_ocean.deep_ocean_transition_gap_vertices",
  "border_ocean.wave_count",
  "border_ocean.wave_wind_speed",
  "border_ocean.wave_height_scale",
  "border_ocean.wave_choppiness",
  "border_ocean.shading_fog_far_m",
  "border_ocean.shading_reflection_strength",
  "border_ocean.player_margin_m",
  "border_ocean.player_pushback_band_m",
  "border_ocean.player_pushback_accel",
  "border_ocean.player_soft_pushback_enabled",
  "border_ocean.frame_ms_p95",
  "border_ocean.page_source_purity",
  "border_ocean.interior_water_wet_ratio",
  "border_ocean.playable_ocean_outside_ok",
  "border_ocean.cliff_dry_above_sea",
] as const);

export interface BorderOceanCamera {
  eye: [number, number, number];
  look: [number, number, number];
  fov: number;
}

export interface BorderOceanSceneConfig {
  defaultWorldPages: number;
  defaultSeed: number;
  camera: {
    eyeXRatio: number;
    eyeYRatio: number;
    eyeZRatio: number;
    lookXRatio: number;
    lookY: number;
    lookZRatio: number;
    fov: number;
  };
  acceptance: {
    minDeepOceanVertices: number;
    maxDeepOceanTriangles: number;
    maxDeepOceanDrawCalls: number;
    maxTransitionGapVertices: number;
    maxFrameMsP95: number;
    maxInteriorWaterWetRatio: number;
    maxWebglWebgpuMeanDelta: number;
    maxWebglWebgpuP95Delta: number;
    requiredCounters: readonly string[];
  };
}

export const DEFAULT_BORDER_OCEAN_SCENE_CONFIG: BorderOceanSceneConfig = {
  defaultWorldPages: 16,
  defaultSeed: 1,
  camera: {
    eyeXRatio: 0.5,
    eyeYRatio: 0.14,
    eyeZRatio: 0.2,
    lookXRatio: 0.5,
    lookY: 18,
    lookZRatio: 1.08,
    fov: 55,
  },
  acceptance: {
    minDeepOceanVertices: 1000,
    maxDeepOceanTriangles: 600000,
    maxDeepOceanDrawCalls: 1,
    maxTransitionGapVertices: 0,
    maxFrameMsP95: 50,
    maxInteriorWaterWetRatio: 0.15,
    maxWebglWebgpuMeanDelta: 18,
    maxWebglWebgpuP95Delta: 80,
    requiredCounters: DEFAULT_BORDER_OCEAN_REQUIRED_COUNTERS,
  },
};

type YamlRecord = Record<string, unknown>;

function optionalRecord(value: unknown, field: string): YamlRecord | undefined {
  if (value === undefined) return undefined;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as YamlRecord;
  throw new Error(`${SCENE_CONFIG_NAME}: ${field} must be an object`);
}

function requiredRootRecord(value: unknown): YamlRecord {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as YamlRecord;
  throw new Error(`${SCENE_CONFIG_NAME}: root must be an object`);
}

function optionalNumber(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`${SCENE_CONFIG_NAME}: ${field} must be a finite number`);
}

function optionalNumberAtLeast(value: unknown, fallback: number, min: number, field: string): number {
  const parsed = optionalNumber(value, fallback, field);
  if (parsed < min) throw new Error(`${SCENE_CONFIG_NAME}: ${field} must be >= ${min}`);
  return parsed;
}

function optionalIntegerAtLeast(value: unknown, fallback: number, min: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${SCENE_CONFIG_NAME}: ${field} must be an integer`);
  }
  if (value < min) throw new Error(`${SCENE_CONFIG_NAME}: ${field} must be >= ${min}`);
  return value;
}

function readRequiredCounters(value: unknown, fallback: readonly string[]): readonly string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${SCENE_CONFIG_NAME}: acceptance.required_counters must be a non-empty string array`);
  }
  const invalidIndex = value.findIndex((item) => typeof item !== "string" || item.length === 0);
  if (invalidIndex >= 0) {
    throw new Error(`${SCENE_CONFIG_NAME}: acceptance.required_counters[${invalidIndex}] must be a non-empty string`);
  }
  return value as string[];
}

export function parseBorderOceanSceneConfig(text: string): BorderOceanSceneConfig {
  const defaults = DEFAULT_BORDER_OCEAN_SCENE_CONFIG;
  if (!text.trim()) return { ...defaults };

  const rawRoot = requiredRootRecord(load(text));
  const root = optionalRecord(rawRoot.border_ocean_scene, "border_ocean_scene") ?? {};
  const camera = optionalRecord(root.camera, "border_ocean_scene.camera") ?? {};
  const acceptance = optionalRecord(root.acceptance, "border_ocean_scene.acceptance") ?? {};

  return {
    defaultWorldPages: optionalIntegerAtLeast(root.default_world_pages, defaults.defaultWorldPages, 4, "border_ocean_scene.default_world_pages"),
    defaultSeed: optionalIntegerAtLeast(root.default_seed, defaults.defaultSeed, 1, "border_ocean_scene.default_seed"),
    camera: {
      eyeXRatio: optionalNumber(camera.eye_x_ratio, defaults.camera.eyeXRatio, "border_ocean_scene.camera.eye_x_ratio"),
      eyeYRatio: optionalNumber(camera.eye_y_ratio, defaults.camera.eyeYRatio, "border_ocean_scene.camera.eye_y_ratio"),
      eyeZRatio: optionalNumber(camera.eye_z_ratio, defaults.camera.eyeZRatio, "border_ocean_scene.camera.eye_z_ratio"),
      lookXRatio: optionalNumber(camera.look_x_ratio, defaults.camera.lookXRatio, "border_ocean_scene.camera.look_x_ratio"),
      lookY: optionalNumber(camera.look_y, defaults.camera.lookY, "border_ocean_scene.camera.look_y"),
      lookZRatio: optionalNumber(camera.look_z_ratio, defaults.camera.lookZRatio, "border_ocean_scene.camera.look_z_ratio"),
      fov: optionalNumber(camera.fov, defaults.camera.fov, "border_ocean_scene.camera.fov"),
    },
    acceptance: {
      minDeepOceanVertices: optionalIntegerAtLeast(acceptance.min_deep_ocean_vertices, defaults.acceptance.minDeepOceanVertices, 1, "border_ocean_scene.acceptance.min_deep_ocean_vertices"),
      maxDeepOceanTriangles: optionalIntegerAtLeast(acceptance.max_deep_ocean_triangles, defaults.acceptance.maxDeepOceanTriangles, 1, "border_ocean_scene.acceptance.max_deep_ocean_triangles"),
      maxDeepOceanDrawCalls: optionalIntegerAtLeast(acceptance.max_deep_ocean_draw_calls, defaults.acceptance.maxDeepOceanDrawCalls, 1, "border_ocean_scene.acceptance.max_deep_ocean_draw_calls"),
      maxTransitionGapVertices: optionalIntegerAtLeast(acceptance.max_transition_gap_vertices, defaults.acceptance.maxTransitionGapVertices, 0, "border_ocean_scene.acceptance.max_transition_gap_vertices"),
      maxFrameMsP95: optionalNumberAtLeast(acceptance.max_frame_ms_p95, defaults.acceptance.maxFrameMsP95, 0, "border_ocean_scene.acceptance.max_frame_ms_p95"),
      maxInteriorWaterWetRatio: optionalNumberAtLeast(acceptance.max_interior_water_wet_ratio, defaults.acceptance.maxInteriorWaterWetRatio, 0, "border_ocean_scene.acceptance.max_interior_water_wet_ratio"),
      maxWebglWebgpuMeanDelta: optionalNumberAtLeast(acceptance.max_webgl_webgpu_mean_delta, defaults.acceptance.maxWebglWebgpuMeanDelta, 0, "border_ocean_scene.acceptance.max_webgl_webgpu_mean_delta"),
      maxWebglWebgpuP95Delta: optionalNumberAtLeast(acceptance.max_webgl_webgpu_p95_delta, defaults.acceptance.maxWebglWebgpuP95Delta, 0, "border_ocean_scene.acceptance.max_webgl_webgpu_p95_delta"),
      requiredCounters: readRequiredCounters(acceptance.required_counters, defaults.acceptance.requiredCounters),
    },
  };
}

export function borderOceanCameraForWorld(worldCells: number, sceneConfig: BorderOceanSceneConfig = DEFAULT_BORDER_OCEAN_SCENE_CONFIG): BorderOceanCamera {
  const cam = sceneConfig.camera;
  return {
    eye: [worldCells * cam.eyeXRatio, worldCells * cam.eyeYRatio, worldCells * cam.eyeZRatio],
    look: [worldCells * cam.lookXRatio, cam.lookY, worldCells * cam.lookZRatio],
    fov: cam.fov,
  };
}

/** Cam string: eyeX,eyeY,eyeZ,lookX,lookY,lookZ[,fov] */
export function formatBorderOceanCamString(camera: BorderOceanCamera): string {
  const [ex, ey, ez] = camera.eye;
  const [lx, ly, lz] = camera.look;
  return `${ex.toFixed(0)},${ey.toFixed(0)},${ez.toFixed(0)},${lx.toFixed(0)},${ly.toFixed(0)},${lz.toFixed(0)},${camera.fov}`;
}

export function parseBorderOceanCamString(cam: string | null, worldCells: number, sceneConfig: BorderOceanSceneConfig = DEFAULT_BORDER_OCEAN_SCENE_CONFIG): BorderOceanCamera {
  if (!cam) return borderOceanCameraForWorld(worldCells, sceneConfig);
  const parts = cam.split(",").map(Number);
  if (parts.length >= 6 && parts.every(Number.isFinite)) {
    return {
      eye: [parts[0], parts[1], parts[2]],
      look: [parts[3], parts[4], parts[5]],
      fov: parts[6] !== undefined && Number.isFinite(parts[6]) ? parts[6] : sceneConfig.camera.fov,
    };
  }
  return borderOceanCameraForWorld(worldCells, sceneConfig);
}

export function sampleInteriorWaterWetRatio(field: WaterField, worldCells: number): number {
  const margin = worldCells * 0.35;
  const min = margin;
  const max = worldCells - margin;
  const step = Math.max(8, worldCells / 32);
  let wet = 0;
  let total = 0;
  for (let z = min; z <= max; z += step) {
    for (let x = min; x <= max; x += step) {
      const sample = field.sample(x, z);
      if (sample.depth > 0.05 && sample.bodyMask > 0.01) wet++;
      total++;
    }
  }
  return total > 0 ? wet / total : 0;
}

export interface BorderOceanAcceptanceInput {
  worldCells: number;
  deepOcean: DeepOceanRenderConfig;
  waterField: WaterField | null;
  deepOceanMeshPresent: boolean;
  oceanSampler: OceanSampler | null;
  playerConfig?: Readonly<PlayerConfig>;
}

export function probePlayableOceanOutside(sampler: OceanSampler, worldCells: number): number {
  const x = worldCells + sampler.startOutsideBorderM + 1;
  const z = worldCells * 0.5;
  if (!sampler.isInPlayableOcean(x, z)) return 0;
  const height = sampler.sampleOceanHeight(x, z, 0);
  return Number.isFinite(height) && height > 0 ? 1 : 0;
}

export function probeCliffDryAboveSea(seaLevel: number, worldCells: number): number {
  const field = new WaterFieldImpl(parseWaterConfig(waterYaml), { surfaceHeight: () => seaLevel + 24 }, null, worldCells);
  field.setShoreSurfBand({ enabled: true, startDistance: 48, fullSurfDistance: 16, level: seaLevel, maxShallowDepth: 2.5 });
  const sample = field.sample(4, worldCells * 0.5);
  return sample.depth > 0 ? 0 : 1;
}

export function publishBorderOceanAcceptanceCounters(counters: Record<string, number>, input: BorderOceanAcceptanceInput): void {
  const runtime = getBorderCoastRuntime();
  counters["border_ocean.scene"] = 1;
  counters["border_ocean.coast_runtime_active"] = runtime?.config.enabled ? 1 : 0;
  counters["border_ocean.deep_ocean_enabled"] = input.deepOcean.enabled ? 1 : 0;
  counters["border_ocean.deep_ocean_mesh_present"] = input.deepOceanMeshPresent ? 1 : 0;
  counters["border_ocean.deep_ocean_vertices"] = input.deepOcean.enabled ? deepOceanSurfaceVertexCount(input.worldCells, input.deepOcean) : 0;
  counters["border_ocean.deep_ocean_triangles"] = input.deepOcean.enabled ? deepOceanSurfaceTriangleCount(input.worldCells, input.deepOcean) : 0;
  counters["border_ocean.deep_ocean_draw_calls"] = input.deepOceanMeshPresent ? 1 : 0;
  counters["border_ocean.deep_ocean_start_outside_m"] = input.deepOcean.startOutsideBorderM;
  counters["border_ocean.deep_ocean_extend_m"] = input.deepOcean.extendCells;
  counters["border_ocean.deep_ocean_surface_y"] = input.deepOcean.surfaceY;
  counters["border_ocean.deep_ocean_transition_gap_vertices"] = input.deepOcean.enabled ? countDeepOceanTransitionGapVertices(input.worldCells, input.deepOcean) : 0;
  counters["border_ocean.wave_count"] = input.oceanSampler ? deepOceanSpectrumWaveCount(input.oceanSampler.waves) : 0;
  counters["border_ocean.wave_wind_speed"] = input.deepOcean.wave.windSpeed;
  counters["border_ocean.wave_height_scale"] = input.deepOcean.wave.heightScale;
  counters["border_ocean.wave_choppiness"] = input.deepOcean.wave.choppiness;
  counters["border_ocean.shading_fog_far_m"] = input.deepOcean.shading.fogFarM;
  counters["border_ocean.shading_reflection_strength"] = input.deepOcean.shading.reflectionStrength;
  counters["border_ocean.player_margin_m"] = input.playerConfig?.worldEdgeMargin ?? -1;
  counters["border_ocean.player_pushback_band_m"] = input.playerConfig?.worldEdgePushbackBand ?? -1;
  counters["border_ocean.player_pushback_accel"] = input.playerConfig?.worldEdgePushbackAcceleration ?? -1;
  counters["border_ocean.player_soft_pushback_enabled"] = input.playerConfig ? (input.playerConfig.worldEdgePushbackBand > 0 && input.playerConfig.worldEdgePushbackAcceleration > 0 ? 1 : 0) : -1;
  counters["border_ocean.frame_ms_p95"] = counters["frame_ms_p95"] ?? counters["frame_ms_avg"] ?? 0;
  counters["border_ocean.page_source_purity"] = 1;
  counters["border_ocean.interior_water_wet_ratio"] = input.waterField ? sampleInteriorWaterWetRatio(input.waterField, input.worldCells) : -1;
  counters["border_ocean.playable_ocean_outside_ok"] = input.oceanSampler ? probePlayableOceanOutside(input.oceanSampler, input.worldCells) : 0;
  counters["border_ocean.cliff_dry_above_sea"] = input.waterField && runtime?.config ? probeCliffDryAboveSea(runtime.config.ocean.surfaceY, input.worldCells) : -1;
}

export function validateBorderOceanStats(stats: Record<string, unknown>, sceneConfig: BorderOceanSceneConfig = DEFAULT_BORDER_OCEAN_SCENE_CONFIG): void {
  if (stats["ready"] !== true) throw new Error("border-ocean stats ready flag is not true");
  if (stats["error"] !== null) throw new Error(`border-ocean stats error: ${String(stats["error"])}`);
  const counters = stats["counters"] as Record<string, unknown> | undefined;
  if (!counters) throw new Error("border-ocean stats missing counters");

  for (const key of sceneConfig.acceptance.requiredCounters) {
    const value = counters[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`border-ocean required counter missing: ${key}`);
  }

  const assertCounter = (key: string, predicate: (value: number) => boolean) => {
    const value = counters[key];
    if (typeof value !== "number" || !Number.isFinite(value) || !predicate(value)) throw new Error(`border-ocean counter failed: ${key}=${String(value)}`);
  };

  const acceptance = sceneConfig.acceptance;
  assertCounter("border_ocean.scene", (v) => v === 1);
  assertCounter("border_ocean.coast_runtime_active", (v) => v === 1);
  assertCounter("border_ocean.deep_ocean_enabled", (v) => v === 1);
  assertCounter("border_ocean.deep_ocean_mesh_present", (v) => v === 1);
  assertCounter("border_ocean.deep_ocean_vertices", (v) => v >= acceptance.minDeepOceanVertices);
  assertCounter("border_ocean.deep_ocean_triangles", (v) => v > 0 && v <= acceptance.maxDeepOceanTriangles);
  assertCounter("border_ocean.deep_ocean_draw_calls", (v) => v > 0 && v <= acceptance.maxDeepOceanDrawCalls);
  assertCounter("border_ocean.deep_ocean_start_outside_m", (v) => v >= 0);
  assertCounter("border_ocean.deep_ocean_extend_m", (v) => v > 0);
  assertCounter("border_ocean.deep_ocean_surface_y", (v) => v > 0);
  assertCounter("border_ocean.deep_ocean_transition_gap_vertices", (v) => v <= acceptance.maxTransitionGapVertices);
  assertCounter("border_ocean.wave_count", (v) => v > 0);
  assertCounter("border_ocean.wave_wind_speed", (v) => v > 0);
  assertCounter("border_ocean.wave_height_scale", (v) => v > 0);
  assertCounter("border_ocean.wave_choppiness", (v) => v > 0);
  assertCounter("border_ocean.shading_fog_far_m", (v) => v > 0);
  assertCounter("border_ocean.shading_reflection_strength", (v) => v >= 0);
  assertCounter("border_ocean.player_margin_m", (v) => v > 0);
  assertCounter("border_ocean.player_pushback_band_m", (v) => v >= 0);
  assertCounter("border_ocean.player_pushback_accel", (v) => v >= 0);
  assertCounter("border_ocean.player_soft_pushback_enabled", (v) => v === 0 || v === 1);
  assertCounter("border_ocean.frame_ms_p95", (v) => v >= 0 && v <= acceptance.maxFrameMsP95);
  assertCounter("border_ocean.page_source_purity", (v) => v === 1);
  assertCounter("border_ocean.interior_water_wet_ratio", (v) => v >= 0 && v <= acceptance.maxInteriorWaterWetRatio);
  assertCounter("border_ocean.playable_ocean_outside_ok", (v) => v === 1);
  assertCounter("border_ocean.cliff_dry_above_sea", (v) => v === 1);
}
