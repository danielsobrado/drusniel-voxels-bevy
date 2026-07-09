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
import { timeFarSummarySubphase } from "../frame_loop/far_summary_subphase_timing.js";
import type { FarSummaryIntegration } from "../../far-summary/integration.js";
import { clearSaveInvalidationTargets, registerSaveInvalidationTarget } from "../../save/save_far_summary_bridge.js";
import { attachSaveRuntimeCounters, hasActiveSaveRuntime, markSaveRuntimeLoadedRegionsInvalidated } from "../../save/save_runtime.js";
import { initNaadfIntegration, type NaadfIntegration } from "../../naadf/integration.js";
import { InfiniteFarShell, createFarShellMetrics, createDefaultLongViewConfig, longViewConfigToFarSummaryConfig } from "../../long-view/index.js";
import type { FarShellMetrics } from "../../long-view/index.js";
import { loadLongViewMaterialsConfig, parseQueryOverrides } from "../../config/longViewMaterialsConfig.js";
import { configToUniformData } from "../../farTerrain/farTerrainUniforms.js";
import { applyOwnershipToFarShellRange, resolveStreamingOwnership } from "../../streaming/streaming_ownership.js";
import { assertLegacyFarShellExclusive, buildFarOwnershipSummary } from "../far_ownership.js";
import { farClipmapRendererAllowed } from "../../terrain/far_clipmap/far_clipmap_config.js";
import { FloatingOriginController } from "../../precision/floating_origin.js";
import { createBakedMacroTintTexture } from "../../gpu/terrain_node_baked_macro_tint.js";
import { createProceduralTerrainTextures } from "../../textures/terrainTextureArrays.js";
import { createBiomeTextureStreamingManager } from "../../textures/biome_texture_streaming_manager.js";
import * as THREE from "three";
import { booleanQueryParam, positiveNumberQueryParam } from "./bootstrap_query_params.js";
import { applyLongViewScenePreset, isLongViewCapableScene } from "./bootstrap_long_view.js";
import {
  materialChurnConfigForQuery,
  materialChurnDiagnostics,
} from "../../rendering/material_churn/material_churn_diagnostics.js";

const MAX_TERRAIN_TEXTURE_WINDOW_CACHE = 8;

export async function bootstrapClodPoc() {
  const searchParams = new URLSearchParams(location.search);
  if (await runEarlyRoutes(searchParams)) return;

  installGlobalErrorHooks();
  const clodRuntime = parseClodRuntimeConfig();
  materialChurnDiagnostics.configure(materialChurnConfigForQuery(clodRuntime.materialChurn, searchParams));
  const dom = initDomShell();
  runContentRegistryStartup(dom.info);

  const stagedImport = await loadStagedProjectImport(searchParams, {
    buildProgress: dom.buildProgress,
    buildProgressPhase: dom.buildProgressPhase,
    buildProgressPercent: dom.buildProgressPercent,
    buildProgressBar: dom.buildProgressBar,
    info: dom.info,
  });
  const queries = parseBootstrapQueryContext(searchParams, phase0ConfigText);

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
    clodRuntime,
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
  attachSaveRuntimeCounters(postRenderer.longViewHooks?.stats?.counters ?? null);

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
    worldMode: world.worldMode,
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
  const terrainTextureWindowCache = new Map<string, {
    config: typeof world.proceduralTextureConfig;
    terrain: NonNullable<typeof world.proceduralTerrain>;
    macroTint: typeof world.bakedMacroTint;
  }>();
  const biomeTextureStreaming = world.proceduralTerrain
    ? createBiomeTextureStreamingManager({
        baseConfig: world.proceduralTextureConfig,
        sampleBiome: (x, z) => world.worldSource.sampleBiome(x, z),
        deferWindowSwaps: true,
        onActiveWindowChanged: (nextConfig, activeBiomeMaterials) => {
          const signature = activeBiomeMaterials.join("|");
          let cached = terrainTextureWindowCache.get(signature);
          if (!cached) {
            const nextTerrain = createProceduralTerrainTextures(nextConfig);
            const bakeRes = Math.min(512, nextTerrain.noise.resolution);
            const nextMacroTint = createBakedMacroTintTexture(
              nextTerrain.noise.noiseA,
              nextTerrain.noise.noiseB,
              bakeRes,
            );
            cached = { config: nextConfig, terrain: nextTerrain, macroTint: nextMacroTint };
            terrainTextureWindowCache.set(signature, cached);
            while (terrainTextureWindowCache.size > MAX_TERRAIN_TEXTURE_WINDOW_CACHE) {
              const firstKey = terrainTextureWindowCache.keys().next().value as string | undefined;
              if (!firstKey) break;
              terrainTextureWindowCache.delete(firstKey);
            }
          }
          world.proceduralTextureConfig = cached.config;
          world.proceduralTerrain = cached.terrain;
          world.bakedMacroTint = cached.macroTint;
          terrainTextureWindowSwaps++;
          terrainView.materialController.setProceduralTerrain(cached.terrain, cached.config, cached.macroTint);
          terrainView.applyTerrainTextures();
          if (postRenderer.longViewHooks?.stats) {
            postRenderer.longViewHooks.stats.counters.terrainTextureWindowSwaps = terrainTextureWindowSwaps;
            postRenderer.longViewHooks.stats.counters.terrainTextureActiveBiomes = activeBiomeMaterials.length;
            postRenderer.longViewHooks.stats.counters.terrainTextureWindowCacheSize = terrainTextureWindowCache.size;
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

  // farClipmapMode=replace hands the whole far band to the GPU clipmap, which then becomes the
  // sole far-terrain owner: the player-centred InfiniteFarShell is kept out of the scene so the two
  // do not z-fight or disagree on height across the mid-far band.
  const farClipmapReplaceActive = searchParams.get("farClipmap") === "1" && farClipmapRendererAllowed(searchParams);
  const farRendererActivity = {
    legacyFarShell: world.worldMode.farOwner === "legacy_far_shell",
    infiniteFarShell: isLongViewCapableScene(queryScene) && !farClipmapReplaceActive,
    farClipmap: farClipmapReplaceActive,
  };
  assertLegacyFarShellExclusive(farRendererActivity);
  window.__drusnielFarOwnership = buildFarOwnershipSummary({
    farOwner: farClipmapReplaceActive && isLongViewCapableScene(queryScene) ? "far_clipmap" : world.worldMode.farOwner,
    streamingScene: streamingOwnership.streamingScene,
    activity: farRendererActivity,
    clodRadiusM: streamingOwnership.clodRadiusM,
    farInnerM: streamingOwnership.farShellInnerM,
    farOuterM: streamingOwnership.farShellOuterM,
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

  let infiniteFarShell: InfiniteFarShell | undefined;
  let farShellMetrics: FarShellMetrics | undefined;

  if (isLongViewCapableScene(queryScene)) {
    const lvConfig = createDefaultLongViewConfig();
    applyLongViewScenePreset(lvConfig, queryScene, naadfIntegration);
    applyOwnershipToFarShellRange(lvConfig.farShell, streamingOwnership);

    farShellMetrics = createFarShellMetrics();
    farShellMetrics.farShellEnabled = true;
    farShellMetrics.farShellInnerM = lvConfig.farShell.startMeters;
    farShellMetrics.farShellOuterM = lvConfig.farShell.endMeters;
    farShellMetrics.farShellGridRes = lvConfig.farShell.radialSegments;

    if (!useNaadfFarSummary) {
      const seaLevel = world.worldSource.metadata.seaLevel;
      const farSummaryConfig = longViewConfigToFarSummaryConfig(lvConfig);
      if (streamingOwnership.streamingScene) {
        // Streaming scenes: use the acceptance-proven 6ms/frame tile-build budget so far tiles
        // converge ~3x faster while moving; the cost is bounded and only paid while tiles are
        // dirty. farSummaryMaxBuildMsPerFrame in the URL still overrides.
        farSummaryConfig.stream.maxBuildMsPerFrame = Math.max(farSummaryConfig.stream.maxBuildMsPerFrame, 6);
      }
      farSummaryIntegration = initFarSummaryIntegration({
        terrainSampler: {
          sampleHeight: (x: number, z: number) => world.worldSource.sampleHeight(x, z),
          sampleMaterial: (x: number, z: number) => world.worldSource.sampleMaterial(x, z),
          sampleCanopyCoverage: (x, z) => naadfIntegration?.getCanopySampler().sampleCanopyCoverage(x, z) ?? 0,
          sampleWaterCoverageForHeight: (_x, _z, height) => height < seaLevel ? 1 : 0,
        },
        terrainFieldConfig: world.worldSource.metadata.terrain,
        scene: renderer.scene,
        camera: renderer.camera,
        farShellMetrics,
        config: farSummaryConfig,
      });
    }

    const heightProvider = useNaadfFarSummary && naadfIntegration
      ? naadfIntegration.getHeightProvider()
      : farSummaryIntegration?.getHeightProvider();
    if (farSummaryIntegration) {
      (window as any).__drusnielFarSummary = farSummaryIntegration;
    } else if (naadfIntegration) {
      (window as any).__drusnielFarSummary = naadfIntegration;
    }
    const farShellCpuHeightsEnabled = searchParams.get("farShellCpuHeights") !== "0";
    const lighting = terrainView.currentLighting();

    const materialConfig = loadLongViewMaterialsConfig(undefined, parseQueryOverrides(searchParams));
    const parityConfig = materialConfig.enabled ? configToUniformData(materialConfig) : undefined;
    const useParity = materialConfig.enabled && parityConfig !== undefined;
    const farSummaryGpuAtlas = naadfHeightSamplingMode === "gpu"
      ? naadfIntegration?.getFarSummaryGpuAtlasView()
      : undefined;

    if (naadfHeightSamplingMode === "gpu" && !useParity) throw new Error("NAADF GPU height mode requires the WebGPU parity far terrain material");
    if (naadfHeightSamplingMode === "gpu" && !farSummaryGpuAtlas) throw new Error("NAADF GPU height mode requires a far-summary GPU atlas");

    const effectiveHeightSamplingMode = naadfHeightSamplingMode === "gpu" ? "gpu" : naadfHeightSamplingMode;
    if (farShellCpuHeightsEnabled && !heightProvider && effectiveHeightSamplingMode !== "gpu") {
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

    if (farShellCpuHeightsEnabled) infiniteFarShell.setHeightProvider(heightProvider);
    // Keep farSummaryIntegration alive (it feeds the clipmap source via __drusnielFarSummary), but in
    // replace mode do not add the shell mesh — the far clipmap owns the far band on its own.
    if (!farClipmapReplaceActive) {
      renderer.scene.add(infiniteFarShell.mesh);
    } else {
      infiniteFarShell.mesh.visible = false;
    }
    terrainView.farShellController.setEnabled(false);

    terrainView.shadowProxyController?.setOnSunShadowsChanged((enabled) => {
      infiniteFarShell?.setReceiveSunShadows(enabled);
    });
    if (terrainView.shadowProxyDebugState?.sunShadowsEnabled) infiniteFarShell.setReceiveSunShadows(true);

    if (queryScene === "infinite-stream-slow-builds" && farSummaryIntegration) {
      farSummaryIntegration.setForceSlowBuilds(true);
      farSummaryIntegration.setBuildDelayMs(100);
    }
  }

  clearSaveInvalidationTargets();
  if (farSummaryIntegration) {
    registerSaveInvalidationTarget({
      markSaveInvalidationBounds: (bounds) => {
        farSummaryIntegration!.cache.markStale(bounds);
        infiniteFarShell?.requestHeightRefresh();
      },
    });
  }
  if (hasActiveSaveRuntime()) markSaveRuntimeLoadedRegionsInvalidated();

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
    renderResolution: renderer.renderResolution,
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
      ? (() => {
          let shellRefreshCommitRev = 0;
          let framesSinceShellRefresh = 0;
          const SHELL_REFRESH_INTERVAL_FRAMES = 120;
          return (frameIndex: number, deltaSeconds: number, camera: THREE.PerspectiveCamera, worldCenter: THREE.Vector3) => {
            const originStats = floatingOrigin.stats();
            if (postRenderer.longViewHooks?.stats) {
              postRenderer.longViewHooks.stats.counters.floatingOriginEnabled = originStats.enabled ? 1 : 0;
              postRenderer.longViewHooks.stats.counters.floatingOriginRebaseCount = originStats.rebaseCount;
              postRenderer.longViewHooks.stats.counters.floatingOriginLastRebaseFrame = originStats.lastRebaseFrame;
              postRenderer.longViewHooks.stats.counters.floatingOriginOffsetX = originStats.originX;
              postRenderer.longViewHooks.stats.counters.floatingOriginOffsetZ = originStats.originZ;
            }
            infiniteFarShell?.setRenderOriginOffset(originStats.originX, originStats.originZ);
            if (farSummaryIntegration) timeFarSummarySubphase("farSumTilesMs", () => farSummaryIntegration!.update(frameIndex, deltaSeconds, camera, worldCenter));
            if (naadfIntegration) timeFarSummarySubphase("farSumNaadfMs", () => naadfIntegration.update(frameIndex, deltaSeconds, camera));
            if (farSummaryIntegration && infiniteFarShell) {
              framesSinceShellRefresh++;
              if (framesSinceShellRefresh >= SHELL_REFRESH_INTERVAL_FRAMES && farSummaryIntegration.cache.hasNewCommitsSince(shellRefreshCommitRev)) {
                shellRefreshCommitRev = farSummaryIntegration.cache.commitRevisionAt();
                framesSinceShellRefresh = 0;
                infiniteFarShell.requestHeightRefresh();
              }
            }
            // Anchor streaming systems to the canonical world center (player / orbit target) so
            // terrain, far shell, shadows, and texture windows stay concentric with the near bubble.
            if (infiniteFarShell) timeFarSummarySubphase("farSumShellMs", () => infiniteFarShell.update(worldCenter.x, worldCenter.z, frameIndex));
            if (terrainView.shadowProxyController) timeFarSummarySubphase("farSumShadowProxyMs", () => terrainView.shadowProxyController!.updateFrame(worldCenter.x, worldCenter.z));
            if (postRenderer.state.terrainMaterialSource === "procedural" && biomeTextureStreaming) {
              timeFarSummarySubphase("farSumBiomeStreamMs", () => biomeTextureStreaming.update({ x: worldCenter.x, z: worldCenter.z, frameIndex }));
            }
          };
        })()
      : undefined,
    naadfIntegration,
    getClodErrorCompute: postRenderer.getClodErrorCompute,
    ensureClodErrorCompute: postRenderer.ensureClodErrorCompute,
    textureLoadOptions: postRenderer.textureLoadOptions,
    treeConfig: world.treeConfig,
    understoryConfig: world.understoryConfig,
  });
}

declare global {
  interface Window {
    __drusnielFarOwnership?: ReturnType<typeof buildFarOwnershipSummary>;
  }
}
