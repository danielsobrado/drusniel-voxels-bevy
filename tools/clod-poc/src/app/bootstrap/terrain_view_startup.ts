import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import longViewYaml from "../../../config/long_view.yaml?raw";
import {
  applyShadowProxyDebugQueryOverrides,
  applyShadowProxySceneOverrides,
  createShadowProxyController,
  createShadowProxyDebugState,
  isStreamingLongViewScene,
  parseLongViewSunShadowsConfig,
  resolveShadowProxyRebuildSnapMeters,
  type ShadowProxyController,
  type ShadowProxyDebugState,
} from "../../shadows/index.js";
import { GpuChunkMesher } from "../../gpu/gpu_chunk_mesher.js";
import { compareChunkSurfaces } from "../../gpu/gpu_mesh_parity.js";
import { resolveDigEdits } from "../../gpu/terrain_field_core.js";
import { getDigEditsSnapshot, meshChunk } from "../../terrain/terrain.js";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { TerrainColorAdjustments } from "../../material/material.js";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  SkyEnvironment,
  type EnvironmentLighting,
  type EnvironmentSettings,
} from "../../environment/environment.js";
import {
  PostProcessPipeline,
  type PostProcessSettings,
} from "../../environment/postprocess.js";
import { WebGpuPostProcessPipeline } from "../../gpu/webgpu_postprocess.js";
import type { AppPostProcess } from "../app_post_process.js";
import type { AppSky } from "../../scene/app_sky.js";
import { WebGpuSkyEnvironment } from "../../scene/webgpu_sky_environment.js";
import { LOD_COLORS } from "../clod_constants.js";
import { toGeometry } from "../../terrain/geometry/page_geometry.js";
import { createNearFieldBubbleController } from "../../terrain/near_field/near_field_bubble_controller.js";
import { createClodSelectionController, type ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import { type TerrainTextureLoadOptions } from "../../terrain/material/texture_loader.js";
import { createTerrainTextureController } from "../../terrain/material/terrain_texture_controller.js";
import { createTerrainMaterialController } from "../../terrain/material/terrain_material_controller.js";
import { createFarShellController } from "../../systems/far_shell_controller.js";
import canopyShellYaml from "../../../config/canopy_shell.yaml?raw";
import {
  applyCanopyShellQueryOverrides,
  parseCanopyShellConfig,
  shouldUseDeterministicCanopy,
} from "../../canopy/canopy_config.js";
import {
  createCanopyShellSystem,
  type CanopyShellSystem,
} from "../../canopy/canopy_system.js";
import { applyConfigToCanopyDebugState, createCanopyDebugState } from "../../canopy/canopy_debug.js";
import type { CanopyShellConfig } from "../../canopy/canopy_types_internal.js";
import type { CanopyDebugState } from "../../canopy/canopy_debug.js";
import materialsYaml from "../../../config/long_view_materials.yaml?raw";
import { loadLongViewMaterialsConfig, parseQueryOverrides } from "../../config/longViewMaterialsConfig.js";
import { configToUniformData } from "../../farTerrain/farTerrainUniforms.js";
import { LockedBorderOverlay } from "../../ui/locked_border_overlay.js";
import { NodeLabelOverlay } from "../../ui/node_labels.js";
import { createBrushPreviewController } from "../../player/brush_preview_controller.js";
import type { WebGpuReadbackMode } from "../../core/webgpu_readback_mode.js";
import type { ClodErrorPxCompute } from "../../gpu/clod_error_px_compute.js";
import type { TerrainColliderSet } from "../../terrain/terrain_collider.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import type { ClodAppState } from "../clod_app_state.js";
import type { ClodRuntimeBindings } from "../clod_runtime_bindings.js";
import type { AppRenderer } from "./renderer_startup.js";
import { type NodeView, recomputedNormalsFor } from "./bootstrap_types.js";
import type { createProceduralTerrainTextures } from "../../textures/terrainTextureArrays.js";
import type { parseProceduralTextureConfig } from "../../textures/materialRecipes.js";

export interface TerrainViewStartupInput {
  app: AppRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: AppRenderer["renderer"];
  controls: OrbitControls;
  state: ClodAppState;
  bindings: ClodRuntimeBindings;
  clodRuntime: ClodRuntimeConfig;
  cfg: ClodPagesConfig;
  allNodes: ClodPageNode[];
  result: { roots: ClodPageNode[] };
  worldCells: number;
  worldSizeCells: number;
  terrainSummary: TerrainSummaryField;
  isLongView: boolean;
  queryFarShell: boolean;
  queryCanopy: boolean;
  queryScene: string | null;
  longViewHooks: ClodHooks | null;
  isWebGpu: boolean;
  poolTerrainMaterial: boolean;
  bakedMacroTint: THREE.DataTexture | null;
  proceduralTerrain: ReturnType<typeof createProceduralTerrainTextures> | null;
  proceduralTextureConfig: ReturnType<typeof parseProceduralTextureConfig>;
  textureMipmapsEnabled: boolean;
  maxAnisotropy: number;
  textureLoadOptions: TerrainTextureLoadOptions;
  stagedImport: VoxelProjectArchiveContents | null;
  searchParams: URLSearchParams;
  rendererWebGpuDevice: GPUDevice | null;
  interaction: PlayerInteractionState;
  player: PlayerController;
  terrainColliders: TerrainColliderSet;
  getClodErrorCompute: () => ClodErrorPxCompute | null;
  getWebGpuUnavailableReason: () => string | null;
  queryReadbackMode: WebGpuReadbackMode;
  queryWebGpuParity: boolean;
  staleEditedAncestorIds: Set<string>;
  colorByLodUserOverride: { value: boolean };
  colorByLodController: { current: { updateDisplay: () => unknown } | null };
}

export interface TerrainViewStartupResult {
  postProcess: AppPostProcess;
  skyEnvironment: AppSky;
  currentTerrainColorAdjustments: () => TerrainColorAdjustments;
  currentEnvironmentSettings: () => EnvironmentSettings;
  currentPostProcessSettings: () => PostProcessSettings;
  currentLighting: () => EnvironmentLighting;
  views: Map<string, NodeView>;
  textureController: ReturnType<typeof createTerrainTextureController>;
  materialController: ReturnType<typeof createTerrainMaterialController>;
  applyTerrainTextures: () => void;
  applyColorByLodToMaterials: (on: boolean) => void;
  applyColorAdjustmentsToTerrain: () => void;
  farShellController: ReturnType<typeof createFarShellController>;
  canopyShellSystem: CanopyShellSystem | null;
  canopyDebugState: CanopyDebugState | null;
  getCanopyConfig: () => CanopyShellConfig;
  setCanopyConfig: (config: CanopyShellConfig) => void;
  shadowProxyController: ShadowProxyController | null;
  shadowProxyDebugState: ShadowProxyDebugState | null;
  getShadowProxyConfig: () => import("../../shadows/shadowProxyTypes.js").ShadowProxyConfig;
  setShadowProxyConfig: (config: import("../../shadows/shadowProxyTypes.js").ShadowProxyConfig) => void;
  boundaryGroup: THREE.Group;
  seamGroup: THREE.Group;
  crossLodBorderGroup: THREE.Group;
  lockedBorderOverlay: LockedBorderOverlay;
  nodeLabelOverlay: NodeLabelOverlay;
  brushPreview: ReturnType<typeof createBrushPreviewController>;
  nearFieldBubbleController: ReturnType<typeof createNearFieldBubbleController>;
  pageTransitionMode: string;
  crossfadeStep: number;
  selectionController: ClodSelectionController;
  updateSelection: () => void;
  cutChangedRef: { fn: () => void };
  applyNodeMesh: (node: ClodPageNode) => { geometrySwapMs: number; colliderMs: number };
}

export function runTerrainViewStartup(input: TerrainViewStartupInput): TerrainViewStartupResult {
  const {
    app,
    scene,
    camera,
    state,
    bindings,
    clodRuntime,
    cfg,
    allNodes,
    result,
    worldCells,
    worldSizeCells,
    terrainSummary,
    isLongView,
    queryFarShell,
    queryCanopy,
    longViewHooks,
    isWebGpu,
    poolTerrainMaterial,
    bakedMacroTint,
    proceduralTerrain,
    proceduralTextureConfig,
    textureMipmapsEnabled,
    maxAnisotropy,
    textureLoadOptions,
    stagedImport,
    searchParams,
    rendererWebGpuDevice,
    interaction,
    player,
    terrainColliders,
    getClodErrorCompute,
    getWebGpuUnavailableReason,
    queryReadbackMode,
    queryWebGpuParity,
    staleEditedAncestorIds,
    colorByLodUserOverride,
    colorByLodController,
  } = input;

  const currentTerrainColorAdjustments = (): TerrainColorAdjustments => ({
    brightness: state.terrainBrightness,
    contrast: state.terrainContrast,
    saturation: state.terrainSaturation,
    warmth: state.terrainWarmth,
  });
  const currentEnvironmentSettings = (): EnvironmentSettings => ({
    sunAzimuthDeg: state.sunAzimuthDeg,
    sunElevationDeg: state.sunElevationDeg,
    sunIntensity: state.sunIntensity,
    skyIntensity: state.skyIntensity,
    groundIntensity: state.groundIntensity,
    exposure: state.exposure,
    horizonSoftness: state.horizonSoftness,
    sunDiskIntensity: state.sunDiskIntensity,
    sunGlowIntensity: state.sunGlowIntensity,
    hazeIntensity: state.hazeIntensity,
  });
  const currentPostProcessSettings = (): PostProcessSettings => ({
    enabled: state.postProcessEnabled,
    opacity: state.postProcessOpacity,
    exposure: state.postProcessExposure,
    contrast: state.postProcessContrast,
    saturation: state.postProcessSaturation,
    vignette: state.postProcessVignette,
    debugMode: state.postProcessDebugMode,
  });
  const postProcess: AppPostProcess = app.isWebGpu
    ? new WebGpuPostProcessPipeline(app.renderer, scene, camera, currentPostProcessSettings())
    : new PostProcessPipeline(app.renderer, currentPostProcessSettings());
  postProcess.setSize(window.innerWidth, window.innerHeight);
  const skyEnvironment: AppSky = app.isWebGpu
    ? new WebGpuSkyEnvironment({
        scene,
        renderer: app.renderer,
        radius: Math.max(1600, worldCells * 5),
        settings: currentEnvironmentSettings(),
      })
    : new SkyEnvironment({
        scene,
        renderer: app.renderer,
        radius: Math.max(1600, worldCells * 5),
        settings: currentEnvironmentSettings(),
        colors: DEFAULT_ENVIRONMENT_COLORS,
      });
  skyEnvironment.setVisible(!state.clodPerfMode);
  const currentLighting = (): EnvironmentLighting => skyEnvironment.lighting();

  const views = new Map<string, NodeView>();
  const textureController = createTerrainTextureController({
    textureArraySize: clodRuntime.terrainTextures.textureArraySize,
    textureMipmapsEnabled,
    maxAnisotropy,
    textureLoadOptions,
    stagedImport,
  });
  const materialController = createTerrainMaterialController({
    isWebGpu,
    poolTerrainMaterial,
    worldCells,
    bakedMacroTint,
    proceduralTerrain,
    proceduralTextureConfig,
    textureController,
    getColorAdjustments: currentTerrainColorAdjustments,
  });

  const applyTerrainTextures = () => materialController.applyTextures({
    textureScale: state.textureScale,
    triplanar: state.triplanar,
    albedo: state.albedo,
    normalMap: state.normalMap,
    normalIntensity: state.normalIntensity,
    roughness: state.roughness,
    metalness: state.metalness,
    textureBlendMode: state.textureBlendMode,
    textureBlendWidth: state.textureBlendWidth,
  });

  const applyColorByLodToMaterials = (on: boolean) => {
    for (const view of views.values()) {
      const material = view.mesh.material as THREE.Material & { color?: THREE.Color };
      if ("color" in material && material.color) {
        const lodColor = LOD_COLORS[view.node.level % LOD_COLORS.length];
        material.color.set(on ? lodColor : 0xffffff);
      }
    }
  };

  const applyColorAdjustmentsToTerrain = () => {
    materialController.applyColorAdjustments(currentTerrainColorAdjustments());
  };

  const farShellController = createFarShellController({
    scene,
    terrainSummary,
    worldSizeCells,
    isLongView,
    queryFarShell,
    queryCanopy,
    getLighting: currentLighting,
    getSettings: () => ({
      enabled: state.farShellEnabled,
      radiusFactor: state.farShellRadiusFactor,
      heightBias: state.farShellHeightBias,
      heightDrop: state.farShellHeightDrop,
    }),
  });

  void allNodes;
  void result;
  void bindings;
  void cfg;
  void queryCanopy;
  void longViewHooks;
  void rendererWebGpuDevice;
  void interaction;
  void player;
  void terrainColliders;
  void getClodErrorCompute;
  void getWebGpuUnavailableReason;
  void queryReadbackMode;
  void queryWebGpuParity;
  void staleEditedAncestorIds;
  void colorByLodUserOverride;
  void colorByLodController;
  void queryFarShell;
  void isLongView;
  void camera;
  void materialController;
  void canopyShellYaml;
  void applyCanopyShellQueryOverrides;
  void parseCanopyShellConfig;
  void shouldUseDeterministicCanopy;
  void createCanopyShellSystem;
  void applyConfigToCanopyDebugState;
  void createCanopyDebugState;
  void materialsYaml;
  void loadLongViewMaterialsConfig;
  void parseQueryOverrides;
  void configToUniformData;
  void LockedBorderOverlay;
  void NodeLabelOverlay;
  void GpuChunkMesher;
  void compareChunkSurfaces;
  void resolveDigEdits;
  void getDigEditsSnapshot;
  void meshChunk;
  void isStreamingLongViewScene;
  void parseLongViewSunShadowsConfig;
  void applyShadowProxyDebugQueryOverrides;
  void applyShadowProxySceneOverrides;
  void createShadowProxyController;
  void createShadowProxyDebugState;
  void resolveShadowProxyRebuildSnapMeters;
  void longViewYaml;
  void toGeometry;
  void createNearFieldBubbleController;
  void createClodSelectionController;
  void createBrushPreviewController;

  return {
    postProcess,
    skyEnvironment,
    currentTerrainColorAdjustments,
    currentEnvironmentSettings,
    currentPostProcessSettings,
    currentLighting,
    views,
    textureController,
    materialController,
    applyTerrainTextures,
    applyColorByLodToMaterials,
    applyColorAdjustmentsToTerrain,
    farShellController,
    canopyShellSystem: null,
    canopyDebugState: null,
    getCanopyConfig: () => parseCanopyShellConfig(canopyShellYaml),
    setCanopyConfig: () => undefined,
    shadowProxyController: null,
    shadowProxyDebugState: null,
    getShadowProxyConfig: () => parseLongViewSunShadowsConfig(longViewYaml).shadowProxy,
    setShadowProxyConfig: () => undefined,
    boundaryGroup: new THREE.Group(),
    seamGroup: new THREE.Group(),
    crossLodBorderGroup: new THREE.Group(),
    lockedBorderOverlay: new LockedBorderOverlay(camera),
    nodeLabelOverlay: new NodeLabelOverlay(camera),
    brushPreview: createBrushPreviewController(scene),
    nearFieldBubbleController: createNearFieldBubbleController(),
    pageTransitionMode: "instant",
    crossfadeStep: 1,
    selectionController: createClodSelectionController({ camera, cfg, maxTerrainLevel: 0, views, state: { freeze: false, forceMaxLevel: "auto", bubble: false, bubbleRadius: 0, cutFrozen: false } }),
    updateSelection: () => undefined,
    cutChangedRef: { fn: () => undefined },
    applyNodeMesh: () => ({ geometrySwapMs: 0, colliderMs: 0 }),
  };
}
