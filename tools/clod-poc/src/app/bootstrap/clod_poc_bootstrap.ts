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
import { initNaadfIntegration, type NaadfIntegration } from "../../naadf/integration.js";
import { InfiniteFarShell, createFarShellMetrics, createDefaultLongViewConfig, longViewConfigToFarSummaryConfig } from "../../long-view/index.js";
import type { FarShellMetrics } from "../../long-view/index.js";
import { loadLongViewMaterialsConfig, parseQueryOverrides } from "../../config/longViewMaterialsConfig.js";
import { configToUniformData } from "../../farTerrain/farTerrainUniforms.js";
import { applyOwnershipToFarShellRange, resolveStreamingOwnership } from "../../streaming/streaming_ownership.js";
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