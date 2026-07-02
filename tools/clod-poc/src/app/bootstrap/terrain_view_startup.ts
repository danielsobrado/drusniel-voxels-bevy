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
import { triangleCount, type ClodPageNode } from "../../types.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { TerrainColorAdjustments } from "../../material/material.js";
import type { EnvironmentLighting, EnvironmentSettings } from "../../environment/environment.js";
import {
  PostProcessPipeline,
  type PostProcessSettings,
} from "../../environment/postprocess.js";
import { WebGpuPostProcessPipeline } from "../../gpu/webgpu_postprocess.js";
import type { AppPostProcess } from "../app_post_process.js";
import type { AppSky } from "../../scene/app_sky.js";
import { FAR_SHELL_DEFAULTS, LOD_COLORS } from "../clod_constants.js";
import { toGeometry } from "../../terrain/geometry/page_geometry.js";
import {
  PageGeometryCache,
  type PageGeometryNormalMode,
} from "../../terrain/geometry/page_geometry_cache.js";
import { ClodRenderNodeCache } from "../../terrain/rendering/clod_render_node_cache.js";
import {
  ClodApplyQueue,
  type ClodGeometryApplyResult,
} from "../../terrain/rendering/clod_apply_queue.js";
import type { ClodApplyStatsSnapshot } from "../../terrain/rendering/clod_apply_stats.js";
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
import {
  createCurrentLightingReader,
  createTerrainViewSkyEnvironment,
  createTerrainViewStateReaders,
} from "./terrain_view_state.js";

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
  hydrologyFieldsTexture: THREE.Texture | null;
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
  pageGeometryCache: PageGeometryCache;
  renderNodeCache: ClodRenderNodeCache;
  pageTransitionMode: string;
  crossfadeStep: number;
  selectionController: ClodSelectionController;
  updateSelection: () => void;
  cutChangedRef: { fn: () => void };
  applyNodeMesh: (node: ClodPageNode) => { geometrySwapMs: number; colliderMs: number };
  applyNodeGeometry: (node: ClodPageNode) => ClodGeometryApplyResult;
  applyNodeCollider: (node: ClodPageNode) => number;
  clodApplyQueue: ClodApplyQueue;
  drainClodApplyQueue: () => ClodApplyStatsSnapshot;
  getClodApplyStats: () => ClodApplyStatsSnapshot;
  setViewNormalMode: (view: NodeView, normalMode: PageGeometryNormalMode) => void;
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
    hydrologyFieldsTexture,
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

  const {
    currentTerrainColorAdjustments,
    currentEnvironmentSettings,
    currentPostProcessSettings,
  } = createTerrainViewStateReaders(state);
  const skyEnvironment: AppSky = createTerrainViewSkyEnvironment({
    app,
    scene,
    worldCells,
    settings: currentEnvironmentSettings(),
  });
  skyEnvironment.setVisible(!state.clodPerfMode);
  const currentLighting = createCurrentLightingReader(skyEnvironment);

  let views = new Map<string, NodeView>();
  const pageGeometryCache = new PageGeometryCache(clodRuntime.pageGeometryCache);
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
    getMaterialState: () => state,
    getColorAdjustments: currentTerrainColorAdjustments,
    getLighting: currentLighting,
    getViews: () => views.values(),
    onTexturesApplied: () => bindings.refreshTerraformSwatches(),
    onColorByLodChanged: () => {},
    getColorByLodUserOverride: () => colorByLodUserOverride.value,
    setColorByLodUserOverride: (value) => { colorByLodUserOverride.value = value; },
    getColorByLodController: () => colorByLodController.current,
  });
  const applyTerrainTextures = () => materialController.applyTerrainTextures();
  const applyColorByLodToMaterials = (on: boolean) => materialController.applyColorByLodToMaterials(on);

  const materialColorForNode = (node: ClodPageNode): number =>
    state.colorByLod ? LOD_COLORS[Math.min(node.level, LOD_COLORS.length - 1)] : 0xb9c0c8;
  const renderNodeCache = new ClodRenderNodeCache({
    scene,
    materialController,
    pageGeometryCache,
    getMaterialColorForNode: materialColorForNode,
    getColorAdjustments: currentTerrainColorAdjustments,
    getLighting: currentLighting,
    getMaterialState: () => state,
    getNormalMode: () => state.recomputedNormals ? "recomputed" : "source",
    config: clodRuntime.renderNodeCache,
  });
  views = renderNodeCache.views();

  const postProcess: AppPostProcess = app.isWebGpu
    ? new WebGpuPostProcessPipeline(app.renderer, scene, camera, currentPostProcessSettings(), currentLighting, {
        froxelTerrainSummary: terrainSummary,
        froxelTerrainRadiusMeters: worldSizeCells * FAR_SHELL_DEFAULTS.radiusFactor,
        froxelHydrologyTexture: hydrologyFieldsTexture,
        froxelHydrologyWorldSizeMeters: worldSizeCells,
      })
    : new PostProcessPipeline(app.renderer, currentPostProcessSettings());
  postProcess.setSize(window.innerWidth, window.innerHeight);

  const queryScene = searchParams.get("scene");
  const streamingLongView = isStreamingLongViewScene(queryScene);
  const longViewSunConfig = parseLongViewSunShadowsConfig(longViewYaml);
  const shadowProxyConfig = applyShadowProxySceneOverrides(
    applyShadowProxyDebugQueryOverrides(longViewSunConfig.shadowProxy, searchParams),
    queryScene,
  );
  const shadowProxyDebugState = isLongView
    ? createShadowProxyDebugState(shadowProxyConfig, longViewSunConfig.enabled)
    : null;
  if (shadowProxyDebugState && searchParams.get("shadowProxyDebugLambert") === "1") {
    shadowProxyDebugState.debugLambertFarShellReceiver = true;
  }
  let liveShadowProxyConfig = { ...shadowProxyConfig };

  let liveCanopyConfig = applyCanopyShellQueryOverrides(parseCanopyShellConfig(canopyShellYaml), searchParams);
  const useDeterministicCanopy = shouldUseDeterministicCanopy(queryScene, liveCanopyConfig, input.queryCanopy);

  const canopyDebugState = input.queryCanopy ? createCanopyDebugState() : null;
  if (canopyDebugState) applyConfigToCanopyDebugState(canopyDebugState, liveCanopyConfig);

  const lockedBorderOverlay = new LockedBorderOverlay(scene);
  const nodeLabelOverlay = new NodeLabelOverlay(scene);
  const boundaryGroup = new THREE.Group();
  const seamGroup = new THREE.Group();
  const crossLodBorderGroup = new THREE.Group();
  scene.add(boundaryGroup, seamGroup, crossLodBorderGroup);

  const longViewMaterials = loadLongViewMaterialsConfig(materialsYaml);
  const materialQueryOverrides = parseQueryOverrides(searchParams);
  const farUniformData = configToUniformData(longViewMaterials, materialQueryOverrides);
  const farShellController = createFarShellController({
    scene,
    camera,
    terrainSummary,
    worldCells,
    isLongView,
    queryFarShell,
    farUniformData,
    rendererWebGpuDevice,
    getLightDirection: () => skyEnvironment.getLightDirection(),
    getLighting: currentLighting,
    getFogSettings: () => currentEnvironmentSettings().fog,
    getPlayerPosition: () => player.position,
    getHydrologyTexture: () => hydrologyFieldsTexture,
    hydrologyWorldSizeMeters: worldSizeCells,
