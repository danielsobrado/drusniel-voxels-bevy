import * as THREE from "three";
import { getAudioState } from "../audio/index.js";
import type { ClodPagesConfig } from "../config.js";
import type { ProjectArchiveContents } from "../project_archive.js";
import type { ClodRuntimeConfig } from "./runtime_config.js";
import type { WeatherMode } from "./clod_constants.js";
import {
  TEXTURE_BLEND_MODES,
  type ProceduralDebugMode,
  type TerrainMaterialSource,
} from "../terrain_runtime/terrain_material_constants.js";
import type { TextureBlendMode } from "../project_archive.js";
import {
  DEFAULT_TERRAIN_COLOR_ADJUSTMENTS,
} from "../material.js";
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
} from "../environment.js";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
} from "../postprocess.js";
import type { BrushOp, BrushShape } from "../terrain.js";
import type { ForestLightingDebugMode } from "../forest_lighting/index.js";
import { WATER_DEBUG_MODES } from "../water/index.js";
import type { GrassSettings } from "../grass/grass_config.js";
import type { StoneSettings } from "../stones/stone_config.js";
import type { TreeSettings } from "../trees/tree_config.js";
import type { UnderstorySettings } from "../understory/understory_config.js";
import type { ForestLightingSettings } from "../forest_lighting/forest_lighting_config.js";
import type { WaterConfig } from "../water/waterConfig.js";

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

export function createClodAppState(params: CreateClodAppStateParams) {
  const {
    cfg,
    searchParams,
    queryPerfMode,
    queryWebGpuSelection,
    queryMaterialTiers,
    queryFarShell,
    isLongView,
    queryTerrainMaterialSource,
    queryWeatherMode,
    queryWeatherIntensity,
    queryWeatherWindX,
    queryWeatherWindZ,
    weatherDefaults,
    grassConfig,
    stoneConfig,
    treeConfig,
    understoryConfig,
    forestLightingConfig,
    waterConfig,
    digHoldIntervalMs,
  } = params;

  const state = {
    clodPerfMode: queryPerfMode,
    webgpuSelection: queryWebGpuSelection,
    materialTiers: queryMaterialTiers,
    thresholdPx: cfg.selection.error_threshold_px,
    enforce21: true,
    freeze: false,
    wireframe: false,
    showBounds: false,
    showSeamPoints: false,
    showCrossLodBorders: false,
    showNodeLabels: false,
    showLockedBorderVertices: false,
    colorByLod: queryPerfMode,
    normalColor: false,
    normalDivergence: false,
    divergenceGain: 8,
    frontSideOnly: false,
    recomputedNormals: false,
    forceMaxLevel: "auto",
    terrainMaterialSource: (queryTerrainMaterialSource ?? "external_pbr") as TerrainMaterialSource,
    proceduralDebugMode: "final" as ProceduralDebugMode,
    proceduralMicroNormals: true,
    textureScale: 1,
    triplanar: !queryPerfMode && searchParams.get("terrainTriplanar") !== "0", // [DEBUG-tdr] isolate triplanar 3x sample cost
    albedo: !queryPerfMode,
    normalMap: false,
    normalIntensity: 1,
    roughness: 0.9,
    metalness: 0,
    textureBlendMode: TEXTURE_BLEND_MODES[1] as TextureBlendMode,
    textureBlendWidth: 6,
    loadedTextureFiles: "none",
    terrainBrightness: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.brightness,
    terrainContrast: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.contrast,
    terrainSaturation: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.saturation,
    terrainWarmth: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.warmth,
    sunAzimuthDeg: DEFAULT_ENVIRONMENT_SETTINGS.sunAzimuthDeg,
    sunElevationDeg: DEFAULT_ENVIRONMENT_SETTINGS.sunElevationDeg,
    sunIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunIntensity,
    skyIntensity: DEFAULT_ENVIRONMENT_SETTINGS.skyIntensity,
    groundIntensity: DEFAULT_ENVIRONMENT_SETTINGS.groundIntensity,
    exposure: DEFAULT_ENVIRONMENT_SETTINGS.exposure,
    horizonSoftness: DEFAULT_ENVIRONMENT_SETTINGS.horizonSoftness,
    sunDiskIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunDiskIntensity,
    sunGlowIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunGlowIntensity,
    hazeIntensity: DEFAULT_ENVIRONMENT_SETTINGS.hazeIntensity,
    postProcessEnabled: queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.enabled,
    postProcessOpacity: DEFAULT_POST_PROCESS_SETTINGS.opacity,
    postProcessExposure: DEFAULT_POST_PROCESS_SETTINGS.exposure,
    postProcessContrast: DEFAULT_POST_PROCESS_SETTINGS.contrast,
    postProcessSaturation: DEFAULT_POST_PROCESS_SETTINGS.saturation,
    postProcessVignette: DEFAULT_POST_PROCESS_SETTINGS.vignette,
    postProcessDebugMode: DEFAULT_POST_PROCESS_SETTINGS.debugMode,
    bubble: false,
    bubbleRadius: cfg.near_field.radius_chunks * cfg.page.chunk_size,
    tintBubble: true,
    digEnabled: true,
    digRadius: 3,
    brushOp: "remove" as BrushOp,
    brushShape: "sphere" as BrushShape,
    brushMaterial: 0,
    brushHeight: 3,
    brushStrength: 1,
    brushFalloff: 0,
    brushFlowMs: digHoldIntervalMs,
    audioEnabled: getAudioState().enabled,
    audioVolume: getAudioState().masterVolume,
    grassEnabled: grassConfig.enabled,
    grassRingDebug: searchParams.get("grassRingDebug") === "1",
    grassShaderMode: grassConfig.shaderMode,
    grassAlphaToCoverage: grassConfig.alphaToCoverage,
    grassNearCrossedQuads: grassConfig.nearCrossedQuads,
    grassDistance: grassConfig.distance,
    grassBladeSpacing: grassConfig.bladeSpacing,
    grassBladeHeight: grassConfig.bladeHeight,
    grassBladeHeightVariation: grassConfig.bladeHeightVariation,
    grassBladeWidth: grassConfig.bladeWidth,
    grassWindStrength: grassConfig.windStrength,
    grassWindSpeed: grassConfig.windSpeed,
    grassSlopeMinY: grassConfig.slopeMinY,
    grassMinHeight: grassConfig.minHeight,
    grassMaxHeight: grassConfig.maxHeight,
    grassMaxBlades: grassConfig.maxBlades,
    grassSeed: grassConfig.seed,
    grassBladeCount: 0,
    grassVisiblePatches: "0/0",
    grassTierSummary: "0/0/0/0",
    grassEdgeSuppressed: 0,
    grassCandidateCount: 0,
    grassPatchRebuildCount: 0,
    grassBuildMs: 0,
    stonesEnabled: stoneConfig.enabled,
    stoneDensity: stoneConfig.density,
    stoneMaxInstances: stoneConfig.maxInstances,
    stoneSeed: stoneConfig.seedSalt,
    stoneShowLarge: true,
    stoneShowMedium: true,
    stoneShowSmall: true,
    stoneTotal: 0,
    stoneClassSummary: "0/0/0",
    stoneVisible: 0,
    treesEnabled: treeConfig.enabled,
    treeDistance: treeConfig.distanceM,
    treeMaxInstances: treeConfig.maxInstances,
    treeDebugColorByLod: treeConfig.render.debugColorByLod,
    treeWindEnabled: treeConfig.wind.enabled,
    treeWindStrength: treeConfig.wind.strength,
    treeWindSpeed: treeConfig.wind.speed,
    treeGustStrength: treeConfig.wind.gustStrength,
    treeTrunkSwayStrength: treeConfig.wind.trunkSwayStrength,
    treeLeafFlutterStrength: treeConfig.wind.leafFlutterStrength,
    treeGpuEnabled: treeConfig.gpu.enabled,
    treeGpuForceCpu: treeConfig.gpu.debugForceCpu,
    treeGpuShowCounts: treeConfig.gpu.debugShowGpuCounts,
    treeTotal: 0 as number | string,
    treeVisiblePatches: "0/0",
    treeLodSummary: "0/0/0/0",
    treeGpuSummary: "disabled",
    understoryEnabled: understoryConfig.enabled,
    understoryDistance: understoryConfig.distanceM,
    understoryMaxInstances: understoryConfig.maxInstances,
    understoryDebugColorByClass: understoryConfig.render.debugColorByClass,
    understoryTotal: 0,
    understoryVisiblePatches: "0/0",
    understoryClassSummary: "0/0/0/0/0/0",
    understoryGpuSummary: "disabled",
    forestLightingEnabled: forestLightingConfig.enabled,
    forestLightingAoStrength: forestLightingConfig.ambientOcclusion.strength,
    forestLightingShadowStrength: forestLightingConfig.shadowProxy.strength,
    forestLightingFogStrength: forestLightingConfig.atmosphere.forestFogStrength,
    forestLightingSunShaftsStrength: forestLightingConfig.atmosphere.sunShaftsStrength,
    forestLightingDebugMode: forestLightingConfig.materialIntegration.debugMode as ForestLightingDebugMode,
    forestLightingStats: "pending",
    profileEnabled: searchParams.get("profile") === "1",
    farShellEnabled: queryFarShell || isLongView,
    farShellRadiusFactor: 1.5,
    farShellHeightBias: 0.6,
    farShellHeightDrop: 2,
    waterEnabled: waterConfig.enabled,
    waterDebugMode: (Object.entries(WATER_DEBUG_MODES).find(([, v]) => v === waterConfig.debug.mode)?.[0] ?? "final") as keyof typeof WATER_DEBUG_MODES,
    waterClipmapTint: waterConfig.debug.clipmapTint,
    waterWireframe: waterConfig.debug.wireframe,
    waterDepthWrite: waterConfig.visual.depthWrite,
    weatherMode: queryWeatherMode,
    weatherIntensity: Number.isFinite(queryWeatherIntensity)
      ? THREE.MathUtils.clamp(queryWeatherIntensity, 0, 1.6)
      : weatherDefaults.intensity,
    weatherWindX: Number.isFinite(queryWeatherWindX) ? queryWeatherWindX : weatherDefaults.windX,
    weatherWindZ: Number.isFinite(queryWeatherWindZ) ? queryWeatherWindZ : weatherDefaults.windZ,
    weatherStats: "off",
  };

  if (params.stagedImport) Object.assign(state, params.stagedImport.manifest.state);
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
    state.grassDistance = grassConfig.distance;
    state.grassMaxBlades = grassConfig.maxBlades;
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

  return state;
}

export type ClodAppState = ReturnType<typeof createClodAppState>;
