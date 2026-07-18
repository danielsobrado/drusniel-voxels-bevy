import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import longViewYaml from "../../../config/long_view.yaml?raw";
import {
  applyShadowProxyDebugQueryOverrides,
  applyShadowProxySceneOverrides,
  createShadowProxyController,
  createShadowProxyDebugState,
  parseLongViewSunShadowsConfig,
  resolveShadowProxyRebuildSnapMeters,
  type ShadowProxyController,
  type ShadowProxyDebugState,
} from "../../shadows/index.js";
import { GpuChunkMesher } from "../../gpu/gpu_chunk_mesher.js";
import { compareChunkSurfaces } from "../../gpu/gpu_mesh_parity.js";
import { resolveDigEdits } from "../../gpu/terrain_field_core.js";
import { getDigEditRevision, getDigEditsSnapshot, meshChunk } from "../../terrain/terrain.js";
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
  shouldSkipLegacyCanopy,
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
import { isStreamingLongViewScene } from "./bootstrap_long_view.js";

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
  let canopyDebugState: CanopyDebugState | null = useDeterministicCanopy
    ? createCanopyDebugState(liveCanopyConfig)
    : null;

  const materialConfig = loadLongViewMaterialsConfig(materialsYaml, parseQueryOverrides(searchParams));
  const parityUniformData = materialConfig.enabled ? configToUniformData(materialConfig) : undefined;

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
    receiveSunShadows: () => Boolean(isLongView && shadowProxyDebugState?.sunShadowsEnabled),
    useDebugLambertReceiver: () => Boolean(shadowProxyDebugState?.debugLambertFarShellReceiver),
    useParityMaterial: () => materialConfig.enabled,
    getParityConfig: () => parityUniformData,
    skipLegacyCanopy: shouldSkipLegacyCanopy(liveCanopyConfig, useDeterministicCanopy),
    onTriangleCount: (counter, count) => {
      if (longViewHooks?.stats) longViewHooks.stats.counters[counter] = count;
    },
  });

  // The legacy far shell is built from the finite startup terrainSummary and is centered on the
  // startup world (worldSizeCells/2), so for an infinite-island world it paints a small finite ring
  // near the origin that disagrees with, and z-fights, the player-centered far terrain. It renders
  // only when it is the resolved far owner (finite worlds); for every other owner it stays off so
  // there is never a legacy finite shell competing with an infinite far renderer. `debugLegacyFarShell=1`
  // forces it on for diagnosis.
  const debugForceLegacyFarShell = searchParams.get("debugLegacyFarShell") === "1";
  const disableLegacyFarShell = !debugForceLegacyFarShell
    && input.worldMode.farOwner !== "legacy_far_shell";

  if (disableLegacyFarShell) {
    farShellController.setEnabled(false);
  } else if (state.farShellEnabled) {
    farShellController.rebuild();
  } else {
    farShellController.setEnabled(false);
  }

  const canopyShellSystem = useDeterministicCanopy
    ? createCanopyShellSystem(canopyShellYaml, searchParams, queryScene, input.queryCanopy, {
      scene,
      terrainSummary,
      worldSizeCells,
      terrainFieldConfig: input.terrainFieldConfig ?? null,
      getLighting: currentLighting,
      getConfig: () => liveCanopyConfig,
      getDebugState: () => canopyDebugState!,
      onCounters: (counters) => {
        if (!longViewHooks?.stats) return;
        for (const [key, value] of Object.entries(counters)) {
          longViewHooks.stats.counters[key] = value;
        }
      },
    })
    : null;
  if (canopyShellSystem) {
    canopyDebugState = canopyShellSystem.debugState;
  }

  const shadowProxyController = isLongView
    ? createShadowProxyController(
      { enabled: longViewSunConfig.enabled, shadowProxy: liveShadowProxyConfig },
      {
        scene,
        renderer: input.renderer,
        getTerrainSummary: () => window.__drusnielTerrainSummary ?? terrainSummary,
        worldSize: worldSizeCells,
        isLongView,
        streamingCentered: streamingLongView,
        rebuildSnapMeters: resolveShadowProxyRebuildSnapMeters(liveShadowProxyConfig),
        getSunShadowsEnabled: () => shadowProxyDebugState?.sunShadowsEnabled ?? false,
        getConfig: () => liveShadowProxyConfig,
        getLighting: currentLighting,
        getCoverageCenter: () => ({ x: camera.position.x, z: camera.position.z }),
        onCounters: (counters) => {
          if (!longViewHooks?.stats) return;
          for (const [key, value] of Object.entries(counters)) {
            longViewHooks.stats.counters[key] = value;
          }
        },
      },
    )
    : null;

  if (shadowProxyDebugState && shadowProxyController) {
    shadowProxyDebugState.shadowProxyStatsLine = shadowProxyController.runtime.stats.built
      ? `tris ${shadowProxyController.runtime.stats.triangleCount}`
      : "shadow proxy: not built";
  }

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

  const cutChangedRef: { fn: () => void } = { fn: () => {} };
  const parentByNodeId = new Map<string, ClodPageNode>();
  for (const node of allNodes) {
    for (const child of node.children) {
      if (child) parentByNodeId.set(child.id, node);
    }
  }
  const prefetchNodes = (rendered: readonly ClodPageNode[], frameId: number): void => {
    const config = clodRuntime.renderNodeCache;
    if (!config.prefetchParent && !config.prefetchChildren) return;
    const candidates: ClodPageNode[] = [];
    const seen = new Set<string>();
    const addCandidate = (node: ClodPageNode | null | undefined) => {
      if (!node || seen.has(node.id)) return;
      seen.add(node.id);
      candidates.push(node);
    };
    for (const node of rendered) {
      if (config.prefetchParent) addCandidate(parentByNodeId.get(node.id));
      if (config.prefetchChildren) {
        for (const child of node.children) addCandidate(child);
      }
      if (candidates.length >= config.maxPrefetchCreatesPerFrame) break;
    }
    renderNodeCache.prefetch(candidates, frameId);
  };
  const selectionController = createClodSelectionController({
    config: {
      clodRuntime,
      hysteresisMergeFactor: cfg.selection.hysteresis_merge_factor,
      chunksPerPage: cfg.page.chunks_per_page,
      chunkSize: cfg.page.chunk_size,
      readbackMode: queryReadbackMode,
      forceContinuousParity: queryWebGpuParity,
      webGpuUnavailableReason: getWebGpuUnavailableReason(),
      poolTerrainMaterial,
    },
    roots: result.roots,
    allNodes,
    views,
    getOrCreateView: (node, frameId) => renderNodeCache.getOrCreate({ node, frameId }),
    markActiveNodes: (nodeIds, frameId) => renderNodeCache.markActive(nodeIds, frameId),
    prefetchNodes,
    getClodErrorCompute,
    getSettings: () => ({
      thresholdPx: state.thresholdPx,
      enforce21: state.enforce21,
      freezeSelection: (state as any).freezeSelection ?? false,
      neighborLevelDeltaMax: (state as any).neighborLevelDeltaMax ?? 1,
      bubble: state.bubble,
      bubbleRadius: state.bubbleRadius,
      forceMaxLevel: state.forceMaxLevel as number | "auto",
      webgpuSelection: state.webgpuSelection,
      showBounds: state.showBounds,
      showSeamPoints: state.showSeamPoints,
      showCrossLodBorders: state.showCrossLodBorders,
      showLockedBorderVertices: state.showLockedBorderVertices,
      materialTiers: state.materialTiers,
    }),
    getSelectionCenter: () => interaction.mode === "playing" ? player.position : camera.position,
    renderer: input.renderer,
    camera,
    overlays: { boundaryGroup, seamGroup, crossLodBorderGroup },
    lockedBorderOverlay,
    staleEditedAncestorIds,
    onCutChanged: () => cutChangedRef.fn(),
  });
  const updateSelection = () => selectionController.update();

  const geometryForView = (view: NodeView, normalMode: PageGeometryNormalMode) => (
    pageGeometryCache.getOrCreateWithResult({
      node: view.node,
      normalMode,
      createGeometry: () => {
        const geometry = toGeometry(view.node.mesh);
        if (normalMode === "recomputed") {
          geometry.setAttribute("normal", new THREE.BufferAttribute(recomputedNormalsFor(view), 3));
        }
        return geometry;
      },
    })
  );

  const assignViewGeometry = (
    view: NodeView,
    geometry: THREE.BufferGeometry,
    previousWasCacheOwned = pageGeometryCache.owns(view.mesh.geometry as THREE.BufferGeometry),
  ): void => {
    const previous = view.mesh.geometry as THREE.BufferGeometry;
    if (previous === geometry) {
      pageGeometryCache.setGeometryActive(geometry, true);
      return;
    }
    if (previousWasCacheOwned) pageGeometryCache.setGeometryActive(previous, false);
    else previous.dispose();
    view.mesh.geometry = geometry;
    pageGeometryCache.setGeometryActive(geometry, true);
  };

  const setViewNormalMode = (view: NodeView, normalMode: PageGeometryNormalMode): void => {
    assignViewGeometry(view, geometryForView(view, normalMode).geometry);
  };

  const applyNodeGeometry = (node: ClodPageNode): ClodGeometryApplyResult => {
    const v = views.get(node.id);
    if (!v) {
      return { applied: false, geometryMs: 0, materialMs: 0, triangles: triangleCount(node.mesh), reusedGeometry: false };
    }
    const gs = performance.now();
    const previousWasCacheOwned = pageGeometryCache.owns(v.mesh.geometry as THREE.BufferGeometry);
    v.node = node;
    v.sourceNormals = node.mesh.normals;
    v.recomputedNormals = null;
    const normalMode: PageGeometryNormalMode = state.recomputedNormals ? "recomputed" : "source";
    const geometryResult = geometryForView(v, normalMode);
    assignViewGeometry(v, geometryResult.geometry, previousWasCacheOwned);
    return {
      geometryMs: performance.now() - gs,
      materialMs: 0,
      triangles: triangleCount(node.mesh),
      reusedGeometry: geometryResult.cacheHit,
    };
  };

  const applyNodeCollider = (node: ClodPageNode): number => {
    if (node.level !== 0) return 0;
    const tc = performance.now();
    // Async revision-validated replacement (P2): the old collider serves (stale-safe)
    // until the off-frame rebuild installs; no MeshBVH build on this frame path.
    terrainColliders.schedulePageUpdate(node.id, node.mesh, getDigEditRevision());
    return performance.now() - tc;
  };

  const applyNodeMesh = (node: ClodPageNode): { geometrySwapMs: number; colliderMs: number } => {
    const geometry = applyNodeGeometry(node);
    const colliderMs = node.level === 0 ? applyNodeCollider(node) : 0;
    return { geometrySwapMs: geometry.geometryMs, colliderMs };
  };

  const clodApplyQueue = new ClodApplyQueue({
    budget: clodRuntime.clodApply,
    applyGeometry: applyNodeGeometry,
    applyCollider: applyNodeCollider,
    getFrameId: () => selectionController.stats().frameId,
    getCameraPosition: () => {
      const p = interaction.mode === "playing" ? player.position : camera.position;
      return { x: p.x, z: p.z };
    },
    isNodeVisible: (nodeId) => {
      const view = views.get(nodeId);
      return Boolean(view && (view.mesh.visible || view.fade > 0.001 || view.target > 0));
    },
    onGeometryApplied: (node) => {
      staleEditedAncestorIds.delete(node.id);
      selectionController.patchNodes([node]);
      selectionController.invalidate();
    },
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
    getCanopyConfig: () => liveCanopyConfig,
    setCanopyConfig: (config: CanopyShellConfig) => {
      liveCanopyConfig = { ...config };
      if (canopyDebugState) {
        applyConfigToCanopyDebugState(canopyDebugState, config);
      }
    },
    shadowProxyController,
    shadowProxyDebugState,
    getShadowProxyConfig: () => liveShadowProxyConfig,
    setShadowProxyConfig: (config: import("../../shadows/shadowProxyTypes.js").ShadowProxyConfig) => {
      liveShadowProxyConfig = { ...config };
    },
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
    selectionController,
    updateSelection,
    cutChangedRef,
    applyNodeMesh,
    applyNodeGeometry,
    applyNodeCollider,
    clodApplyQueue,
    drainClodApplyQueue: () => clodApplyQueue.drain(),
    getClodApplyStats: () => clodApplyQueue.stats(),
    setViewNormalMode,
  };
}
