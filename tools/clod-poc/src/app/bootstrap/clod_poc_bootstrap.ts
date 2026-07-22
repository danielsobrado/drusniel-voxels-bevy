import phase0ConfigText from "../../../config/infinite_streaming_phase0.yaml?raw";
import vegetationLodYaml from "../../../config/vegetation_lod.yaml?raw";
import canopyShellYaml from "../../../config/canopy_shell.yaml?raw";
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
import {
  parseVegetationLodConfig,
  validateVegetationLodContract,
} from "../../vegetation/vegetation_lod_config.js";
import { applyVegetationLodToTrees } from "../../vegetation/apply_vegetation_lod.js";
import {
  applyCanopyShellQueryOverrides,
  parseCanopyShellConfig,
} from "../../canopy/canopy_config.js";
import { timeFarSummarySubphase } from "../frame_loop/far_summary_subphase_timing.js";
import { clearSaveInvalidationTargets, registerSaveInvalidationTarget } from "../../save/save_far_summary_bridge.js";
import { attachSaveRuntimeCounters, hasActiveSaveRuntime, markSaveRuntimeLoadedRegionsInvalidated } from "../../save/save_runtime.js";
import { FloatingOriginController } from "../../precision/floating_origin.js";
import * as THREE from "three";
import { booleanQueryParam, positiveNumberQueryParam } from "./bootstrap_query_params.js";
import {
  materialChurnConfigForQuery,
  materialChurnDiagnostics,
} from "../../rendering/material_churn/material_churn_diagnostics.js";
import { findValidatedContinentRiverCrossingRoute } from "../../water/continent_river_route.js";
import { applyContinentDefaults } from "./continent_defaults.js";
import { getRendererGpuDevice } from "../../rendering/webgpu_device_bridge.js";
import { runBootstrapBiomeTextureStartup } from "./bootstrap_biome_texture_startup.js";
import { runBootstrapFarOwnershipStartup } from "./bootstrap_far_ownership_startup.js";
import { runBootstrapFarSummaryStartup } from "./bootstrap_far_summary_startup.js";
import { runBootstrapFarShellStartup } from "./bootstrap_far_shell_startup.js";

export async function bootstrapClodPoc() {
  const searchParams = new URLSearchParams(location.search);
  if (await runEarlyRoutes(searchParams)) return;
  if (applyContinentDefaults(searchParams)) {
    const url = new URL(location.href);
    url.search = searchParams.toString();
    history.replaceState(history.state, "", url);
  }

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
    allowBoundedWorld: booleanQueryParam(searchParams, "floatingOrigin") || booleanQueryParam(searchParams, "floating_origin"),
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
  if (postRenderer.longViewHooks) {
    const rendererDevice = getRendererGpuDevice(renderer.app);
    postRenderer.longViewHooks.destroyRendererDevice = rendererDevice ? () => rendererDevice.destroy() : null;
    postRenderer.longViewHooks.findContinentRiverCrossingRoute = world.hydrologySystem
      ? (options) => findValidatedContinentRiverCrossingRoute(
          (x, z) => world.hydrologySystem!.sample(x, z, 64),
          (x, z) => world.hydrologySystem!.sample(x, z),
          options,
        )
      : null;
  }
  attachSaveRuntimeCounters(postRenderer.longViewHooks?.stats?.counters ?? null);

  const vegetationLodConfig = parseVegetationLodConfig(vegetationLodYaml);
  const initialCanopyConfig = applyCanopyShellQueryOverrides(
    parseCanopyShellConfig(canopyShellYaml),
    searchParams,
  );
  const runtimeTreeConfig = applyVegetationLodToTrees(
    world.treeConfig,
    vegetationLodConfig,
  );
  validateVegetationLodContract(
    vegetationLodConfig,
    runtimeTreeConfig,
    initialCanopyConfig,
  );

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
    terrainFieldConfig: world.worldSource.metadata.terrain,
    treeConfig: runtimeTreeConfig,
    canopyConfig: initialCanopyConfig,
    vegetationLodConfig,
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

  const { biomeTextureStreaming } = runBootstrapBiomeTextureStartup({
    world,
    terrainMaterialSource: postRenderer.state.terrainMaterialSource,
    floatingOrigin,
    camera: renderer.camera,
    materialController: terrainView.materialController,
    applyTerrainTextures: terrainView.applyTerrainTextures,
    longViewHooks: postRenderer.longViewHooks,
  });

  const queryScene = queries.queryScene;
  const { streamingOwnership, farClipmapReplaceActive } = runBootstrapFarOwnershipStartup({
    searchParams,
    queryScene,
    phase0Streaming: queries.phase0Streaming,
    phase0TargetVisibleM: queries.phase0TargetVisibleM,
    phase0Config: queries.phase0Config,
    pageSizeM: world.cfg.page.chunks_per_page * world.cfg.page.chunk_size,
    farOwner: world.worldMode.farOwner,
  });

  const {
    naadfIntegration,
    farSummaryIntegration,
    useNaadfFarSummary,
    naadfHeightSamplingMode,
    lvConfig,
    farShellMetrics,
  } = runBootstrapFarSummaryStartup({
    searchParams,
    queryScene,
    queryNaadfScene: queries.queryNaadfScene,
    streamingOwnership,
    scene: renderer.scene,
    camera: renderer.camera,
    rendererWebGpuDevice: renderer.rendererWebGpuDevice,
    worldSource: world.worldSource,
    hydrologySystem: world.hydrologySystem,
    farCarveImprint: world.farCarveImprint,
    getCanopyConfig: terrainView.getCanopyConfig,
  });

  const { infiniteFarShell } = runBootstrapFarShellStartup({
    searchParams,
    queryScene,
    farClipmapReplaceActive,
    lvConfig,
    farShellMetrics,
    useNaadfFarSummary,
    naadfHeightSamplingMode,
    naadfIntegration,
    farSummaryIntegration,
    scene: renderer.scene,
    worldSource: world.worldSource,
    farCarveImprint: world.farCarveImprint,
    currentLighting: terrainView.currentLighting,
    farShellController: terrainView.farShellController,
    shadowProxyController: terrainView.shadowProxyController,
    shadowProxyDebugState: terrainView.shadowProxyDebugState,
  });

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
    worldSeed: world.worldManifest.seed,
    unboundedWorld: world.worldSource.metadata.bounds === "infinite",
    grassConfig: world.grassConfig,
    stoneConfig: world.stoneConfig,
    treeConfig: runtimeTreeConfig,
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
    terrainColliders: renderer.terrainColliders,
    getInteractionMode: () => renderer.interaction.mode,
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
          return (camera: THREE.PerspectiveCamera, cursor: import("../../stream/stream_cursor.js").StreamCursor) => {
            const frameIndex = cursor.frameId;
            const deltaSeconds = cursor.deltaSeconds;
            const worldCenter = cursor.center;
            const originStats = floatingOrigin.stats();
            if (postRenderer.longViewHooks?.stats) {
              postRenderer.longViewHooks.stats.counters.floatingOriginEnabled = originStats.enabled ? 1 : 0;
              postRenderer.longViewHooks.stats.counters.floatingOriginRebaseCount = originStats.rebaseCount;
              postRenderer.longViewHooks.stats.counters.floatingOriginLastRebaseFrame = originStats.lastRebaseFrame;
              postRenderer.longViewHooks.stats.counters.floatingOriginOffsetX = originStats.originX;
              postRenderer.longViewHooks.stats.counters.floatingOriginOffsetZ = originStats.originZ;
            }
            infiniteFarShell?.setRenderOriginOffset(originStats.originX, originStats.originZ);
            if (farSummaryIntegration) timeFarSummarySubphase("farSumTilesMs", () => farSummaryIntegration!.update(frameIndex, camera, cursor));
            if (naadfIntegration) timeFarSummarySubphase("farSumNaadfMs", () => naadfIntegration.update(frameIndex, deltaSeconds, camera));
            // In far-clipmap replace mode the shell mesh is hidden and out of the scene —
            // the clipmap owns the far band — so the shell's sliced CPU height rebuild
            // would resample every vertex of a mesh nothing renders. Skip refreshes and
            // updates while hidden; the stale commit revision makes the first visible
            // frame trigger a refresh if a debug toggle ever re-shows the shell.
            const farShellRendered = infiniteFarShell !== undefined && infiniteFarShell.mesh.visible;
            if (farSummaryIntegration && infiniteFarShell && farShellRendered) {
              framesSinceShellRefresh++;
              if (framesSinceShellRefresh >= SHELL_REFRESH_INTERVAL_FRAMES && farSummaryIntegration.cache.hasNewCommitsSince(shellRefreshCommitRev)) {
                shellRefreshCommitRev = farSummaryIntegration.cache.commitRevisionAt();
                framesSinceShellRefresh = 0;
                infiniteFarShell.requestHeightRefresh();
              }
            }
            // Anchor streaming systems to the canonical world center (player / orbit target) so
            // terrain, far shell, shadows, and texture windows stay concentric with the near bubble.
            if (infiniteFarShell && farShellRendered) timeFarSummarySubphase("farSumShellMs", () => infiniteFarShell.update(worldCenter.x, worldCenter.z, frameIndex));
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
    treeConfig: runtimeTreeConfig,
    understoryConfig: world.understoryConfig,
  });
}
