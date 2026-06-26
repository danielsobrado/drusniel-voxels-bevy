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
import { NAADF_SCENES } from "../../naadf/integration.js";
import { DEFAULT_MEADOW_WEATHER_SETTINGS } from "../../weather/meadow.js";
import {
  DEFAULT_RAIN_WEATHER_SETTINGS,
  DEFAULT_SANDSTORM_WEATHER_SETTINGS,
  DEFAULT_SNOW_WEATHER_SETTINGS,
  DEFAULT_STORM_WEATHER_SETTINGS,
} from "../../weather/rain.js";
import { RIVER_PARITY_TEST_SCENE } from "../../water/riverParityScene.js";

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
  queryBorderOceanScene: boolean;
  queryNaadfScene: boolean;
}

const SHADOW_PROXY_LONG_VIEW_SCENES = new Set([
  "long-view-shadow-proxy-basic",
  "long-view-shadow-proxy-off",
  "long-view-shadow-proxy-debug-visible",
  "long-view-shadow-proxy-forest",
  "long-view-shadow-proxy-low-sun",
]);

export function parseSceneQueryFlags(searchParams: URLSearchParams): SceneQueryFlags {
  const queryScene = searchParams.get("scene");
  const isNaadfScene = queryScene !== null && NAADF_SCENES.has(queryScene);
  const isShadowProxyScene = queryScene !== null && SHADOW_PROXY_LONG_VIEW_SCENES.has(queryScene);
  return {
    queryScene,
    queryGrassPerfScene: queryScene === "grass-perf",
    queryTreePerfScene: queryScene === "trees-perf" || searchParams.get("treesPerf") === "1",
    queryTreeGpuRing: searchParams.get("treeGpu") === "1" || searchParams.get("treeGpuRing") === "1",
    queryForestFloorScene: queryScene === "forest-floor",
    queryLongViewScene: queryScene === "long-view-4km"
      || queryScene === "long-view-forest-4km"
      || queryScene === "long-view-edit-stress"
      || queryScene === RIVER_PARITY_TEST_SCENE
      || queryScene === "infinite-stream-straight"
      || queryScene === "infinite-stream-fast-turn"
      || queryScene === "infinite-stream-far-summary"
      || queryScene === "infinite-stream-slow-builds"
      || queryScene === "infinite-far-shell-straight"
      || queryScene === "infinite-far-shell-fast-turn"
      || queryScene === "infinite-far-shell-mountain-approach"
      || queryScene === "long-view-8km"
      || queryScene === "long-view-16km"
      || isNaadfScene
      || isShadowProxyScene,
    queryBorderOceanScene: queryScene === "border-ocean",
    queryNaadfScene: isNaadfScene || searchParams.get("naadf") === "1",
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
  [RIVER_PARITY_TEST_SCENE]: "long_view_forest_4km",
  "infinite-stream-straight": "infinite_stream_straight",
  "infinite-stream-fast-turn": "infinite_stream_fast_turn",
  "infinite-stream-far-summary": "infinite_stream_far_summary",
  "infinite-stream-slow-builds": "infinite_stream_slow_builds",
  "infinite-far-shell-straight": "infinite_far_shell_straight",
  "infinite-far-shell-fast-turn": "infinite_far_shell_fast_turn",
  "infinite-far-shell-mountain-approach": "infinite_far_shell_mountain_approach",
  "long-view-8km": "long_view_8km",
  "long-view-16km": "long_view_16km",
  "long-view-shadow-proxy-basic": "long_view_4km",
  "long-view-shadow-proxy-off": "long_view_4km",
  "long-view-shadow-proxy-debug-visible": "long_view_4km",
  "long-view-shadow-proxy-forest": "long_view_forest_4km",
  "long-view-shadow-proxy-low-sun": "long_view_4km",
  "infinite-naadf-flat": "infinite_stream_straight",
  "infinite-naadf-hills": "infinite_stream_straight",
  "infinite-naadf-mountains": "infinite_far_shell_mountain_approach",
  "infinite-naadf-fast-flight": "infinite_stream_straight",
  "infinite-naadf-fast-turn": "infinite_stream_fast_turn",
  "infinite-naadf-forest": "long_view_forest_4km",
  "infinite-naadf-sun-visibility": "long_view_4km",
  "infinite-naadf-stress-missing": "infinite_stream_slow_builds",
  "infinite-naadf-far": "infinite_far_shell_straight",
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
  queryTerrainMaterial: string | null;
  queryDebugMaterialBands: boolean;
  queryDebugSlope: boolean;
  queryDebugFarNormals: boolean;
  queryDebugHaze: boolean;
  queryFreezeMaterialLod: boolean;
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
    queryTerrainMaterial: searchParams.get("terrainMaterial"),
    queryDebugMaterialBands: searchParams.get("debugMaterialBands") === "1",
    queryDebugSlope: searchParams.get("debugSlope") === "1",
    queryDebugFarNormals: searchParams.get("debugFarNormals") === "1",
    queryDebugHaze: searchParams.get("debugHaze") === "1",
    queryFreezeMaterialLod: searchParams.get("freezeMaterialLod") === "1",
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
