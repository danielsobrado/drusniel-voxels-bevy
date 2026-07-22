import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import type { ShadowProxyController, ShadowProxyDebugState } from "../../shadows/index.js";
import { GpuChunkMesher } from "../../gpu/gpu_chunk_mesher.js";
import { compareChunkSurfaces } from "../../gpu/gpu_mesh_parity.js";
import { resolveDigEdits } from "../../gpu/terrain_field_core.js";
import { getDigEditsSnapshot, meshChunk } from "../../terrain/terrain.js";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode } from "../../types.js";
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
import {
  PageGeometryCache,
  type PageGeometryNormalMode,
} from "../../terrain/geometry/page_geometry_cache.js";
import { ClodRenderNodeCache } from "../../terrain/rendering/clod_render_node_cache.js";
import type { ClodApplyQueue, ClodGeometryApplyResult } from "../../terrain/rendering/clod_apply_queue.js";
import type { ClodApplyStatsSnapshot } from "../../terrain/rendering/clod_apply_stats.js";
import { createNearFieldBubbleController } from "../../terrain/near_field/near_field_bubble_controller.js";
import type { ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import { type TerrainTextureLoadOptions } from "../../terrain/material/texture_loader.js";
import { createTerrainTextureController } from "../../terrain/material/terrain_texture_controller.js";
import { createTerrainMaterialController } from "../../terrain/material/terrain_material_controller.js";
import type { createFarShellController } from "../../systems/far_shell_controller.js";
import type { CanopyShellConfig } from "../../canopy/canopy_config.js";
import type { CanopyShellSystem } from "../../canopy/canopy_system.js";
import type { CanopyDebugState } from "../../canopy/canopy_debug.js";
import type { VegetationLodConfig } from "../../vegetation/vegetation_lod_config.js";
import type { TreeSettings } from "../../trees/tree_config.js";
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
import { type NodeView } from "./bootstrap_types.js";
import type { createProceduralTerrainTextures } from "../../textures/terrainTextureArrays.js";
import type { parseProceduralTextureConfig } from "../../textures/materialRecipes.js";
import {
  createCurrentLightingReader,
  createTerrainViewSkyEnvironment,
  createTerrainViewStateReaders,
} from "./terrain_view_state.js";
import { isStreamingLongViewScene } from "./bootstrap_long_view.js";
import {
  createTerrainViewShadowProxyController,
  resolveTerrainViewShadowProxyStartup,
} from "./terrain_view_shadow_proxy_startup.js";
import {
  createTerrainViewCanopyShell,
  resolveTerrainViewCanopyStartup,
} from "./terrain_view_canopy_startup.js";
import { runTerrainViewFarShellStartup } from "./terrain_view_far_shell_startup.js";
import { runTerrainViewSelectionGeometryStartup } from "./terrain_view_selection_geometry_startup.js";

export function gpuMesherEnabledForScene(queryScene: string | null, params: URLSearchParams): boolean {
  return params.get("gpuMesh") === "1"
    || (isStreamingLongViewScene(queryScene) && params.get("gpuMesh") !== "0");
}

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
  worldMode: import("../world_mode.js").WorldModeConfig;
  terrainSummary: TerrainSummaryField;
  /** Resolved procedural terrain config (worldSource.metadata.terrain); powers worker-side canopy builds. */
  terrainFieldConfig?: import("../../terrain/terrain.js").TerrainFieldConfig | null;
  treeConfig: TreeSettings;
  canopyConfig: CanopyShellConfig;
  vegetationLodConfig: VegetationLodConfig;
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

  const shadowProxy = resolveTerrainViewShadowProxyStartup({
    isLongView,
    searchParams,
    queryScene,
  });
  const canopy = resolveTerrainViewCanopyStartup({
    canopyConfig: input.canopyConfig,
    queryScene,
    queryCanopy: input.queryCanopy,
  });

  const { farShellController } = runTerrainViewFarShellStartup({
    scene,
    terrainSummary,
    worldSizeCells,
    isLongView,
    queryFarShell,
    queryCanopy,
    state,
    searchParams,
    worldMode: input.worldMode,
    getLighting: currentLighting,
    shadowProxyDebugState: shadowProxy.shadowProxyDebugState,
    getCanopyConfig: canopy.getCanopyConfig,
    useDeterministicCanopy: canopy.useDeterministicCanopy,
    longViewHooks,
  });

  const { canopyShellSystem, canopyDebugState } = createTerrainViewCanopyShell({
    searchParams,
    queryScene,
    queryCanopy: input.queryCanopy,
    useDeterministicCanopy: canopy.useDeterministicCanopy,
    scene,
    terrainSummary,
    worldSizeCells,
    terrainFieldConfig: input.terrainFieldConfig ?? null,
    getLighting: currentLighting,
    getCanopyConfig: canopy.getCanopyConfig,
    vegetationLodConfig: input.vegetationLodConfig,
    getCanopyDebugState: canopy.getCanopyDebugState,
    setCanopyDebugState: canopy.setCanopyDebugState,
    longViewHooks,
  });

  const { shadowProxyController } = createTerrainViewShadowProxyController({
    isLongView,
    streamingCentered: streamingLongView,
    scene,
    renderer: input.renderer,
    terrainSummary,
    worldSizeCells,
    camera,
    longViewHooks,
    longViewSunConfig: shadowProxy.longViewSunConfig,
    shadowProxyDebugState: shadowProxy.shadowProxyDebugState,
    getShadowProxyConfig: shadowProxy.getShadowProxyConfig,
    getLighting: currentLighting,
  });

  const boundaryGroup = new THREE.Group();
  scene.add(boundaryGroup);
  const brushPreview = createBrushPreviewController(scene);
  const seamGroup = new THREE.Group();
  scene.add(seamGroup);
  const crossLodBorderGroup = new THREE.Group();
  scene.add(crossLodBorderGroup);
  const lockedBorderOverlay = new LockedBorderOverlay(scene);
  const nodeLabelRoot = document.createElement("div");
  document.body.appendChild(nodeLabelRoot);
  const nodeLabelOverlay = new NodeLabelOverlay(nodeLabelRoot);
  nodeLabelOverlay.setVisible(state.showNodeLabels);

  const worldBounds = { cellsX: worldCells, cellsZ: worldCells };
  // Streaming scenes build live-bubble pages continuously; CPU chunk meshing cannot
  // keep up, so the async GPU mesher defaults on (gpuMesh=0 disables).
  const gpuMeshEnabled = gpuMesherEnabledForScene(queryScene, searchParams);
  const gpuMeshVerify = searchParams.get("gpuMeshVerify") === "1";
  let gpuMesher: GpuChunkMesher | null = null;
  if (gpuMeshEnabled) {
    void GpuChunkMesher.create(cfg.page.chunk_size, { sharedDevice: rendererWebGpuDevice ?? undefined }).then(async (res) => {
      if (!res.mesher) {
        console.warn("[gpuMesh] WebGPU unavailable; using CPU meshChunk", res.unavailable);
        return;
      }
      gpuMesher = res.mesher;
      console.info("[gpuMesh] GPU chunk mesher ready");
      if (gpuMeshVerify) {
        const edits = resolveDigEdits(getDigEditsSnapshot());
        for (const [cx, cz] of [[0, 0], [2, 2], [4, 4]] as const) {
          try {
            const g = await res.mesher.meshChunk(cx, cz, worldBounds, edits);
            const c = meshChunk(cx, cz, cfg, worldBounds);
            const cmp = compareChunkSurfaces(c, g, 0.05);
            console.info(
              `[gpuMesh] parity chunk(${cx},${cz}) tris G/C ${cmp.gpuTriangles}/${cmp.cpuTriangles}` +
                ` verts ${cmp.gpuVertices}/${cmp.cpuVertices} (halo ${cmp.haloVertices})` +
                ` maxDelta ${cmp.maxVertexDelta.toFixed(4)}` +
                ` unmatched ${cmp.unmatched} ${cmp.withinTol ? "OK" : "DRIFT"}`,
            );
          } catch (e) {
            console.error(`[gpuMesh] parity chunk(${cx},${cz}) failed`, e);
          }
        }
      }
    });
  }
  const nearFieldBubbleController = createNearFieldBubbleController({
    scene,
    materialController,
    cfg,
    worldBounds,
    getTintBubble: () => state.tintBubble,
    getGpuMesher: () => gpuMesher,
    chunkGroupBuildBudget: clodRuntime.nearField.chunkGroupBuildBudget,
    maxCachedChunkGroups: clodRuntime.nearField.maxCachedChunkGroups,
    evictDistanceMultiplier: clodRuntime.nearField.evictDistanceMultiplier,
    terrainColliders,
  });

  const pageTransitionMode = cfg.selection.transition_mode;
  const crossfadeStep = cfg.selection.crossfade_frames > 0
    ? 1 / cfg.selection.crossfade_frames
    : 1;
  const applyColorAdjustmentsToTerrain = () => {
    materialController.applyColorAdjustments();
  };

  const selectionGeometry = runTerrainViewSelectionGeometryStartup({
    clodRuntime,
    cfg,
    allNodes,
    roots: result.roots,
    views,
    renderNodeCache,
    pageGeometryCache,
    state,
    camera,
    renderer: input.renderer,
    interaction,
    player,
    terrainColliders,
    getClodErrorCompute,
    getWebGpuUnavailableReason,
    queryReadbackMode,
    queryWebGpuParity,
    poolTerrainMaterial,
    staleEditedAncestorIds,
    boundaryGroup,
    seamGroup,
    crossLodBorderGroup,
    lockedBorderOverlay,
  });

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
    canopyShellSystem,
    canopyDebugState,
    getCanopyConfig: canopy.getCanopyConfig,
    setCanopyConfig: canopy.setCanopyConfig,
    shadowProxyController,
    shadowProxyDebugState: shadowProxy.shadowProxyDebugState,
    getShadowProxyConfig: shadowProxy.getShadowProxyConfig,
    setShadowProxyConfig: shadowProxy.setShadowProxyConfig,
    boundaryGroup,
    seamGroup,
    crossLodBorderGroup,
    lockedBorderOverlay,
    nodeLabelOverlay,
    brushPreview,
    nearFieldBubbleController,
    pageGeometryCache,
    renderNodeCache,
    pageTransitionMode,
    crossfadeStep,
    selectionController: selectionGeometry.selectionController,
    updateSelection: selectionGeometry.updateSelection,
    cutChangedRef: selectionGeometry.cutChangedRef,
    applyNodeMesh: selectionGeometry.applyNodeMesh,
    applyNodeGeometry: selectionGeometry.applyNodeGeometry,
    applyNodeCollider: selectionGeometry.applyNodeCollider,
    clodApplyQueue: selectionGeometry.clodApplyQueue,
    drainClodApplyQueue: selectionGeometry.drainClodApplyQueue,
    getClodApplyStats: selectionGeometry.getClodApplyStats,
    setViewNormalMode: selectionGeometry.setViewNormalMode,
  };
}
