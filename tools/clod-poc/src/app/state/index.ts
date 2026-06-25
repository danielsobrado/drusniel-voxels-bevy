import { getAudioState } from "../../audio/index.js";
import type { ClodPagesConfig } from "../../config.js";
import type { ProjectArchiveContents } from "../../project/project_archive.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import type { WeatherMode } from "../clod_constants.js";
import type { TerrainMaterialSource } from "../../terrain/material/terrain_material_constants.js";
import type { GrassSettings } from "../../grass/grass_config.js";
import type { StoneSettings } from "../../stones/stone_config.js";
import type { TreeSettings } from "../../trees/tree_config.js";
import type { UnderstorySettings } from "../../understory/understory_config.js";
import type { ForestLightingSettings } from "../../forest_lighting/forest_lighting_config.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import { applyValidatedArchiveState } from "./archive_state_mapper.js";
import { createBrushSliceState } from "./brush_state.js";
import { createClodSliceState } from "./clod_state.js";
import { createEnvironmentSliceState } from "./environment_state.js";
import { createTerrainMaterialSliceState } from "./terrain_material_state.js";
import { createVegetationSliceState } from "./vegetation_state.js";
import { createWaterSliceState } from "./water_state.js";
import { createWeatherSliceState } from "./weather_state.js";
import type { BrushSliceState } from "./brush_state.js";
import type { ClodSliceState } from "./clod_state.js";
import type { EnvironmentSliceState } from "./environment_state.js";
import type { TerrainMaterialSliceState } from "./terrain_material_state.js";
import type { VegetationSliceState } from "./vegetation_state.js";
import type { WaterSliceState } from "./water_state.js";
import type { WeatherSliceState } from "./weather_state.js";
import type { AppStateSlices } from "./types.js";

export type ClodAppState = ClodSliceState
  & TerrainMaterialSliceState
  & BrushSliceState
  & EnvironmentSliceState
  & VegetationSliceState
  & WaterSliceState
  & WeatherSliceState;

export interface CreateClodAppStateParams {
  cfg: ClodPagesConfig;
  clodRuntime: ClodRuntimeConfig;
  searchParams: URLSearchParams;
  stagedImport: ProjectArchiveContents | null;
  isWebGpu: boolean;
  queryPerfMode: boolean;
  queryWebGpuSelection: boolean;
  queryMaterialTiers: boolean;
  queryGrassPerfScene: boolean;
  queryTreePerfScene: boolean;
  queryForestFloorScene: boolean;
  queryTreeGpuRing: boolean;
  queryFarShell: boolean;
  isLongView: boolean;
  queryGrassRingGrid: number | null;
  queryGrassRingCell: number | null;
  queryTerrainMaterialSource: TerrainMaterialSource | null;
  queryWeatherMode: WeatherMode;
  queryWeatherIntensity: number;
  queryWeatherWindX: number;
  queryWeatherWindZ: number;
  weatherDefaults: { intensity: number; windX: number; windZ: number };
  grassConfig: GrassSettings;
  stoneConfig: StoneSettings;
  treeConfig: TreeSettings;
  understoryConfig: UnderstorySettings;
  forestLightingConfig: ForestLightingSettings;
  waterConfig: WaterConfig;
  digHoldIntervalMs: number;
}

function mergeSlices(slices: AppStateSlices): ClodAppState {
  return {
    ...slices.clod,
    ...slices.terrainMaterial,
    ...slices.brush,
    ...slices.environment,
    ...slices.vegetation,
    ...slices.water,
    ...slices.weather,
  };
}

function applyScenePresets(state: ClodAppState, params: CreateClodAppStateParams): void {
  if (params.isWebGpu) state.normalDivergence = false;
  if (params.queryPerfMode) {
    state.clodPerfMode = true;
    state.colorByLod = true;
    state.albedo = false;
    state.normalMap = false;
    state.triplanar = false;
    state.terrainMaterialSource = "debug_flat";
    state.proceduralDebugMode = "page LOD";
    state.proceduralMicroNormals = false;
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.bubble = false;
    state.showBounds = false;
    state.showSeamPoints = false;
    state.showCrossLodBorders = false;
    state.showNodeLabels = false;
    state.showLockedBorderVertices = false;
    state.grassEnabled = false;
    state.stonesEnabled = false;
    state.treesEnabled = false;
    state.waterEnabled = false;
    state.weatherMode = "off";
  }
  if (params.queryGrassPerfScene) {
    state.grassEnabled = true;
    state.grassShaderMode = params.isWebGpu ? "webgpu-ring-v1" : "terrain-patch-v2";
    state.grassDistance = params.grassConfig.distance;
    state.grassMaxBlades = params.grassConfig.maxBlades;
    state.stonesEnabled = false;
    state.treesEnabled = false;
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.showBounds = false;
    state.showSeamPoints = false;
    state.showCrossLodBorders = false;
    state.showNodeLabels = false;
    state.showLockedBorderVertices = false;
  }
  if (params.queryTreePerfScene) {
    state.grassEnabled = false;
    state.stonesEnabled = false;
    state.treesEnabled = true;
    state.understoryEnabled = params.searchParams.get("understory") === "1";
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.showBounds = false;
    state.showSeamPoints = false;
    state.showCrossLodBorders = false;
    state.showNodeLabels = false;
    state.showLockedBorderVertices = false;
  }
  if (params.queryForestFloorScene) {
    state.grassEnabled = true;
    state.stonesEnabled = false;
    state.treesEnabled = true;
    state.understoryEnabled = true;
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.showBounds = false;
    state.showSeamPoints = false;
    state.showCrossLodBorders = false;
    state.showNodeLabels = false;
    state.showLockedBorderVertices = false;
  }
  if (params.searchParams.get("stones") === "1") state.stonesEnabled = true;
  if (params.searchParams.get("stones") === "0") state.stonesEnabled = false;
  if (params.searchParams.get("grass") === "1") state.grassEnabled = true;
  if (params.searchParams.get("grass") === "0") state.grassEnabled = false;
  if (params.searchParams.get("trees") === "1") state.treesEnabled = true;
  if (params.searchParams.get("trees") === "0") state.treesEnabled = false;
  if (params.queryTreeGpuRing) {
    state.treesEnabled = true;
    state.treeGpuEnabled = true;
  }
  if (params.searchParams.get("understory") === "1") state.understoryEnabled = true;
  if (params.searchParams.get("understory") === "0") state.understoryEnabled = false;
}

export function createClodAppState(params: CreateClodAppStateParams): ClodAppState {
  const audio = getAudioState();
  const slices: AppStateSlices = {
    clod: createClodSliceState({
      cfg: params.cfg,
      queryPerfMode: params.queryPerfMode,
      queryWebGpuSelection: params.queryWebGpuSelection,
      queryMaterialTiers: params.queryMaterialTiers,
      queryFarShell: params.queryFarShell,
      isLongView: params.isLongView,
      profileEnabled: params.searchParams.get("profile") === "1",
    }),
    terrainMaterial: createTerrainMaterialSliceState({
      queryPerfMode: params.queryPerfMode,
      queryTerrainMaterialSource: params.queryTerrainMaterialSource,
      terrainTriplanar: !params.queryPerfMode && params.searchParams.get("terrainTriplanar") !== "0",
    }),
    brush: createBrushSliceState(params.digHoldIntervalMs),
    environment: createEnvironmentSliceState({
      queryPerfMode: params.queryPerfMode,
      audioEnabled: audio.enabled,
      audioVolume: audio.masterVolume,
    }),
    vegetation: createVegetationSliceState({
      grassConfig: params.grassConfig,
      stoneConfig: params.stoneConfig,
      treeConfig: params.treeConfig,
      understoryConfig: params.understoryConfig,
      forestLightingConfig: params.forestLightingConfig,
      grassRingDebug: params.searchParams.get("grassRingDebug") === "1",
    }),
    water: createWaterSliceState(params.waterConfig),
    weather: createWeatherSliceState({
      queryWeatherMode: params.queryWeatherMode,
      queryWeatherIntensity: params.queryWeatherIntensity,
      queryWeatherWindX: params.queryWeatherWindX,
      queryWeatherWindZ: params.queryWeatherWindZ,
      weatherDefaults: params.weatherDefaults,
    }),
  };

  if (params.stagedImport) {
    applyValidatedArchiveState(slices, params.stagedImport.manifest);
  }

  const state = mergeSlices(slices);
  Object.defineProperty(state, "slices", { value: slices, enumerable: false });
  applyScenePresets(state, params);
  return state;
}

export type {
  AppStateSlices,
} from "./types.js";
export type { StoneControllerUiState } from "../../runtime/vegetation/stone_controller.js";
export type { TreeControllerUiState } from "../../runtime/vegetation/tree_controller.js";
export type { UnderstoryControllerUiState } from "../../runtime/vegetation/understory_controller.js";
export type { ForestLightingControllerUiState } from "../../runtime/forest_lighting/forest_lighting_controller.js";
export type { WaterControllerUiState } from "../../runtime/water_weather/water_controller.js";

export function grassUiState(state: ClodAppState): import("../../runtime/vegetation/grass_controller.js").GrassControllerUiState {
  return state;
}

export function stoneUiState(state: ClodAppState): import("../../runtime/vegetation/stone_controller.js").StoneControllerUiState {
  return state;
}

export function treeUiState(state: ClodAppState): import("../../runtime/vegetation/tree_controller.js").TreeControllerUiState {
  return state;
}

export function understoryUiState(state: ClodAppState): import("../../runtime/vegetation/understory_controller.js").UnderstoryControllerUiState {
  return state;
}

export function forestLightingUiState(state: ClodAppState): import("../../runtime/forest_lighting/forest_lighting_controller.js").ForestLightingControllerUiState {
  return state;
}

export function waterUiState(state: ClodAppState): import("../../runtime/water_weather/water_controller.js").WaterControllerUiState {
  return state;
}
