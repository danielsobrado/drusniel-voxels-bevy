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
import type { ProjectArchiveContents } from "../../project/project_archive.js";
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
  stagedImport: ProjectArchiveContents | null;
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

  for (const node of allNodes) {
    const mat = materialController.makeTerrainMaterial(
      state.colorByLod ? LOD_COLORS[Math.min(node.level, LOD_COLORS.length - 1)] : 0xb9c0c8,
    );
    mat.setColorAdjust(currentTerrainColorAdjustments());
    materialController.applyLighting(mat);
    const mesh = new THREE.Mesh(toGeometry(node.mesh), mat.material);
    mat.onMaterialChanged((material) => {
      mesh.material = material;
    });
    mesh.visible = false;
    scene.add(mesh);
    views.set(node.id, {
      node,
      mesh,
      mat,
      sourceNormals: node.mesh.normals,
      recomputedNormals: null,
      selected: false,
      fade: 0,
      target: 0,
    });
  }

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
    skipLegacyCanopy: useDeterministicCanopy,
    onTriangleCount: (counter, count) => {
      if (longViewHooks?.stats) longViewHooks.stats.counters[counter] = count;
    },
  });

  if (state.farShellEnabled) {
    farShellController.rebuild();
  } else {
    farShellController.setEnabled(false);
  }

  const canopyShellSystem = useDeterministicCanopy
    ? createCanopyShellSystem(canopyShellYaml, searchParams, queryScene, input.queryCanopy, {
      scene,
      terrainSummary,
      worldSizeCells,
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
  const gpuMeshEnabled = searchParams.get("gpuMesh") === "1";
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
  });

  const pageTransitionMode = cfg.selection.transition_mode;
  const crossfadeStep = cfg.selection.crossfade_frames > 0
    ? 1 / cfg.selection.crossfade_frames
    : 1;
  const applyColorAdjustmentsToTerrain = () => {
    materialController.applyColorAdjustments();
  };

  const cutChangedRef: { fn: () => void } = { fn: () => {} };
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
    getSelectionCenter: () => interaction.mode === "playing" ? player.position : input.controls.target,
    renderer: input.renderer,
    camera,
    overlays: { boundaryGroup, seamGroup, crossLodBorderGroup },
    lockedBorderOverlay,
    staleEditedAncestorIds,
    onCutChanged: () => cutChangedRef.fn(),
  });
  const updateSelection = () => selectionController.update();

  const applyNodeMesh = (node: ClodPageNode): { geometrySwapMs: number; colliderMs: number } => {
    const v = views.get(node.id);
    let geometrySwapMs = 0;
    if (v) {
      const gs = performance.now();
      v.mesh.geometry.dispose();
      v.mesh.geometry = toGeometry(node.mesh);
      v.sourceNormals = node.mesh.normals;
      v.recomputedNormals = null;
      if (state.recomputedNormals) {
        v.mesh.geometry.setAttribute("normal", new THREE.BufferAttribute(recomputedNormalsFor(v), 3));
      }
      geometrySwapMs = performance.now() - gs;
    }
    if (node.level !== 0) return { geometrySwapMs, colliderMs: 0 };
    const tc = performance.now();
    terrainColliders.updatePage(node.id, node.mesh);
    nearFieldBubbleController.invalidatePage(node.id);
    return { geometrySwapMs, colliderMs: performance.now() - tc };
  };

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
    pageTransitionMode,
    crossfadeStep,
    selectionController,
    updateSelection,
    cutChangedRef,
    applyNodeMesh,
  };
}
