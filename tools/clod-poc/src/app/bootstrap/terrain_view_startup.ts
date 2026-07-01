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
  currentLighting: () => EnvironmentLighting;
  views: Map<string, NodeView>;
  selectionController: ClodSelectionController;
  lockedBorderOverlay: LockedBorderOverlay;
  nodeLabelOverlay: NodeLabelOverlay;
  shadowProxyController: ShadowProxyController | null;
  shadowProxyDebugState: ShadowProxyDebugState | null;
  canopySystem: CanopyShellSystem | null;
  canopyDebugState: CanopyDebugState | null;
}

export function createTerrainViews(input: TerrainViewStartupInput): TerrainViewStartupResult {
  const {
    app,
    scene,
    camera,
    controls,
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
    queryScene,
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
    base: state.baseColor,
    slopeTint: state.slopeTint,
    heightTint: state.heightTint,
    slopeStrength: state.slopeStrength,
    heightStrength: state.heightStrength,
    macroVariation: state.macroVariation,
  });
  const currentEnvironmentSettings = (): EnvironmentSettings => ({
    sunAzimuthDeg: state.sunAzimuthDeg,
    sunElevationDeg: state.sunElevationDeg,
    sunIntensity: state.sunIntensity,
    skyIntensity: state.skyIntensity,
    groundIntensity: state.groundIntensity,
    exposure: state.environmentExposure,
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
    godRaysMode: state.godRaysMode,
    godRaysDensity: state.godRaysDensity,
    godRaysDecay: state.godRaysDecay,
    godRaysWeight: state.godRaysWeight,
    godRaysExposure: state.godRaysExposure,
  });
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

  const postProcess: AppPostProcess = app.isWebGpu
    ? new WebGpuPostProcessPipeline(app.renderer, scene, camera, currentPostProcessSettings(), currentLighting)
    : new PostProcessPipeline(app.renderer, currentPostProcessSettings());
  postProcess.setSize(window.innerWidth, window.innerHeight);

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
      horizonBlend: state.farShellHorizonBlend,
      canopyEnabled: state.farCanopyEnabled,
      canopyRadiusFactor: state.farCanopyRadiusFactor,
      canopyHorizonBlend: state.farCanopyHorizonBlend,
      materialParity: parityUniformData,
    }),
  });

  const selectionController = createClodSelectionController({
    roots: result.roots,
    views,
    camera,
    renderer: app.renderer,
    controls,
    config: cfg,
    state,
    farShellController,
    staleEditedAncestorIds,
  });

  const lockedBorderOverlay = new LockedBorderOverlay(scene);
  const nodeLabelOverlay = new NodeLabelOverlay();
  document.body.appendChild(nodeLabelOverlay.element);

  const shadowProxyController = isLongView && longViewSunConfig.enabled
    ? createShadowProxyController({
        scene,
        terrainSummary,
        config: liveShadowProxyConfig,
        lighting: currentLighting(),
        debugState: shadowProxyDebugState,
        snapMeters: resolveShadowProxyRebuildSnapMeters(longViewSunConfig),
        getCamera: () => camera,
      })
    : null;

  const canopySystem = useDeterministicCanopy
    ? createCanopyShellSystem({
        scene,
        terrainSummary,
        worldSizeCells,
        config: liveCanopyConfig,
        debugState: canopyDebugState,
        getLighting: currentLighting,
        getCamera: () => camera,
      })
    : null;

  bindings.registerRuntimeCallbacks({
    currentEnvironmentSettings,
    updateEnvironment: () => {
      skyEnvironment.updateSettings(currentEnvironmentSettings());
      const lighting = currentLighting();
      materialController.applyLightingToAll(lighting);
      shadowProxyController?.updateLighting(lighting);
      canopySystem?.updateLighting(lighting);
    },
    currentTerrainColorAdjustments,
    updateTerrainColors: () => materialController.applyColorAdjustmentsToAll(currentTerrainColorAdjustments()),
    applyTerrainTextures,
    applyColorByLodToMaterials,
    updateFarShell: () => farShellController.update(),
    updateShadowProxy: () => {
      liveShadowProxyConfig = applyShadowProxyDebugQueryOverrides(
        applyShadowProxySceneOverrides(longViewSunConfig.shadowProxy, searchParams),
        searchParams,
      );
      shadowProxyController?.updateConfig(liveShadowProxyConfig);
    },
    updateCanopy: () => {
      liveCanopyConfig = applyCanopyShellQueryOverrides(parseCanopyShellConfig(canopyShellYaml), searchParams);
      if (canopyDebugState) applyConfigToCanopyDebugState(canopyDebugState, liveCanopyConfig);
      canopySystem?.updateConfig(liveCanopyConfig);
    },
  });

  if (queryWebGpuParity && rendererWebGpuDevice) {
    const gpuMesher = new GpuChunkMesher({ device: rendererWebGpuDevice, readbackMode: queryReadbackMode });
    const edits = getDigEditsSnapshot();
    const chunkMesh = meshChunk(0, 0, 0, cfg.page.chunk_size);
    void gpuMesher.meshChunk({
      x0: 0,
      y0: 0,
      z0: 0,
      size: cfg.page.chunk_size,
      edits: resolveDigEdits(edits),
    }).then((gpuMesh) => {
      const report = compareChunkSurfaces(chunkMesh, gpuMesh);
      console.info("[webgpu-parity]", report);
    }).catch((error) => {
      console.error("[webgpu-parity] failed", error);
    });
  }

  return {
    postProcess,
    currentLighting,
    views,
    selectionController,
    lockedBorderOverlay,
    nodeLabelOverlay,
    shadowProxyController,
    shadowProxyDebugState,
    canopySystem,
    canopyDebugState,
  };
}
