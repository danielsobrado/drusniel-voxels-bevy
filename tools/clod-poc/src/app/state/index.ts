import { getAudioState } from "../../audio/index.js";
import type { ClodPagesConfig } from "../../config.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import type { WeatherMode } from "../clod_constants.js";
import type { TerrainMaterialSource } from "../../terrain/material/terrain_material_constants.js";
import type { GrassSettings } from "../../grass/grass_config.js";
import type { StoneSettings } from "../../stones/stone_config.js";
import type { TreeSettings } from "../../trees/tree_config.js";
import type { UnderstorySettings } from "../../understory/understory_config.js";
import type { ForestLightingSettings } from "../../forest_lighting/forest_lighting_config.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import { isLowSunScene, sceneFromSearchParams } from "../../scenes/scene_registry.js";
import { clampGrassDepthPrepassTier, DEFAULT_GRASS_DEPTH_PREPASS_TIER } from "../../grass/grass_depth_prepass_runtime.js";
import { parseTreeDepthPrepassMaxLod } from "../../trees/tree_depth_prepass_runtime.js";
import type { TreeDepthPrepassMaxLod } from "../../trees/tree_depth_prepass_runtime.js";
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
  stagedImport: VoxelProjectArchiveContents | null;
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
  weatherDefaults: { intensity: number; windX?: number; windZ?: number };
  grassConfig: GrassSettings;
  stoneConfig: StoneSettings;
  treeConfig: TreeSettings;
  understoryConfig: UnderstorySettings;
  forestLightingConfig: ForestLightingSettings;
  waterConfig: WaterConfig;
  digHoldIntervalMs: number;
}

const TREE_RUNTIME_BUDGET = {
  distance: 420,
  maxInstances: 6000,
  gpuMaxVisible: 128000,
  minSpacing: 6.8,
} as const;

const POPULATED_PERF_FLAGS = ["populatedPerf", "biomePerf"] as const;

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

function numberParam(searchParams: URLSearchParams, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nonNegativeNumberParam(searchParams: URLSearchParams, keys: readonly string[]): number | null {
  const value = numberParam(searchParams, keys);
  return value !== null && value >= 0 ? value : null;
}

function queryFlagEnabled(searchParams: URLSearchParams, keys: readonly string[], defaultValue: boolean): boolean {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  }
  return defaultValue;
}

function grassDepthPrepassTierFromQuery(searchParams: URLSearchParams): number {
  const enabled = queryFlagEnabled(searchParams, ["grassDepthPrepass", "vegetationDepthPrepass", "prepass"], true);
  if (!enabled) return 0;
  return clampGrassDepthPrepassTier(
    nonNegativeNumberParam(searchParams, ["grassDepthPrepassTier", "prepassTier"]) ?? DEFAULT_GRASS_DEPTH_PREPASS_TIER,
  );
}

function treeDepthPrepassMaxLodFromQuery(searchParams: URLSearchParams): TreeDepthPrepassMaxLod {
  const enabled = queryFlagEnabled(searchParams, ["treePrepass", "prepass"], true);
  return enabled ? parseTreeDepthPrepassMaxLod(searchParams.get("treePrepassMaxLod")) : "none";
}

function clampTreeRuntimeState(state: ClodAppState): void {
  state.treeDistance = Math.min(Math.max(0, state.treeDistance), TREE_RUNTIME_BUDGET.distance);
  state.treeMaxInstances = Math.floor(Math.min(Math.max(0, state.treeMaxInstances), TREE_RUNTIME_BUDGET.maxInstances));
  state.treeGpuMaxVisible = Math.floor(Math.min(Math.max(0, state.treeGpuMaxVisible), TREE_RUNTIME_BUDGET.gpuMaxVisible));
  state.treeSpacing = Math.max(state.treeSpacing, TREE_RUNTIME_BUDGET.minSpacing);
  if (state.treeShadowMaxLod === "none") state.treeShadowMaxLod = "near";
}

function populatedPerfEnabled(searchParams: URLSearchParams): boolean {
  return queryFlagEnabled(searchParams, POPULATED_PERF_FLAGS, false);
}

function applyPerfUiAndDebugPreset(state: ClodAppState): void {
  state.proceduralMicroNormals = false;
  state.postProcessEnabled = false;
  state.postProcessDebugMode = "off";
  if (!state.liveBubblePinned) state.bubble = false;
  state.showBounds = false;
  state.showSeamPoints = false;
  state.showCrossLodBorders = false;
  state.showNodeLabels = false;
  state.showLockedBorderVertices = false;
}

function applyClodPerfTerrainPreset(state: ClodAppState): void {
  state.clodPerfMode = true;
  state.colorByLod = true;
  state.albedo = false;
  state.normalMap = false;
  state.triplanar = false;
  state.terrainMaterialSource = "debug_flat";
  state.proceduralDebugMode = "page LOD";
}

function applyPopulatedPerfPreset(state: ClodAppState, params: CreateClodAppStateParams): void {
  applyPerfUiAndDebugPreset(state);
  state.clodPerfMode = false;
  state.grassEnabled = true;
  state.stonesEnabled = true;
  state.treesEnabled = true;
  state.understoryEnabled = true;
  state.waterEnabled = true;
  state.weatherMode = "off";
  if (params.isWebGpu) {
    state.grassShaderMode = "webgpu-ring-v1";
    state.treeGpuEnabled = true;
  }
}

function applyScenePresets(state: ClodAppState, params: CreateClodAppStateParams): void {
  const scene = sceneFromSearchParams(params.searchParams);
  const populatedPerf = populatedPerfEnabled(params.searchParams);
  if (params.isWebGpu) state.normalDivergence = false;
  if (params.queryPerfMode || populatedPerf) {
    applyPerfUiAndDebugPreset(state);
  }
  if (params.queryPerfMode && !populatedPerf) {
    applyClodPerfTerrainPreset(state);
    state.grassEnabled = false;
    state.stonesEnabled = false;
    state.treesEnabled = false;
    state.waterEnabled = false;
    state.weatherMode = "off";
  }
  if (populatedPerf) {
    applyPopulatedPerfPreset(state, params);
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
  const treeGpuParam = params.searchParams.get("treeGpu") ?? params.searchParams.get("treeGpuRing");
  if (params.isWebGpu && treeGpuParam !== "0") state.treeGpuEnabled = true;
  if (params.queryTreeGpuRing) {
    state.treesEnabled = true;
    state.treeGpuEnabled = true;
  }
  if (treeGpuParam === "0") state.treeGpuEnabled = false;
  const treeDistance = nonNegativeNumberParam(params.searchParams, ["treeDistance", "treeDistanceM"]);
  if (treeDistance !== null) state.treeDistance = treeDistance;
  const treeMaxInstances = nonNegativeNumberParam(params.searchParams, ["treeMaxInstances", "treeMax"]);
  if (treeMaxInstances !== null) state.treeMaxInstances = Math.floor(treeMaxInstances);
  const treeGpuMaxVisible = nonNegativeNumberParam(params.searchParams, ["treeGpuMaxVisible", "treeGpuMax"]);
  if (treeGpuMaxVisible !== null) state.treeGpuMaxVisible = Math.floor(treeGpuMaxVisible);
  const treePrepassMaxLod = params.searchParams.get("treePrepassMaxLod");
  if (treePrepassMaxLod !== null) state.treeDepthPrepassMaxLod = parseTreeDepthPrepassMaxLod(treePrepassMaxLod);
  if (params.searchParams.get("treePrepass") === "0" || params.searchParams.get("prepass") === "0") state.treeDepthPrepassMaxLod = "none";
  if (params.searchParams.get("understory") === "1") state.understoryEnabled = true;
  if (params.searchParams.get("understory") === "0") state.understoryEnabled = false;
  if (params.searchParams.get("water") === "1") state.waterEnabled = true;
  if (params.searchParams.get("water") === "0") state.waterEnabled = false;
  const postProcessParam = params.searchParams.get("postProcess") ?? params.searchParams.get("postprocess");
  if (postProcessParam === "1") state.postProcessEnabled = true;
  if (postProcessParam === "0") state.postProcessEnabled = false;
  if (params.searchParams.get("freeze") === "1") state.freeze = true;
  if (params.searchParams.get("freeze") === "0") state.freeze = false;
  const sunElevation = numberParam(params.searchParams, ["sunElevationDeg", "sunElevation"]);
  if (sunElevation !== null) state.sunElevationDeg = sunElevation;
  const sunAzimuth = numberParam(params.searchParams, ["sunAzimuthDeg", "sunAzimuth"]);
  if (sunAzimuth !== null) state.sunAzimuthDeg = sunAzimuth;
  if (isLowSunScene(scene)) {
    state.sunElevationDeg = 8;
  }
  const clodShadowOverlayQuery = params.searchParams.get("clodShadowOverlay");
  if (clodShadowOverlayQuery === "off" || clodShadowOverlayQuery === "casters" || clodShadowOverlayQuery === "all") {
    state.clodShadowOverlayMode = clodShadowOverlayQuery;
  }
  const clodShadowProxyQuery = params.searchParams.get("clodShadowProxy");
  if (clodShadowProxyQuery === "off" || clodShadowProxyQuery === "proxy-meshes") {
    state.clodShadowProxyView = clodShadowProxyQuery;
  }
}

export function createClodAppState(params: CreateClodAppStateParams): ClodAppState {
  const audio = getAudioState();
  const grassDepthPrepassTier = grassDepthPrepassTierFromQuery(params.searchParams);
  const treeDepthPrepassMaxLod = treeDepthPrepassMaxLodFromQuery(params.searchParams);
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
      grassDepthPrepassEnabled: grassDepthPrepassTier > 0,
      grassDepthPrepassTier,
      treeDepthPrepassMaxLod,
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
  if (params.isWebGpu && !params.queryPerfMode) {
    state.grassShaderMode = "webgpu-ring-v1";
  }
  clampTreeRuntimeState(state);
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

// UI-state accessors (restored — accidentally deleted by c0eb25ce while doing
// unrelated parity-shot work). ClodAppState structurally satisfies each
// controller's UI-state interface; these narrow it for the *_startup callers.
export function grassUiState(state: ClodAppState): import("../../runtime/vegetation/grass_controller.js").GrassControllerUiState {
  return state;
}

export function stoneUiState(state: ClodAppState): import("../../runtime/vegetation/stone_controller.js").StoneControllerUiState {
  return state;
}

export function treeUiState(state: ClodAppState): import("../../runtime/vegetation/tree_controller.js").TreeControllerUiState {
  clampTreeRuntimeState(state);
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
