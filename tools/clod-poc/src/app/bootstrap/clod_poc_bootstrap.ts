import phase0ConfigText from "../../../config/infinite_streaming_phase0.yaml?raw";
import { installGlobalErrorHooks } from "../../core/diagnostics.js";
import { parseClodRuntimeConfig } from "../runtime_config.js";
import { runContentRegistryStartup } from "./content_registry_startup.js";
import { loadStagedProjectImport } from "./project_import_startup.js";
import { runEarlyRoutes } from "./early_routes.js";
import { initDomShell } from "./dom_shell.js";
import { parseBootstrapQueryContext } from "./query_context.js";
import { runWorldBuildStartup } from "./world_build_startup.js";
import { runRendererStartup } from "./renderer_startup.js";
import { runPostRendererStartup } from "./post_renderer_startup.js";
import { runTerrainViewStartup } from "./terrain_view_startup.js";
import { runRuntimeSystemsStartup } from "./runtime/runtime_systems_startup.js";
import { runUiStartup } from "./ui/ui_startup.js";
import { surfaceHeightCore } from "../../gpu/terrain_field_core.js";
import { initFarSummaryIntegration } from "../../far-summary/integration.js";
import type { FarSummaryIntegration } from "../../far-summary/integration.js";
import { InfiniteFarShell, createFarShellMetrics, DEFAULT_LONG_VIEW_CONFIG, longViewConfigToFarSummaryConfig } from "../../long-view/index.js";
import type { FarShellMetrics } from "../../long-view/index.js";
import * as THREE from "three";


export async function bootstrapClodPoc() {
  const searchParams = new URLSearchParams(location.search);
  if (await runEarlyRoutes(searchParams)) return;

  installGlobalErrorHooks();
  const clodRuntime = parseClodRuntimeConfig();
  const dom = initDomShell();
  runContentRegistryStartup(dom.info);

  const queries = parseBootstrapQueryContext(searchParams, phase0ConfigText);
  const stagedImport = await loadStagedProjectImport(searchParams, {
    buildProgress: dom.buildProgress,
    buildProgressPhase: dom.buildProgressPhase,
    buildProgressPercent: dom.buildProgressPercent,
    buildProgressBar: dom.buildProgressBar,
    info: dom.info,
  });

  const world = await runWorldBuildStartup({
    stagedImport,
    clodRuntime,
    searchParams,
    queryGrassPerfScene: queries.queryGrassPerfScene,
    queryTreePerfScene: queries.queryTreePerfScene,
    queryForestFloorScene: queries.queryForestFloorScene,
    queryLongViewScene: queries.queryLongViewScene,
    queryBorderOceanScene: queries.queryBorderOceanScene,
    buildProgress: dom.buildProgress,
    buildProgressPhase: dom.buildProgressPhase,
    buildProgressPercent: dom.buildProgressPercent,
    buildProgressBar: dom.buildProgressBar,
    info: dom.info,
  });

  const renderer = await runRendererStartup({
    searchParams,
    cfg: world.cfg,
    worldCells: world.worldCells,
    lod0Nodes: world.lod0Nodes,
    waterConfig: world.waterConfig,
    stagedImport,
    queryGrassPerfScene: queries.queryGrassPerfScene,
    queryTreePerfScene: queries.queryTreePerfScene,
    queryLongViewScene: queries.queryLongViewScene,
    queryBorderOceanScene: queries.queryBorderOceanScene,
    activePhase0Scene: queries.activePhase0Scene,
  });
  if (!renderer) return;

  const postRenderer = await runPostRendererStartup({
    info: dom.info,
    searchParams,
    clodRuntime,
    cfg: world.cfg,
    stagedImport,
    queries,
    world,
    renderer,
  });

  const terrainView = runTerrainViewStartup({
    app: renderer.app,
    scene: renderer.scene,
    camera: renderer.camera,
    renderer: renderer.renderer,
    controls: renderer.controls,
    state: postRenderer.state,
    bindings: postRenderer.uiRefs.bindings,
    clodRuntime,
    cfg: world.cfg,
    allNodes: world.allNodes,
    result: world.result,
    worldCells: world.worldCells,
    worldSizeCells: world.worldSizeCells,
    terrainSummary: world.terrainSummary,
    isLongView: postRenderer.isLongView,
    queryFarShell: queries.queryFarShell,
    queryCanopy: queries.queryCanopy,
    longViewHooks: postRenderer.longViewHooks,
    isWebGpu: renderer.isWebGpu,
    poolTerrainMaterial: renderer.poolTerrainMaterial,
    bakedMacroTint: world.bakedMacroTint,
    proceduralTerrain: world.proceduralTerrain,
    proceduralTextureConfig: world.proceduralTextureConfig,
    textureMipmapsEnabled: queries.textureMipmapsEnabled,
    maxAnisotropy: renderer.maxAnisotropy,
    textureLoadOptions: postRenderer.textureLoadOptions,
    stagedImport,
    searchParams,
    rendererWebGpuDevice: renderer.rendererWebGpuDevice,
    interaction: renderer.interaction,
    player: renderer.player,
    terrainColliders: renderer.terrainColliders,
    getClodErrorCompute: postRenderer.getClodErrorCompute,
    getWebGpuUnavailableReason: postRenderer.getWebGpuUnavailableReason,
    queryReadbackMode: queries.queryReadbackMode,
    queryWebGpuParity: queries.queryWebGpuParity,
    staleEditedAncestorIds: postRenderer.terrainEdit.staleEditedAncestorIds,
    colorByLodUserOverride: postRenderer.uiRefs.colorByLodUserOverride,
    colorByLodController: postRenderer.uiRefs.colorByLodController,
  });

  let farSummaryIntegration: FarSummaryIntegration | undefined;

  const queryScene = queries.queryScene;
  const isLongViewCapableScene =
    queryScene === "infinite-stream-far-summary" ||
    queryScene === "infinite-stream-slow-builds" ||
    queryScene === "infinite-stream-straight" ||
    queryScene === "infinite-stream-fast-turn" ||
    queryScene === "long-view-4km" ||
    queryScene === "long-view-8km" ||
    queryScene === "long-view-16km" ||
    queryScene === "long-view-forest-4km" ||
    queryScene === "long-view-edit-stress" ||
    queryScene === "infinite-far-shell-straight" ||
    queryScene === "infinite-far-shell-fast-turn" ||
    queryScene === "infinite-far-shell-mountain-approach";

  let infiniteFarShell: InfiniteFarShell | undefined;
  let farShellMetrics: FarShellMetrics | undefined;

  if (isLongViewCapableScene) {
    const lvConfig = { ...DEFAULT_LONG_VIEW_CONFIG };

    if (queryScene === "long-view-8km" || queryScene === "infinite-far-shell-straight" || queryScene === "infinite-far-shell-fast-turn" || queryScene === "infinite-far-shell-mountain-approach") {
      lvConfig.targetVisibleMeters = 8192;
      lvConfig.farShell.endMeters = 16384;
    } else if (queryScene === "long-view-16km") {
      lvConfig.targetVisibleMeters = 16384;
      lvConfig.farShell.endMeters = 32768;
      lvConfig.farShell.farFadeMeters = 4096;
    }

    farShellMetrics = createFarShellMetrics();
    farShellMetrics.farShellEnabled = true;
    farShellMetrics.farShellInnerM = lvConfig.farShell.startMeters;
    farShellMetrics.farShellOuterM = lvConfig.farShell.endMeters;
    farShellMetrics.farShellGridRes = lvConfig.farShell.radialSegments;

    farSummaryIntegration = initFarSummaryIntegration({
      terrainSampler: {
        sampleHeight: (x: number, z: number) => surfaceHeightCore(x, z),
        sampleMaterial: () => 0,
        sampleCanopyCoverage: () => 0,
        sampleWaterCoverage: () => 0,
      },
      scene: renderer.scene,
      camera: renderer.camera,
      farShellController: terrainView.farShellController,
      farShellMetrics,
      config: longViewConfigToFarSummaryConfig(lvConfig),
    });

    const heightProvider = farSummaryIntegration.getHeightProvider();
    const lighting = terrainView.currentLighting();

    infiniteFarShell = new InfiniteFarShell({
      innerMeters: lvConfig.farShell.startMeters,
      outerMeters: lvConfig.farShell.endMeters,
      radialSegments: lvConfig.farShell.radialSegments,
      angularSegments: lvConfig.farShell.angularSegments,
      heightBiasMeters: lvConfig.farShell.heightBiasMeters,
      nearBlendMeters: lvConfig.farShell.nearBlendMeters,
      farFadeMeters: lvConfig.farShell.farFadeMeters,
      macroBlendStartMeters: lvConfig.farShell.macroBlendStartMeters,
      macroBlendEndMeters: lvConfig.farShell.macroBlendEndMeters,
      rebaseSnapMeters: lvConfig.farShell.rebaseSnapMeters,
      lighting: {
        sunDirection: lighting.sunDirection,
        sunColor: lighting.sunColor,
        skyLight: lighting.skyLight,
        groundLight: lighting.groundLight,
      },
      debugShowMissingFallback: lvConfig.debug.showMissingSummaryFallback,
      metrics: farShellMetrics,
    });

    infiniteFarShell.setHeightProvider(heightProvider);
    renderer.scene.add(infiniteFarShell.mesh);

    terrainView.farShellController.setEnabled(false);

    terrainView.shadowProxyController?.setOnSunShadowsChanged((enabled) => {
      infiniteFarShell?.setReceiveSunShadows(enabled);
    });
    if (terrainView.shadowProxyDebugState?.sunShadowsEnabled) {
      infiniteFarShell.setReceiveSunShadows(true);
    }

    if (queryScene === "infinite-stream-slow-builds") {
      farSummaryIntegration.setForceSlowBuilds(true);
      farSummaryIntegration.setBuildDelayMs(100);
    }
  }

  const runtime = await runRuntimeSystemsStartup({
    app: renderer.app,
    scene: renderer.scene,
    camera: renderer.camera,
    controls: renderer.controls,
    state: postRenderer.state,
    bindings: postRenderer.uiRefs.bindings,
    lod0Nodes: world.lod0Nodes,
    worldCells: world.worldCells,
    grassConfig: world.grassConfig,
    stoneConfig: world.stoneConfig,
    treeConfig: world.treeConfig,
    understoryConfig: world.understoryConfig,
    forestLightingConfig: world.forestLightingConfig,
    waterConfig: world.waterConfig,
    borderCoastOceanConfig: world.borderCoastOceanConfig,
    customPropsConfig: world.customPropsConfig,
    propPlacementScenes: world.propPlacementScenes,
    queryGrassRingGrid: queries.queryGrassRingGrid,
    queryGrassRingCell: queries.queryGrassRingCell,
    isWebGpu: renderer.isWebGpu,
    rendererWebGpuDevice: renderer.rendererWebGpuDevice,
    hydrologySystem: world.hydrologySystem,
    searchParams,
    materialController: terrainView.materialController,
    skyEnvironment: terrainView.skyEnvironment,
    currentLighting: terrainView.currentLighting,
    vegetationDirtyQueue: postRenderer.terrainEdit.vegetationDirtyQueue,
    statControllers: postRenderer.uiRefs.statControllers,
    getHooks: () => postRenderer.longViewHooks,
    shadowProxyController: terrainView.shadowProxyController,
  });

  await runUiStartup({
    dom,
    searchParams,
    clodRuntime,
    cfg: world.cfg,
    WORLD: world.WORLD,
    polishLine: world.polishLine,
    buildStatusRef: world.buildStatus,
    stagedImport,
    state: postRenderer.state,
    bindings: postRenderer.uiRefs.bindings,
    colorByLodUserOverride: postRenderer.uiRefs.colorByLodUserOverride,
    colorByLodController: postRenderer.uiRefs.colorByLodController,
    terrainView,
    runtime,
    statControllers: postRenderer.uiRefs.statControllers,
    app: renderer.app,
    renderer: renderer.renderer,
    scene: renderer.scene,
    camera: renderer.camera,
    controls: renderer.controls,
    player: renderer.player,
    interaction: renderer.interaction,
    terrainColliders: renderer.terrainColliders,
    terrainRaycast: renderer.terrainRaycast,
    isWebGpu: renderer.isWebGpu,
    worldCells: world.worldCells,
    clodWorker: world.clodWorker,
    result: world.result,
    allNodes: world.allNodes,
    maxTerrainLevel: world.maxTerrainLevel,
    markEditedAncestorsStale: postRenderer.terrainEdit.markEditedAncestorsStale,
    vegetationDirtyQueue: postRenderer.terrainEdit.vegetationDirtyQueue,
    staleEditedAncestorIds: postRenderer.terrainEdit.staleEditedAncestorIds,
    selectionQueryFlags: {
      queryGrassPerfScene: queries.queryGrassPerfScene,
      queryTreePerfScene: queries.queryTreePerfScene,
      queryForestFloorScene: queries.queryForestFloorScene,
    },
    longView: {
      hooks: postRenderer.longViewHooks,
      settleWaiters: postRenderer.longViewSettleWaiters,
      isLongView: postRenderer.isLongView,
      phase0TargetVisibleM: queries.phase0TargetVisibleM,
      phase0Config: queries.phase0Config,
      queryScene: queries.queryScene,
      phase0VelocityX: queries.phase0VelocityX,
      phase0VelocityZ: queries.phase0VelocityZ,
      phase0Streaming: queries.phase0Streaming,
      infiniteFarShell,
      farShellMetrics,
    },
    onFarSummaryUpdate: farSummaryIntegration
      ? (frameIndex: number, deltaSeconds: number, camera: THREE.PerspectiveCamera) => {
          farSummaryIntegration!.update(frameIndex, deltaSeconds, camera);
          if (infiniteFarShell) {
            infiniteFarShell.update(camera.position.x, camera.position.z, frameIndex);
          }
          terrainView.shadowProxyController?.updateFrame(camera.position.x, camera.position.z);
        }
      : terrainView.shadowProxyController
        ? (_frameIndex: number, _deltaSeconds: number, camera: THREE.PerspectiveCamera) => {
            terrainView.shadowProxyController?.updateFrame(camera.position.x, camera.position.z);
          }
        : undefined,
    getClodErrorCompute: postRenderer.getClodErrorCompute,
    ensureClodErrorCompute: postRenderer.ensureClodErrorCompute,
    textureLoadOptions: postRenderer.textureLoadOptions,
    treeConfig: world.treeConfig,
    understoryConfig: world.understoryConfig,
  });
}
