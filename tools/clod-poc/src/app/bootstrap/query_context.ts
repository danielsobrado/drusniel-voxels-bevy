import type { WeatherMode } from "../../app/clod_constants.js";
import { parseReadbackMode, type WebGpuReadbackMode } from "../../core/webgpu_readback_mode.js";
import {
  parsePhase0Config,
  type Phase0Config,
  type Phase0SceneConfig,
  type Phase0StreamingConfig,
} from "../../phase0/phase0_config.js";
import {
  terrainMaterialSourceParam,
  type TerrainMaterialSource,
} from "../../terrain/material/terrain_material_constants.js";
import { DEFAULT_MEADOW_WEATHER_SETTINGS } from "../../weather/meadow.js";
import {
  DEFAULT_RAIN_WEATHER_SETTINGS,
  DEFAULT_SANDSTORM_WEATHER_SETTINGS,
  DEFAULT_SNOW_WEATHER_SETTINGS,
  DEFAULT_STORM_WEATHER_SETTINGS,
} from "../../weather/rain.js";

const positiveNumberParam = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export interface SceneQueryFlags {
  queryScene: string | null;
  queryGrassPerfScene: boolean;
  queryTreePerfScene: boolean;
  queryTreeGpuRing: boolean;
  queryForestFloorScene: boolean;
  queryLongViewScene: boolean;
}

export function parseSceneQueryFlags(searchParams: URLSearchParams): SceneQueryFlags {
  const queryScene = searchParams.get("scene");
  return {
    queryScene,
    queryGrassPerfScene: queryScene === "grass-perf",
    queryTreePerfScene: queryScene === "trees-perf" || searchParams.get("treesPerf") === "1",
    queryTreeGpuRing: searchParams.get("treeGpu") === "1" || searchParams.get("treeGpuRing") === "1",
    queryForestFloorScene: queryScene === "forest-floor",
    queryLongViewScene: queryScene === "long-view-4km"
      || queryScene === "long-view-forest-4km"
      || queryScene === "long-view-edit-stress"
      || queryScene === "infinite-stream-straight"
      || queryScene === "infinite-stream-fast-turn"
      || queryScene === "infinite-stream-far-summary"
      || queryScene === "infinite-stream-slow-builds",
  };
}

export interface Phase0SceneContext {
  phase0Config: Phase0Config;
  activePhase0SceneKey: string | undefined;
  activePhase0Scene: Phase0SceneConfig | undefined;
  phase0TargetVisibleM: number;
  phase0Streaming: Phase0StreamingConfig;
  phase0VelocityX: number;
  phase0VelocityZ: number;
}

const sceneNameToConfigKey: Record<string, string> = {
  "long-view-4km": "long_view_4km",
  "long-view-forest-4km": "long_view_forest_4km",
  "long-view-edit-stress": "long_view_edit_stress",
  "infinite-stream-straight": "infinite_stream_straight",
  "infinite-stream-fast-turn": "infinite_stream_fast_turn",
  "infinite-stream-far-summary": "infinite_stream_far_summary",
  "infinite-stream-slow-builds": "infinite_stream_slow_builds",
};

export function parsePhase0SceneContext(
  queryScene: string | null,
  phase0ConfigText: string,
): Phase0SceneContext {
  const phase0Config = parsePhase0Config(phase0ConfigText);
  const activePhase0SceneKey = queryScene ? sceneNameToConfigKey[queryScene] : undefined;
  const activePhase0Scene = activePhase0SceneKey
    ? phase0Config.phase0.scenes[activePhase0SceneKey]
    : undefined;
  const phase0TargetVisibleM = activePhase0Scene?.require_visible_m ?? phase0Config.phase0.target_visible_m;
  const phase0Streaming = phase0Config.phase0.streaming;
  let phase0VelocityX = 0;
  let phase0VelocityZ = 0;
  if (activePhase0Scene?.camera.mode === "scripted" && activePhase0Scene.camera.speed_mps !== undefined) {
    const speed = activePhase0Scene.camera.speed_mps;
    const dirDeg = activePhase0Scene.camera.direction_degrees ?? 90;
    const dirRad = (dirDeg * Math.PI) / 180;
    phase0VelocityX = Math.cos(dirRad) * speed;
    phase0VelocityZ = Math.sin(dirRad) * speed;
  }
  return {
    phase0Config,
    activePhase0SceneKey,
    activePhase0Scene,
    phase0TargetVisibleM,
    phase0Streaming,
    phase0VelocityX,
    phase0VelocityZ,
  };
}

export interface ClodRuntimeQueryFlags {
  queryFarShell: boolean;
  queryCanopy: boolean;
  queryPerfMode: boolean;
  queryWebGpuSelection: boolean;
  queryReadbackMode: WebGpuReadbackMode;
  queryMaterialTiers: boolean;
  queryWebGpuParity: boolean;
  queryTerrainMaterialSource: TerrainMaterialSource | null;
  queryGrassRingGrid: number | null;
  queryGrassRingCell: number | null;
  textureMipmapsEnabled: boolean;
}

export function parseClodRuntimeQueryFlags(searchParams: URLSearchParams): ClodRuntimeQueryFlags {
  return {
    queryFarShell: searchParams.get("farShell") === "1",
    queryCanopy: searchParams.get("canopy") === "1",
    queryPerfMode: searchParams.get("clodPerf") === "1",
    queryWebGpuSelection: searchParams.get("webgpuSelection") === "1",
    queryReadbackMode: parseReadbackMode(searchParams),
    queryMaterialTiers: searchParams.get("materialTiers") === "1",
    queryWebGpuParity: searchParams.get("webgpuParity") === "1",
    queryTerrainMaterialSource: terrainMaterialSourceParam(searchParams.get("terrainMaterial")),
    queryGrassRingGrid: positiveNumberParam(searchParams.get("grassRingGrid")),
    queryGrassRingCell: positiveNumberParam(searchParams.get("grassRingCell")),
    textureMipmapsEnabled: searchParams.get("textureMipmaps") !== "0",
  };
}

export interface WeatherQueryContext {
  queryWeatherMode: WeatherMode;
  weatherDefaults: { enabled: boolean; intensity: number; windX?: number; windZ?: number };
  queryWeatherIntensity: number;
  queryWeatherWindX: number;
  queryWeatherWindZ: number;
}

export function parseWeatherQueryContext(searchParams: URLSearchParams): WeatherQueryContext {
  const weatherParam = searchParams.get("weather");
  const queryWeatherMode: WeatherMode = weatherParam === "off"
    ? "off"
    : searchParams.get("sandstorm") === "1"
      || searchParams.get("sand") === "1"
      || weatherParam === "sandstorm"
      || weatherParam === "sand"
      ? "sandstorm"
      : searchParams.get("snow") === "1" || weatherParam === "snow"
        ? "snow"
        : searchParams.get("storm") === "1" || weatherParam === "storm"
          ? "storm"
          : searchParams.get("rain") === "1" || weatherParam === "rain"
            ? "rain"
            : searchParams.get("meadow") === "1" || searchParams.get("pollen") === "1" || weatherParam === "meadow" || weatherParam === "pollen"
              ? "meadow"
              : "meadow";
  const weatherDefaults = queryWeatherMode === "meadow"
    ? DEFAULT_MEADOW_WEATHER_SETTINGS
    : queryWeatherMode === "sandstorm"
      ? DEFAULT_SANDSTORM_WEATHER_SETTINGS
      : queryWeatherMode === "snow"
        ? DEFAULT_SNOW_WEATHER_SETTINGS
        : queryWeatherMode === "storm"
          ? DEFAULT_STORM_WEATHER_SETTINGS
          : DEFAULT_RAIN_WEATHER_SETTINGS;
  const weatherIntensityParam = searchParams.get("weatherIntensity")
    ?? (queryWeatherMode === "meadow"
      ? searchParams.get("meadowIntensity") ?? searchParams.get("pollenIntensity")
      : queryWeatherMode === "sandstorm"
        ? searchParams.get("sandstormIntensity") ?? searchParams.get("sandIntensity")
        : queryWeatherMode === "snow"
          ? searchParams.get("snowIntensity")
          : queryWeatherMode === "storm"
            ? searchParams.get("stormIntensity")
            : searchParams.get("rainIntensity"));
  const weatherWindXParam = searchParams.get("weatherWindX")
    ?? (queryWeatherMode === "meadow"
      ? searchParams.get("meadowWindX") ?? searchParams.get("pollenWindX")
      : queryWeatherMode === "sandstorm"
        ? searchParams.get("sandstormWindX") ?? searchParams.get("sandWindX")
        : queryWeatherMode === "snow"
          ? searchParams.get("snowWindX")
          : queryWeatherMode === "storm"
            ? null
            : searchParams.get("rainWindX"));
  const weatherWindZParam = searchParams.get("weatherWindZ")
    ?? (queryWeatherMode === "meadow"
      ? searchParams.get("meadowWindZ") ?? searchParams.get("pollenWindZ")
      : queryWeatherMode === "sandstorm"
        ? searchParams.get("sandstormWindZ") ?? searchParams.get("sandWindZ")
        : queryWeatherMode === "snow"
          ? searchParams.get("snowWindZ")
          : queryWeatherMode === "storm"
            ? null
            : searchParams.get("rainWindZ"));
  return {
    queryWeatherMode,
    weatherDefaults,
    queryWeatherIntensity: weatherIntensityParam === null ? Number.NaN : Number(weatherIntensityParam),
    queryWeatherWindX: weatherWindXParam === null ? Number.NaN : Number(weatherWindXParam),
    queryWeatherWindZ: weatherWindZParam === null ? Number.NaN : Number(weatherWindZParam),
  };
}

export type BootstrapQueryContext = SceneQueryFlags & Phase0SceneContext & ClodRuntimeQueryFlags;

export function parseBootstrapQueryContext(
  searchParams: URLSearchParams,
  phase0ConfigText: string,
): BootstrapQueryContext {
  const scene = parseSceneQueryFlags(searchParams);
  return {
    ...scene,
    ...parsePhase0SceneContext(scene.queryScene, phase0ConfigText),
    ...parseClodRuntimeQueryFlags(searchParams),
  };
}
