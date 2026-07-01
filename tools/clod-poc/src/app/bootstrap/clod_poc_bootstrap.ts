import phase0ConfigText from "../../../config/infinite_streaming_phase0.yaml?raw";
import naadfConfigText from "../../../config/naadf_poc.yaml?raw";
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
import { initFarSummaryIntegration } from "../../far-summary/integration.js";
import type { FarSummaryIntegration } from "../../far-summary/integration.js";
import { initNaadfIntegration, isNaadfScene, type NaadfIntegration } from "../../naadf/integration.js";
import { InfiniteFarShell, createFarShellMetrics, createDefaultLongViewConfig, longViewConfigToFarSummaryConfig } from "../../long-view/index.js";
import type { FarShellMetrics } from "../../long-view/index.js";
import { loadLongViewMaterialsConfig, parseQueryOverrides } from "../../config/longViewMaterialsConfig.js";
import { configToUniformData } from "../../farTerrain/farTerrainUniforms.js";
import { applyOwnershipToFarShellRange, resolveStreamingOwnership } from "../../streaming/streaming_ownership.js";
import { FloatingOriginController } from "../../precision/floating_origin.js";
import { RIVER_PARITY_TEST_SCENE } from "../../water/riverParityScene.js";
import { createBakedMacroTintTexture } from "../../gpu/terrain_node_material.js";
import { createProceduralTerrainTextures } from "../../textures/terrainTextureArrays.js";
import { createBiomeTextureStreamingManager } from "../../textures/biome_texture_streaming_manager.js";
import * as THREE from "three";

function booleanQueryParam(searchParams: URLSearchParams, key: string): boolean {
  const raw = searchParams.get(key);
  return raw !== null && raw !== "0" && raw !== "false";
}

function positiveNumberQueryParam(searchParams: URLSearchParams, key: string, fallback: number): number {
  const value = Number(searchParams.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

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

  const floatingOrigin = new FloatingOriginController(renderer.scene, {
    enabled: booleanQueryParam(searchParams, "floatingOrigin") || booleanQueryParam(searchParams, "floating_origin"),
    snapMeters: positiveNumberQueryParam(searchParams, "floatingOriginSnap", 4096),
    unboundedWorld: world.worldSource.metadata.bounds === "infinite",
  });

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
    hydrologyFieldsTexture: world.hydrologySystem?.hydrologyFieldsTexture() ?? null,
    isLongView: postRenderer.isLongView,
    queryFarShell: queries.queryFarShell,
    queryCanopy: queries.queryCanopy,
    queryScene: queries.queryScene,
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

  let terrainTextureWindowSwaps = 0;
  const biomeTextureStreaming = world.proceduralTerrain
    ? createBiomeTextureStreamingManager({
        baseConfig: world.proceduralTextureConfig,
        sampleBiome: (x, z) => world.worldSource.sampleBiome(x, z),
        onActiveWindowChanged: (nextConfig, activeBiomeMaterials) => {
          const nextTerrain = createProceduralTerrainTextures(nextConfig);
          const bakeRes = Math.min(512, nextTerrain.noise.resolution);
          const nextMacroTint = createBakedMacroTintTexture(
            nextTerrain.noise.noiseA,
            nextTerrain.noise.noiseB,
            bakeRes,
          );
          world.proceduralTextureConfig = nextConfig;
          world.proceduralTerrain = nextTerrain;
          world.bakedMacroTint = nextMacroTint;
          terrainTextureWindowSwaps++;
          terrainView.materialController.setProceduralTerrain(nextTerrain, nextConfig, nextMacroTint);
          terrainView.applyTerrainTextures();
          if (postRenderer.longViewHooks?.stats) {
            postRenderer.longViewHooks.stats.counters.terrainTextureWindowSwaps = terrainTextureWindowSwaps;
            postRenderer.longViewHooks.stats.counters.terrainTextureActiveBiomes = activeBiomeMaterials.length;
          }
        },
      })
    : null;

  if (postRenderer.state.terrainMaterialSource === "procedural") {
    const initialWorldCamera = floatingOrigin.getWorldCamera(renderer.camera);
    biomeTextureStreaming?.update({ x: initialWorldCamera.position.x, z: initialWorldCamera.position.z, frameIndex: 0 });
  }

  let farSummaryIntegration: FarSummaryIntegration | undefined;
  let naadfIntegration: NaadfIntegration | undefined;

  const queryScene = queries.queryScene;
  const isNaadfCapable = queries.queryNaadfScene;
  const streamingOwnership = resolveStreamingOwnership({
    streaming: queries.phase0Streaming,
    targetVisibleM: queries.phase0TargetVisibleM,
    targetFutureVisibleM: queries.phase0Config.phase0.target_future_visible_m,
    pageSizeM: world.cfg.page.chunks_per_page * world.cfg.page.chunk_size,
    streamingScene: queryScene?.startsWith("infinite-") ?? false,
  });

  if (isNaadfCapable) {
    naadfIntegration = initNaadfIntegration({
      yamlText: naadfConfigText,
      sceneName: queryScene,
      threeScene: renderer.scene,
      forceEnable: queries.queryNaadfScene,
    }) ?? undefined;
  }

  const useNaadfFarSummary = Boolean(
    naadfIntegration?.config.farShell.useNaadfSummary
    && (queryScene?.startsWith("infinite-naadf-") ?? false),
  );
  const naadfHeightSamplingMode = useNaadfFarSummary
    ? naadfIntegration?.config.farShell.heightSamplingMode
    : undefined;

  const isLongViewCapableScene =
    queryScene === "infinite-stream-far-summary" ||
    queryScene === "infinite-stream-slow-builds" ||
    queryScene === "infinite-islands" ||
    queryScene === "infinite-stream-straight" ||
    queryScene === "infinite-stream-fast-turn" ||
    queryScene === "long-view-4km" ||
    queryScene === "long-view-8km" ||
    queryScene === "long-view-16km" ||
    queryScene === "long-view-forest-4km" ||
    queryScene === "long-view-edit-stress" ||
    queryScene === RIVER_PARITY_TEST_SCENE ||
    queryScene === "infinite-far-shell-straight" ||
    queryScene === "infinite-far-shell-fast-turn" ||
    queryScene === "infinite-far-shell-mountain-approach" ||
    isNaadfScene(queryScene);

  let infiniteFarShell: InfiniteFarShell | undefined;
  let farShellMetrics: FarShellMetrics | undefined;

  if (isLongViewCapableScene) {
    const lvConfig = createDefaultLongViewConfig();

    if (queryScene === "long-view-8km" || queryScene === "infinite-far-shell-straight" || queryScene === "infinite-far-shell-fast-turn" || queryScene === "infinite-far-shell-mountain-approach") {
      lvConfig.targetVisibleMeters = 8192;
      lvConfig.farShell.endMeters = 16384;
    } else if (queryScene === "long-view-16km") {
      lvConfig.targetVisibleMeters = 16384;
      lvConfig.farShell.endMeters = 32768;
      lvConfig.farShell.farFadeMeters = 4096;
    }

    if (naadfIntegration && (queryScene?.startsWith("infinite-naadf-") ?? false)) {
      lvConfig.farShell.startMeters = naadfIntegration.config.farShell.startM;
      lvConfig.farShell.endMeters = naadfIntegration.config.farShell.endM;
      if (naadfIntegration.config.farShell.gridRes > 0) {
        lvConfig.farShell.radialSegments = naadfIntegration.config.farShell.gridRes;
        lvConfig.farShell.angularSegments = naadfIntegration.config.farShell.gridRes;
      }
    }

    applyOwnershipToFarShellRange(lvConfig.farShell, streamingOwnership);

    farShellMetrics = createFarShellMetrics();
    farShellMetrics.farShellEnabled = true;
    farShellMetrics.farShellInnerM = lvConfig.farShell.startMeters;
    farShellMetrics.farShellOuterM = lvConfig.farShell.endMeters;
    farShellMetrics.farShellGridRes = lvConfig.farShell.radialSegments;

    if (!useNaadfFarSummary) {
      farSummaryIntegration = initFarSummaryIntegration({
        terrainSampler: {
          sampleHeight: (x: number, z: number) => world.worldSource.sampleHeight(x, z),
          sampleMaterial: (x, z) => world.worldSource.sampleBiome(x, z),
          sampleCanopyCoverage: (x, z) => naadfIntegration?.getCanopySampler().sampleCanopyCoverage(x, z) ?? 0,
          sampleWaterCoverage: (x, z) => world.worldSource.oceanMask(x, z),
        },
        scene: renderer.scene,
        camera: renderer.camera,
        farShellController: terrainView.farShellController,
        farShellMetrics,
        config: longViewConfigToFarSummaryConfig(lvConfig),
      });
    }

    const heightProvider = useNaadfFarSummary && naadfIntegration
      ? naadfIntegration.getHeightProvider()
      : farSummaryIntegration?.getHeightProvider();
    const lighting = terrainView.currentLighting();

    const materialConfig = loadLongViewMaterialsConfig(undefined, parseQueryOverrides(searchParams));
    const parityConfig = materialConfig.enabled ? configToUniformData(materialConfig) : undefined;
    const useParity = materialConfig.enabled && parityConfig !== undefined;
    const farSummaryGpuAtlas = naadfHeightSamplingMode === "gpu"
      ? naadfIntegration?.getFarSummaryGpuAtlasView()
      : undefined;

    if (naadfHeightSamplingMode === "gpu" && !useParity) {
      throw new Error("NAADF GPU height mode requires the WebGPU parity far terrain material");
    }
    if (naadfHeightSamplingMode === "gpu" && !farSummaryGpuAtlas) {
      throw new Error("NAADF GPU height mode requires a far-summary GPU atlas");
    }

    const effectiveHeightSamplingMode = naadfHeightSamplingMode === "gpu"
      ? "gpu"
      : naadfHeightSamplingMode;
    if (!heightProvider && effectiveHeightSamplingMode !== "gpu") {
      throw new Error("long-view scene requires NAADF or far-summary height provider");
    }

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
      useParityMaterial: useParity,
      parityConfig,
      heightSamplingMode: effectiveHeightSamplingMode,
      farSummaryGpuAtlas: effectiveHeightSamplingMode === "gpu" ? farSummaryGpuAtlas : undefined,
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

    if (queryScene === "infinite-stream-slow-builds" && farSummaryIntegration) {
      farSummaryIntegration.setForceSlowBuilds(true);
      farSummaryIntegration.setBuildDelayMs(100);
    }
  }

  const treeTerrainOcclusionSampler = naadfIntegration
    ? {
        sampleHeight: (x: number, z: number) => {
          const sample = naadfIntegration!.queryHeight(x, z, "render");
          return { height: sample.height, unknown: sample.unknown || sample.missingSample };
        },
      }
    : undefined;

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
    stagedImport,
    queryGrassRingGrid: queries.queryGrassRingGrid,
    queryGrassRingCell: queries.queryGrassRingCell,
    isWebGpu: renderer.isWebGpu,
    rendererWebGpuDevice: renderer.rendererWebGpuDevice,
    hydrologySystem: world.hydrologySystem,
    terrainOcclusionSampler: treeTerrainOcclusionSampler,
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
    floatingOrigin,
    onFarSummaryUpdate: (farSummaryIntegration || naadfIntegration || terrainView.shadowProxyController || biomeTextureStreaming || infiniteFarShell || floatingOrigin)
      ? (frameIndex: number, deltaSeconds: number, camera: THREE.PerspectiveCamera) => {
          const originStats = floatingOrigin.stats();
          if (postRenderer.longViewHooks?.stats) {
            postRenderer.longViewHooks.stats.counters.floatingOriginEnabled = originStats.enabled ? 1 : 0;
            postRenderer.longViewHooks.stats.counters.floatingOriginRebaseCount = originStats.rebaseCount;
            postRenderer.longViewHooks.stats.counters.floatingOriginLastRebaseFrame = originStats.lastRebaseFrame;
            postRenderer.longViewHooks.stats.counters.floatingOriginOffsetX = originStats.originX;
            postRenderer.longViewHooks.stats.counters.floatingOriginOffsetZ = originStats.originZ;
          }
          infiniteFarShell?.setRenderOriginOffset(originStats.originX, originStats.originZ);
          if (farSummaryIntegration) {
            farSummaryIntegration.update(frameIndex, deltaSeconds, camera);
          }
          naadfIntegration?.update(frameIndex, deltaSeconds, camera);
          if (infiniteFarShell) {
            infiniteFarShell.update(camera.position.x, camera.position.z, frameIndex);
          }
          terrainView.shadowProxyController?.updateFrame(camera.position.x, camera.position.z);
          if (postRenderer.state.terrainMaterialSource === "procedural") {
            biomeTextureStreaming?.update({ x: camera.position.x, z: camera.position.z, frameIndex });
          }
        }
      : undefined,
    naadfIntegration,
    getClodErrorCompute: postRenderer.getClodErrorCompute,
    ensureClodErrorCompute: postRenderer.ensureClodErrorCompute,
    textureLoadOptions: postRenderer.textureLoadOptions,
    treeConfig: world.treeConfig,
    understoryConfig: world.understoryConfig,
  });
}
