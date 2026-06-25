import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createClodPocGui, createClodPocTerrainMaterialGui } from "../../ui/gui/gui_root.js";
import { parseConfig } from "../../config.js";
import { initHooks, type ClodHooks } from "../../core/hooks.js";
import { failLoud, installGlobalErrorHooks } from "../../core/diagnostics.js";
import { buildTerrainSummary, createHeightTexture } from "../../clod/terrain_summary.js";
import { buildFarTerrainShadowProxy } from "../../gpu/far_terrain_shadow_proxy.js";
import { bakeMacroTint } from "../../gpu/terrain_node_material.js";
import phase0ConfigText from "../../../config/infinite_streaming_phase0.yaml?raw";
import configText from "../../../config/clod_pages.yaml?raw";
import stoneConfigText from "../../../config/stones.yaml?raw";
import treeConfigText from "../../../config/trees.yaml?raw";
import understoryConfigText from "../../../config/understory.yaml?raw";
import proceduralConfigText from "../../../config/procedural_textures.yaml?raw";
import grassConfigText from "../../../config/grass.yaml?raw";
import waterConfigText from "../../../config/water.yaml?raw";
import forestLightingConfigText from "../../../config/forest_lighting.yaml?raw";
import { ClodWorkerClient } from "../../clod_worker_client.js";
import { emitAudio } from "../../audio/index.js";
import {
  baseSurfaceHeight,
  digEditCount,
  getDigEditsSnapshot,
  meshChunk,
  replaceDigEdits,
  setTerrainSurfaceOverride,
  surfaceNormal,
  surfaceHeight,
} from "../../terrain.js";
import { GpuChunkMesher } from "../../gpu/gpu_chunk_mesher.js";
import { resolveDigEdits } from "../../gpu/terrain_field_core.js";
import { compareChunkSurfaces } from "../../gpu/gpu_mesh_parity.js";
import { loadContentRegistry, validateContentRegistry } from "../../content/index.js";
import { ClodPageNode } from "../../types.js";
import {
  type TerrainColorAdjustments,
} from "../../material.js";
import {
  type TerrainMaterialHandle,
} from "../../rendering/terrain_material.js";
import {
  createWebGlAppRenderer,
  createWebGpuAppRenderer,
  parseRendererBackend,
} from "../../rendering/renderer_backend.js";
import { getRendererGpuDevice } from "../../rendering/webgpu_device_bridge.js";
import {
  parseGrassConfig,
  type GrassLighting,
  type GrassSettings,
  type GrassStats,
} from "../../grass.js";
import { parseStoneConfig } from "../../stones/stone_config.js";
import { type StoneStats } from "../../stones/stone_instances.js";
import { formatTreeInfoLine, formatTreeTotalDisplay, parseTreeConfig, type TreeStats } from "../../trees/index.js";
import {
  formatUnderstoryInfoLine,
  parseUnderstoryConfig,
  type UnderstoryStats,
} from "../../understory/index.js";
import {
  createForestLightingIntegrationWarner,
  formatForestLightingInfoLine,
  parseForestLightingConfig,
  type ForestLightingStats,
} from "../../forest_lighting/index.js";
import {
  PlayerController,
  PlayerInteractionState,
} from "../../player_controller.js";
import { ClodErrorPxCompute } from "../../gpu/clod_error_px_compute.js";
import { requestWebGpuDevice } from "../../gpu/webgpu_device.js";
import { TerrainColliderSet, type TerrainColliderPage } from "../../terrain_collider.js";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  SkyEnvironment,
  type EnvironmentLighting,
  type EnvironmentSettings,
} from "../../environment.js";
import {
  PostProcessPipeline,
  type PostProcessSettings,
} from "../../postprocess.js";
import {
  buildGrassInstancedGeometry,
  createGrassNodeMaterial,
} from "../../gpu/grass_node_material.js";
import {
  parseWaterConfig,
  resolveWaterConfig,
  HydrologySystem,
  makeFakeBodyCarvedSampler,
} from "../../water/index.js";
import { WebGpuPostProcessPipeline } from "../../gpu/webgpu_postprocess.js";
import {
  consumeStagedProjectImport,
  type ProjectArchiveContents,
} from "../../project_archive.js";
import { createProjectArchiveController } from "../../project/project_archive_controller.js";
import { createTerraformMenu } from "../../ui/terraform_menu.js";
import type { AppPostProcess } from "../../app/app_post_process.js";
import type { AppSky } from "../../scene/app_sky.js";
import { WebGpuSkyEnvironment } from "../../scene/webgpu_sky_environment.js";
import { bindClodFrameLoop, submitMsChanged } from "../../app/clod_frame_loop.js";
import { updateClodOverlay, type ClodOverlaySnapshot } from "../../ui/overlay_panel.js";
import { aggregateDiagonalPolishStats, formatDiagonalPolishStats } from "../../diagonalPolish.js";
import { LockedBorderOverlay } from "../../ui/locked_border_overlay.js";
import { NodeLabelOverlay } from "../../ui/node_labels.js";
import { parseProceduralTextureConfig } from "../../textures/materialRecipes.js";
import {
  createProceduralTerrainTextures,
} from "../../textures/terrainTextureArrays.js";
import { LOD_COLORS } from "../../app/clod_constants.js";
import { parseClodRuntimeConfig, resolveSlowFrameMsThreshold } from "../../app/runtime_config.js";
import { computeGeometryNormals, toGeometry } from "../../terrain_runtime/page_geometry.js";
import { createNearFieldBubbleController } from "../../terrain_runtime/near_field_bubble_controller.js";
import { createClodSelectionController } from "../../terrain_runtime/clod_selection_controller.js";
import { packHydrologyData } from "../../systems/hydrology_packing.js";
import { type TerrainTextureLoadOptions } from "../../terrain_runtime/texture_loader.js";
import { createTerrainTextureController } from "../../terrain_runtime/terrain_texture_controller.js";
import { createTerrainMaterialController } from "../../terrain_runtime/terrain_material_controller.js";
import { createTerrainTextureModal } from "../../terrain_runtime/terrain_texture_modal.js";
import { createFarShellController } from "../../systems/far_shell_controller.js";
import { createGrassController } from "../../systems/grass_controller.js";
import { createStoneController } from "../../systems/stone_controller.js";
import { createTreeController } from "../../systems/tree_controller.js";
import { createUnderstoryController } from "../../systems/understory_controller.js";
import { createForestLightingController } from "../../systems/forest_lighting_controller.js";
import { createWaterController } from "../../systems/water_controller.js";
import { createWeatherController } from "../../systems/weather_controller.js";
import { drainVegetationDirty, type VegetationDirtyQueue } from "../../systems/vegetation_dirty.js";
import { createTerrainRaycastService } from "../../player/terrain_raycast_service.js";
import { createBrushPreviewController } from "../../player/brush_preview_controller.js";
import { createPlayerModeController } from "../../player/player_mode_controller.js";
import { createPlayerInputController } from "../../player/player_input_controller.js";
import { createTerrainEditService } from "../../terrain_runtime/terrain_edit_service.js";
import { runEarlyRoutes } from "./early_routes.js";
import { initDomShell } from "./dom_shell.js";
import {
  parseClodRuntimeQueryFlags,
  parsePhase0SceneContext,
  parseSceneQueryFlags,
  parseWeatherQueryContext,
} from "./query_context.js";
import { createClodAppState } from "../clod_app_state.js";
import { createClodRuntimeBindings } from "../clod_runtime_bindings.js";
import { bindUiAudioShell } from "../ui_audio_shell.js";


function recomputedNormalsFor(view: NodeView): Float32Array {
  if (!view.recomputedNormals) view.recomputedNormals = computeGeometryNormals(view.node.mesh);
  return view.recomputedNormals;
}

interface NodeView {
  node: ClodPageNode;
  mesh: THREE.Mesh;
  mat: TerrainMaterialHandle;
  sourceNormals: Float32Array;
  recomputedNormals: Float32Array | null;
  selected: boolean;
  fade: number;
  target: number;
}

export async function bootstrapClodPoc() {
  const searchParams = new URLSearchParams(location.search);
  if (await runEarlyRoutes(searchParams)) return;

  installGlobalErrorHooks();
  const clodRuntime = parseClodRuntimeConfig();

  const dom = initDomShell();
  const {
    info,
    importButton,
    exportButton,
    projectImportInput,
    orbitModeButton,
    playerModeButton,
    playerModeStatus,
    buildProgress,
    buildProgressBar,
    buildProgressPhase,
    buildProgressPercent,
  } = dom;

  // Load and validate Content Registry
  try {
    const searchParamsTemp = new URLSearchParams(location.search);
    const strictContent = searchParamsTemp.get("strict-content") === "true";
    const registry = loadContentRegistry({ strict: strictContent });
    const report = validateContentRegistry(registry, { strict: strictContent });

    console.log("[ContentRegistry] Load and Validation Summary:");
    console.log(`- Materials: ${registry.materials.size}`);
    console.log(`- Texture Slots: ${registry.textureSlots.size}`);
    console.log(`- Biomes: ${registry.biomes.size}`);
    console.log(`- Debug Presets: ${registry.clodDebugPresets.size}`);
    console.log(`- Snap Pieces: ${registry.snapPieces.size}`);

    if (report.ok) {
      console.log("[ContentRegistry] Validation Status: OK");
    } else {
      console.error(`[ContentRegistry] Validation Status: FAILED (${report.errors.length} errors, ${report.warnings.length} warnings)`);
      for (const err of report.errors) {
        console.error(`  [ERROR] [${err.code}] at ${err.path}: ${err.message}`);
      }
      if (strictContent) {
        throw new Error(`Content validation failed in strict mode: ${report.errors[0].message}`);
      }
      info.textContent = `Content Registry validation errors present (see dev console)`;
    }

    if (report.warnings.length > 0) {
      console.warn(`[ContentRegistry] Validation Warnings (${report.warnings.length}):`);
      for (const warn of report.warnings) {
        console.warn(`  [WARNING] [${warn.code}] at ${warn.path}: ${warn.message}`);
      }
    }
  } catch (err) {
    console.error("[ContentRegistry] Failed to initialize content registry:", err);
    info.textContent = `Content Registry load failed: ${err instanceof Error ? err.message : String(err)}`;
    const searchParamsTemp = new URLSearchParams(location.search);
    const strictContent = searchParamsTemp.get("strict-content") === "true";
    if (strictContent) {
      throw err;
    }
  }

  const {
    queryScene,
    queryGrassPerfScene,
    queryTreePerfScene,
    queryTreeGpuRing,
    queryForestFloorScene,
    queryLongViewScene,
  } = parseSceneQueryFlags(searchParams);
  const {
    phase0Config,
    activePhase0Scene,
    phase0TargetVisibleM,
    phase0Streaming,
    phase0VelocityX,
    phase0VelocityZ,
  } = parsePhase0SceneContext(queryScene, phase0ConfigText);
  const {
    queryFarShell,
    queryCanopy,
    queryPerfMode,
    queryWebGpuSelection,
    queryReadbackMode,
    queryMaterialTiers,
    queryWebGpuParity,
    queryTerrainMaterialSource,
    queryGrassRingGrid,
    queryGrassRingCell,
    textureMipmapsEnabled,
  } = parseClodRuntimeQueryFlags(searchParams);
  const importToken = searchParams.get("import");
  let stagedImport: ProjectArchiveContents | null = null;
  if (importToken) {
    buildProgress.hidden = false;
    buildProgressPhase.textContent = "loading imported project";
    buildProgressPercent.textContent = "0%";
    buildProgressBar.value = 0;
    try {
      stagedImport = await consumeStagedProjectImport(importToken);
      if (!stagedImport) throw new Error("The staged project was not found or was already used");
      emitAudio("project.import.success");
    } catch (error) {
      emitAudio("project.import.error");
      info.textContent = `Project import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      searchParams.delete("import");
      const query = searchParams.toString();
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    }
  }
  const cfg = stagedImport?.manifest.config ?? parseConfig(configText);
  const stoneConfig = parseStoneConfig(stoneConfigText);
  const treeConfig = parseTreeConfig(treeConfigText);
  const understoryConfig = parseUnderstoryConfig(understoryConfigText);
  const forestLightingConfig = parseForestLightingConfig(forestLightingConfigText);
  createForestLightingIntegrationWarner()(forestLightingConfig);
  const grassConfig = parseGrassConfig(grassConfigText);
  let waterConfig = parseWaterConfig(waterConfigText);
  const proceduralTextureConfig = parseProceduralTextureConfig(proceduralConfigText);
  const proceduralTerrain = proceduralTextureConfig.enabled
    ? createProceduralTerrainTextures(proceduralTextureConfig)
    : null;
  const clodWorker = new ClodWorkerClient();
  clodWorker.onError = (error) => {
    emitAudio("clod.rebuild.error");
    console.error("[clod worker]", error);
  };

  // World size via ?world=. 8x8 gives full LOD0..LOD3 depth for A3 / delta-2-3
  // inspection; 16/32 keep the same max LOD with more roots and can freeze the tab longer.
  const requested = Number(searchParams.get("world"));
  const WORLD = stagedImport?.manifest.worldSize ?? (clodRuntime.runtime.worldOptions.includes(requested) ? requested : queryGrassPerfScene || queryTreePerfScene || queryForestFloorScene || queryLongViewScene ? 16 : 4);
  const worldCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
  // LV-6: Bake the proceduralMacroTint result into a texture for far-tier sampling.
  let bakedMacroTint: THREE.DataTexture | null = null;
  if (proceduralTerrain) {
    const bakeRes = Math.min(512, proceduralTerrain.noise.resolution);
    bakedMacroTint = bakeMacroTint(
      proceduralTerrain.noise.noiseA,
      proceduralTerrain.noise.noiseB,
      bakeRes,
      worldCells,
    );
  }
  waterConfig = resolveWaterConfig(waterConfig, worldCells);
  let buildStatus = "preparing";
  const updateBuildOverlay = () => updateClodOverlay({
    worldSize: WORLD,
    renderedTriangles: 0,
    nodesByLod: {},
    forcedSplits: 0,
    bubbleForcedSplits: 0,
    cutFrozen: false,
    errorThreshold: cfg.selection.error_threshold_px,
    buildStatus,
  });
  updateBuildOverlay();
  if (stagedImport) replaceDigEdits(stagedImport.manifest.terrainEdits);
  const preHydrologyTerrain = makeFakeBodyCarvedSampler(waterConfig, { surfaceHeight: baseSurfaceHeight });
  const hydrologySystem = waterConfig.enabled && waterConfig.source === "hydrology" && waterConfig.hydrology.enabled
    ? HydrologySystem.build(waterConfig.hydrology, worldCells, preHydrologyTerrain)
    : null;
  if (hydrologySystem) {
    setTerrainSurfaceOverride((x, z) => hydrologySystem.terrainHeight(x, z));
    console.log("[water] hydrology built", hydrologySystem.stats);
  } else if (waterConfig.enabled && waterConfig.fakeBodies.carveTerrain) {
    setTerrainSurfaceOverride((x, z) => preHydrologyTerrain.surfaceHeight(x, z));
  } else {
    setTerrainSurfaceOverride(null);
  }
  const hydrologyTerrain = hydrologySystem
    ? {
        res: hydrologySystem.grid.res,
        worldCells: hydrologySystem.grid.worldCells,
        carvedBed: hydrologySystem.grid.carvedBed,
      }
    : null;
  const buildNote =
    WORLD >= 16 ? " (worker build; large world may take a while)" :
    WORLD >= 8 ? " (worker build)" :
    "";
  info.textContent = `building ${WORLD}x${WORLD} world…${buildNote}`;
  buildProgress.hidden = false;
  buildProgressPhase.textContent = `${stagedImport ? "import: " : ""}building ${WORLD}x${WORLD}`;
  buildProgressPercent.textContent = "0%";
  buildProgressBar.value = 0;
  buildStatus = `${stagedImport ? "import: " : ""}building ${WORLD}x${WORLD}`;
  updateBuildOverlay();
  await new Promise((r) => setTimeout(r, 16));
  const result = await clodWorker.buildWorld(WORLD, WORLD, cfg, getDigEditsSnapshot(), ({ done, total, level, phase }) => {
    const fraction = total > 0 ? Math.min(1, done / total) : 0;
    buildProgressBar.value = fraction;
    buildProgressPercent.textContent = `${Math.floor(fraction * 100)}%`;
    buildProgressPhase.textContent = `${phase}  L${level}  ${done}/${total}`;
    info.textContent = `building ${WORLD}x${WORLD} world… ${Math.floor(fraction * 100)}%\n${phase}  L${level}  ${done}/${total}`;
    buildStatus = `${phase} L${level} ${done}/${total}`;
    updateBuildOverlay();
  }, hydrologyTerrain);
  buildProgress.hidden = true;
  buildStatus = "ready";
  const polishLine = formatDiagonalPolishStats(aggregateDiagonalPolishStats(result.stats.map((s) => s.polish)));
  const allNodes: ClodPageNode[] = [...result.nodesByLevel.values()].flat();
  const maxTerrainLevel = Math.max(...result.nodesByLevel.keys());

  // LV-1b: Build the shared coarse terrain summary field (height + normal + coverage).
  // Used by LV-2 (far shell), LV-3 (shadow proxy), LV-4 (canopy shell).
  const worldSizeCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
  const terrainSummary = buildTerrainSummary(allNodes, worldSizeCells, 8);
  // Expose to LV-2/3/4 stages via window (matches the hooks pattern).
  (window as unknown as Record<string, unknown>).__drusnielTerrainSummary = terrainSummary;

  // LV-0: Long-view hooks + stats — only when launched as a long-view QA scene.
  let longViewHooks: ClodHooks | null = null;
  const isLongView = queryLongViewScene;
  const longViewSettleWaiters: { frames: number; resolve: () => void }[] = [];
  if (isLongView) {
    longViewHooks = initHooks();
    longViewHooks.progress = 0.5;
    longViewHooks.progressMsg = "building world";
    longViewHooks.settle = (frames = 8) => new Promise((resolve) => longViewSettleWaiters.push({ frames, resolve }));
    longViewHooks.flyCamEnabled = (_on) => { /* orbit-only in main app */ };
  }

  const staleEditedAncestorIds = new Set<string>();
  const vegetationDirtyQueue: VegetationDirtyQueue = { nodeIds: [], grass: false, trees: false, understory: false };
  const nodeGridCoord = (node: ClodPageNode): [number, number] | null => {
    const coord = node.id.slice(node.id.indexOf(":") + 1).split(",");
    if (coord.length !== 2) return null;
    const x = Number(coord[0]);
    const z = Number(coord[1]);
    return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null;
  };
  const markEditedAncestorsStale = (lod0Nodes: readonly ClodPageNode[]): void => {
    for (const node of lod0Nodes) {
      if (node.level !== 0) continue;
      const coord = nodeGridCoord(node);
      if (!coord) continue;
      const [x, z] = coord;
      for (let level = 1; level <= maxTerrainLevel; level++) {
        staleEditedAncestorIds.add(`L${level}:${x >> level},${z >> level}`);
      }
    }
  };
  let clodErrorCompute: ClodErrorPxCompute | null = null;
  let webGpuUnavailableReason: string | null = null;
  let webGpuInitPromise: Promise<void> | null = null;
  let standaloneComputeDevice: GPUDevice | null = null;

  const rendererBackend = parseRendererBackend(searchParams);
  let app: Awaited<ReturnType<typeof createWebGpuAppRenderer>> | ReturnType<typeof createWebGlAppRenderer>;
  try {
    app = rendererBackend === "webgpu" ? await createWebGpuAppRenderer() : createWebGlAppRenderer();
  } catch (error) {
    const details = [
      error instanceof Error ? error.message : String(error),
      "",
      "Recovery:",
      "- Hard-reload after closing other tabs that used this WebGPU app.",
      "- If Chrome keeps reporting DXGI_ERROR_DEVICE_HUNG, restart the browser.",
      "- Use ?renderer=webgl to open the app without WebGPU.",
    ];
    failLoud("Renderer initialization failed", details);
    return;
  }
  const renderer = app.renderer;
  const maxAnisotropy = app.maxAnisotropy;
  const isWebGpu = app.isWebGpu;
  const rendererWebGpuDevice = getRendererGpuDevice(app);

  // LV-0: Attach stats to long-view hooks after renderer is available.
  if (longViewHooks) {
    const lvStats: import("../../core/hooks.js").EngineStats = {
      fps: 0, frameMs: 0, frameMsP95: 0, drawCalls: 0, triangles: 0,
      frame: 0, counters: {}, gpuPasses: {},
    };
    longViewHooks.stats = lvStats;
    // Seed placeholder counters for layers not yet built (LV-1..6 fill them).
    const maxLvl = maxTerrainLevel;
    for (let lvl = 0; lvl <= maxLvl; lvl++) {
      lvStats.counters[`built_page_count_lod${lvl}`] = 0;
    }
    lvStats.counters["far_shell_tris"] = 0; // updated after shell build
    lvStats.counters["far_shell_gpu_ms"] = 0;
    lvStats.counters["shadow_proxy_tris"] = 0;
    lvStats.counters["canopy_tris"] = 0;
    lvStats.counters["horizon_hole_ratio"] = -1; // -1 = no real detector implemented yet
    lvStats.counters["gpu_grass_visible"] = 0;
    lvStats.counters["gpu_grass_dispatch_ms"] = 0;
    lvStats.counters["gpu_tree_visible"] = 0;
    lvStats.counters["gpu_tree_dispatch_ms"] = 0;
    lvStats.counters["gpu_stone_visible"] = 0;
    lvStats.counters["gpu_stone_drawn_near"] = 0;
    lvStats.counters["gpu_stone_drawn_far"] = 0;

    // Phase 0: Additional counters for infinite streaming baseline.
    lvStats.counters["world_cells"] = worldCells;
    lvStats.counters["target_visible_m"] = phase0TargetVisibleM;
    lvStats.counters["effective_far_radius_m"] = 0; // updated after shell build
    lvStats.counters["effective_visible_m"] = 0; // updated after shell build
    lvStats.counters["visible_target_met"] = 0;
    lvStats.counters["far_shell_enabled"] = 0;
    lvStats.counters["far_shell_radius_m"] = 0;
    lvStats.counters["far_shell_grid_res"] = 0;
    lvStats.counters["shadow_proxy_enabled"] = 0;
    lvStats.counters["shadow_proxy_inert"] = 1;
    lvStats.counters["canopy_enabled"] = 0;
    for (let lvl = 0; lvl <= maxLvl; lvl++) {
      lvStats.counters[`rendered_page_count_lod${lvl}`] = 0;
    }
    lvStats.counters["rendered_terrain_tris"] = 0;
    lvStats.counters["total_scene_tris"] = 0;
    lvStats.counters["frame_ms_avg"] = 0;
    lvStats.counters["frame_ms_p95"] = -1;
    lvStats.counters["frame_ms_p99"] = -1;
    lvStats.counters["streamer_simulated_required_chunks"] = 0;
    lvStats.counters["streamer_simulated_required_pages"] = 0;
    lvStats.counters["streamer_simulated_missing_chunks"] = 0;
    lvStats.counters["streamer_simulated_missing_pages"] = 0;
    lvStats.counters["horizon_hole_ratio"] = -1;
    lvStats.counters["stale_fallback_count"] = 0;
  }
  const ensureClodErrorCompute = (): Promise<void> => {
    if (clodErrorCompute || webGpuUnavailableReason) return Promise.resolve();
    if (!webGpuInitPromise) {
      webGpuInitPromise = (async () => {
        let device: GPUDevice | undefined;
        if (app.isWebGpu) {
          if (!rendererWebGpuDevice) {
            webGpuUnavailableReason = "WebGPU renderer did not expose a GPUDevice";
            return;
          }
          device = rendererWebGpuDevice;
        } else {
          if (!standaloneComputeDevice) {
            const deviceResult = await requestWebGpuDevice();
            if (!deviceResult.ok) {
              webGpuUnavailableReason = deviceResult.message;
              return;
            }
            standaloneComputeDevice = deviceResult.device;
          }
          device = standaloneComputeDevice;
        }
        const { compute, unavailable } = await ClodErrorPxCompute.create(allNodes, device);
        clodErrorCompute = compute;
        webGpuUnavailableReason = unavailable?.message ?? null;
      })()
        .catch((error) => {
          webGpuUnavailableReason = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          webGpuInitPromise = null;
        });
    }
    return webGpuInitPromise;
  };
  if (queryWebGpuSelection) {
    info.textContent = "initializing WebGPU CLOD compute…";
    await ensureClodErrorCompute();
  }
  // Backend-agnostic terrain material: NodeMaterial under WebGPU, ShaderMaterial under WebGL.
  //
  // Under WebGPU with atomic page swaps (transition_mode "instant"), every terrain mesh can
  // share ONE node material — there is no per-view dither fade, so the only per-mesh state
  // would be base colour, and that is uniform terrain colour by default. Sharing collapses
  // thousands of distinct TSL graphs/pipelines into one, killing the per-mesh material cost on
  // zoom-out and page entry. Trade-off: per-node `colorByLod` tint and the red bubble tint are
  // not shown on this shared path (debug-only views; frame timing is unaffected). WebGL and the
  // "dither" transition keep per-view materials, so those paths are unchanged.
  const poolTerrainMaterial = isWebGpu && cfg.selection.transition_mode === "instant";
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  let anyBodyInWorld = false;
  for (const lake of waterConfig.fakeBodies.lakes) {
    if (lake.center[0] >= 0 && lake.center[0] <= worldCells && lake.center[1] >= 0 && lake.center[1] <= worldCells) {
      anyBodyInWorld = true;
      break;
    }
  }
  if (!anyBodyInWorld) {
    for (const river of waterConfig.fakeBodies.rivers) {
      for (const pt of river.points) {
        if (pt[0] >= 0 && pt[0] <= worldCells && pt[1] >= 0 && pt[1] <= worldCells) {
          anyBodyInWorld = true;
          break;
        }
      }
      if (anyBodyInWorld) break;
    }
  }
  if (waterConfig.enabled && !anyBodyInWorld && (waterConfig.fakeBodies.lakes.length > 0 || waterConfig.fakeBodies.rivers.length > 0)) {
    console.warn("[water] no fake water bodies inside world bounds; water will be invisible");
  }
  const mid = worldCells / 2;
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);
  camera.position.set(mid, worldCells * 0.7, mid + worldCells * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(mid, 24, mid);
  if (stagedImport) {
    camera.position.fromArray(stagedImport.manifest.camera.position);
    controls.target.fromArray(stagedImport.manifest.camera.target);
    camera.lookAt(controls.target);
    controls.update();
  } else if (queryGrassPerfScene) {
    controls.target.set(mid, 20, mid);
    camera.position.set(mid - worldCells * 0.24, 46, mid + worldCells * 0.34);
    camera.lookAt(controls.target);
    controls.update();
  } else if (queryTreePerfScene) {
    controls.target.set(mid, 24, mid);
    camera.position.set(mid - worldCells * 0.28, 58, mid + worldCells * 0.38);
    camera.lookAt(controls.target);
    controls.update();
  } else if (queryLongViewScene) {
    // LV-0: long-view camera. An explicit ?cam=tx,ty,tz,yaw,pitch,fov overrides; otherwise
    // frame the built world from a high vantage so the far layers are actually in view. (The
    // old hardcoded 1800,360,3200 default pointed outside any world smaller than ~4 km.)
    const camParam = searchParams.get("cam");
    const parts = camParam ? camParam.split(",").map(Number) : [];
    if (camParam && parts.length >= 4 && parts.every(Number.isFinite)) {
      controls.target.set(parts[0], parts[1], parts[2]);
      camera.position.set(parts[0], parts[1] + 20, parts[2] + 40);
      camera.rotation.set(parts[4] ?? 0, parts[3] ?? 0, 0, "YXZ");
      if (parts[5]) { camera.fov = parts[5]; camera.updateProjectionMatrix(); }
      controls.update();
    } else if (activePhase0Scene) {
      const cam = activePhase0Scene.camera;
      const xRatio = cam.x_ratio ?? cam.start_x_ratio ?? 0.5;
      const zRatio = cam.z_ratio ?? cam.start_z_ratio ?? 0.5;
      const yOffset = cam.y_offset_m ?? worldCells * 0.45;
      const lookDist = cam.look_distance_m ?? worldCells;
      const cx = worldCells * xRatio;
      const cz = worldCells * zRatio;
      controls.target.set(cx, 64, cz + lookDist * 0.1);
      camera.position.set(cx - worldCells * 0.15, yOffset, cz + lookDist * 0.15);
      camera.lookAt(controls.target);
      controls.update();
    } else {
      controls.target.set(mid, 64, mid + worldCells * 0.4);
      camera.position.set(mid - worldCells * 0.15, worldCells * 0.45, mid + worldCells * 0.55);
      camera.lookAt(controls.target);
      controls.update();
    }
  }

  // LV-0: Wire setPose/getPose after controls + camera exist.
  if (longViewHooks) {
    longViewHooks.setPose = (pose) => {
      controls.target.set(pose.p[0], pose.p[1], pose.p[2]);
      camera.rotation.set(pose.pitch, pose.yaw, 0, "YXZ");
      if (pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
    };
    longViewHooks.getPose = () => ({
      p: [controls.target.x, controls.target.y, controls.target.z],
      yaw: camera.rotation.y,
      pitch: camera.rotation.x,
      fov: camera.fov,
    });
  }

  const colliderPages: TerrainColliderPage[] = allNodes
    .filter((node) => node.level === 0)
    .map((node) => ({
      id: node.id,
      mesh: node.mesh,
      footprint: node.footprint,
    }));
  const terrainColliders = new TerrainColliderSet(colliderPages);
  const player = new PlayerController(terrainColliders, {
    minX: -1000,
    minZ: -1000,
    maxX: Math.max(worldCells, 1000),
    maxZ: Math.max(worldCells, 1000),
  });
  const interaction = new PlayerInteractionState();
  const terrainRaycast = createTerrainRaycastService({
    terrainColliders,
    surfaceHeight,
    worldCells,
  });

  const {
    queryWeatherMode,
    weatherDefaults,
    queryWeatherIntensity,
    queryWeatherWindX,
    queryWeatherWindZ,
  } = parseWeatherQueryContext(searchParams);
  const textureLoadOptions: TerrainTextureLoadOptions = { textureMipmapsEnabled, maxAnisotropy };
  const digHoldIntervalMs = clodRuntime.digging.holdIntervalMs;
  const state = createClodAppState({
    cfg,
    clodRuntime,
    searchParams,
    stagedImport,
    isWebGpu,
    queryPerfMode,
    queryWebGpuSelection,
    queryMaterialTiers,
    queryGrassPerfScene,
    queryTreePerfScene,
    queryForestFloorScene,
    queryTreeGpuRing,
    queryFarShell,
    isLongView,
    queryGrassRingGrid,
    queryGrassRingCell,
    queryTerrainMaterialSource,
    queryWeatherMode,
    queryWeatherIntensity,
    queryWeatherWindX,
    queryWeatherWindZ,
    weatherDefaults,
    grassConfig,
    stoneConfig,
    treeConfig,
    understoryConfig,
    forestLightingConfig,
    waterConfig,
    digHoldIntervalMs,
  });

  let colorByLodUserOverride = stagedImport !== null;
  let colorByLodController: { updateDisplay: () => unknown } | null = null;
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
  const bindings = createClodRuntimeBindings();

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
    getColorByLodUserOverride: () => colorByLodUserOverride,
    setColorByLodUserOverride: (value) => { colorByLodUserOverride = value; },
    getColorByLodController: () => colorByLodController,
  });
  const applyTerrainTextures = () => materialController.applyTerrainTextures();
  const applyColorByLodToMaterials = (on: boolean) => materialController.applyColorByLodToMaterials(on);

  // One view per node; selection visibility drives what's drawn.
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
    onTriangleCount: (counter, count) => {
      if (longViewHooks?.stats) longViewHooks.stats.counters[counter] = count;
    },
  });

  // LV-3: Far terrain shadow proxy (~128 m – 3.2 km).
  const shadowHeightTexture = createHeightTexture(terrainSummary);
  const shadowProxyResult = buildFarTerrainShadowProxy(shadowHeightTexture, worldSizeCells, {
    grid: 512,
  });
  if (isLongView) {
    scene.add(shadowProxyResult.mesh);
  }
  if (longViewHooks?.stats) {
    longViewHooks.stats.counters["shadow_proxy_tris"] = shadowProxyResult.triangleCount;
  }

  // page-boundary overlay (rebuilt on cut change)
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

  // Near-field bubble: raw per-chunk meshes for a LOD0 page, built lazily and cached.
  // Page LOD0 = welded chunks, so with tint off the bubble edge must be invisible (§4.4).
  const worldBounds = { cellsX: worldCells, cellsZ: worldCells };
  // Max bubble pages whose raw chunk groups (P^2 meshChunk each) we build per frame. Caps the mesh bubble chunks on WebGPU compute (gpu_chunk_mesher) instead of CPU
  // meshChunk. Async, so pages build progressively and the welded LOD0 page mesh stays visible
  // until a page's chunks are ready (entry.ready). CPU meshChunk stays the default safety net.
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
      // Opt-in parity self-check: mesh a few chunks on GPU, compare to CPU meshChunk, log deltas.
      // Quantifies f32-vs-f64 drift so a live run is a number, not a guess. Read-only.
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

  const currentGrassLighting = (): GrassLighting => {
    const lighting = currentLighting();
    return {
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    };
  };
  const grassLightingToEnvironment = (lighting: GrassLighting): EnvironmentLighting => ({
    sunDirection: lighting.light,
    sunColor: lighting.sunColor,
    skyLight: lighting.skyLight,
    groundLight: lighting.groundLight,
  });
  let grassStats: GrassStats | null = null;
  const lod0PageNodes = allNodes.filter((node) => node.level === 0);
  const gpuBackend = isWebGpu ? app.renderer.backend as unknown as {
    createStorageAttribute(attribute: THREE.BufferAttribute): void;
    createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
    get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
  } : null;
  const grassController = createGrassController({
    scene,
    nodes: lod0PageNodes,
    worldCells,
    grassConfig,
    queryGrassRingGrid,
    queryGrassRingCell,
    supportsRing: isWebGpu,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => state,
    getLighting: currentGrassLighting,
    ...(isWebGpu
      ? {
          createMaterial: (settings: GrassSettings, lighting: GrassLighting, ringInstanceBuffers) =>
            createGrassNodeMaterial({
              lighting: grassLightingToEnvironment(lighting),
              bladeWidth: settings.bladeWidth,
              windStrength: settings.windStrength,
              windSpeed: settings.windSpeed,
              gustStrength: settings.wind.gustStrength,
              mode: settings.shaderMode,
              alphaToCoverage: settings.alphaToCoverage,
              distance: settings.distance,
              ring: settings.ring,
              lod: settings.lod,
              fadeCenter: new THREE.Vector2(controls.target.x, controls.target.z),
              ringInstanceBuffers,
              hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
              worldSize: worldCells,
              waterClearance: 0.5,
            }),
          buildGeometry: buildGrassInstancedGeometry,
        }
      : {}),
    syncStatsToState: (stats) => {
      grassStats = stats;
      state.grassBladeCount = stats.blades;
      state.grassVisiblePatches = `${stats.visiblePatches}/${stats.patches}`;
      state.grassTierSummary = `${stats.nearPatches}/${stats.midPatches}/${stats.coveragePatches}/${stats.superPatches}`;
      state.grassEdgeSuppressed = stats.edgeSuppressedCandidates;
      state.grassCandidateCount = stats.generatedCandidates;
      state.grassPatchRebuildCount = stats.patchRebuildCount;
      state.grassBuildMs = Number(stats.buildMs.toFixed(2));
    },
  });
  const grassSystem = grassController.system;
  const makeGrassSettings = () => grassController.makeSettings();
  state.grassBladeCount = grassSystem.getBladeCount();
  grassStats = grassSystem.getStats();

  let onStoneScatterComplete: (() => void) | null = null;
  let stoneTotalController: { updateDisplay: () => unknown } | null = null;
  let stoneClassSummaryController: { updateDisplay: () => unknown } | null = null;
  let stoneVisibleController: { updateDisplay: () => unknown } | null = null;
  let treeTotalController: { updateDisplay: () => unknown } | null = null;
  let treeVisiblePatchesController: { updateDisplay: () => unknown } | null = null;
  let treeLodSummaryController: { updateDisplay: () => unknown } | null = null;
  let treeGpuSummaryController: { updateDisplay: () => unknown } | null = null;
  let understoryTotalController: { updateDisplay: () => unknown } | null = null;
  let understoryVisiblePatchesController: { updateDisplay: () => unknown } | null = null;
  let understoryClassSummaryController: { updateDisplay: () => unknown } | null = null;
  let understoryGpuSummaryController: { updateDisplay: () => unknown } | null = null;
  const formatTreeGpuSummary = (stats: TreeStats): string =>
    stats.gpuStatus === "disabled"
      ? "disabled"
      : `${stats.gpuStatus} ${stats.gpuCandidateCount}/${stats.gpuAcceptedCount}/${stats.gpuVisibleCount}${stats.gpuOverflowed ? " overflow" : ""}`;
  const formatUnderstoryGpuSummary = (stats: UnderstoryStats): string =>
    stats.gpuStatus === "disabled"
      ? "disabled"
      : `${stats.gpuStatus} ${stats.gpuCandidateCount}/${stats.gpuAcceptedCount}/${stats.gpuVisibleCount}${stats.gpuOverflowed ? " overflow" : ""}${stats.gpuDispatchMs !== null ? ` ${stats.gpuDispatchMs.toFixed(1)}ms` : ""}`;
  const stoneController = createStoneController({
    scene,
    nodes: lod0PageNodes,
    worldCells,
    stoneConfig,
    hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => state,
    getLighting: currentGrassLighting,
    onScatterStats: () => onStoneScatterComplete?.(),
    syncStatsToState: (stats) => {
      stoneStats = stats;
      state.stoneTotal = stats.total;
      state.stoneClassSummary = `${stats.large}/${stats.medium}/${stats.small}`;
      state.stoneVisible = stats.visible;
      stoneTotalController?.updateDisplay();
      stoneClassSummaryController?.updateDisplay();
      stoneVisibleController?.updateDisplay();
    },
  });
  const stoneSystem = stoneController.system;
  const visibleStoneClasses = () => stoneController.visibleClasses();
  let stoneStats: StoneStats | null = stoneSystem.getStats();

  const treeController = createTreeController({
    scene,
    nodes: lod0PageNodes,
    worldCells,
    treeConfig,
    webgpu: isWebGpu,
    hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => state,
    getLighting: currentLighting,
    syncStatsToState: (stats) => {
      treeStats = stats;
      state.treeTotal = formatTreeTotalDisplay(stats);
      state.treeVisiblePatches = `${stats.visiblePatches}/${stats.patches}`;
      state.treeLodSummary = `${stats.nearTrees}/${stats.midTrees}/${stats.farTrees}/${stats.impostorTrees}`;
      state.treeGpuSummary = formatTreeGpuSummary(stats);
      treeTotalController?.updateDisplay();
      treeVisiblePatchesController?.updateDisplay();
      treeLodSummaryController?.updateDisplay();
      treeGpuSummaryController?.updateDisplay();
    },
  });
  const treeSystem = treeController.system;
  const fallingTrees = treeController.fallingTrees;
  let treeStats: TreeStats | null = treeSystem.getStats();

  const understoryController = createUnderstoryController({
    scene,
    nodes: lod0PageNodes,
    worldCells,
    understoryConfig,
    webgpu: isWebGpu,
    hydrologyData: hydrologySystem ? packHydrologyData(hydrologySystem) : null,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => state,
    getLighting: currentLighting,
    syncStatsToState: (stats) => {
      understoryStats = stats;
      state.understoryTotal = stats.totalInstances;
      state.understoryVisiblePatches = `${stats.visiblePatches}/${stats.patches}`;
      state.understoryClassSummary =
        `${stats.shrub}/${stats.fern}/${stats.sapling}/${stats.flower}/${stats.deadLog}/${stats.stump}`;
      state.understoryGpuSummary = formatUnderstoryGpuSummary(stats);
      understoryTotalController?.updateDisplay();
      understoryVisiblePatchesController?.updateDisplay();
      understoryClassSummaryController?.updateDisplay();
      understoryGpuSummaryController?.updateDisplay();
    },
  });
  const understorySystem = understoryController.system;
  let understoryStats: UnderstoryStats | null = understorySystem.getStats();

  let forestLightingStatsController: { updateDisplay: () => unknown } | null = null;
  let forestLightingStats: ForestLightingStats | null = null;
  const forestLightingController = createForestLightingController({
    worldCells,
    forestLightingConfig,
    getUiState: () => state,
    getTreeSystem: () => treeSystem,
    getUnderstorySystem: () => understorySystem,
    syncStatsToState: (stats, statsText) => {
      forestLightingStats = stats;
      state.forestLightingStats = statsText;
      forestLightingStatsController?.updateDisplay();
    },
  });
  const forestLightingSystem = forestLightingController.system;
  const applyForestLightingToPropMaterials = () => forestLightingController.applyToPropMaterials();
  forestLightingStats = forestLightingSystem.getStats();

  const waterController = await createWaterController({
    scene,
    nodes: lod0PageNodes,
    waterConfig,
    worldCells,
    isWebGpu,
    surfaceHeight,
    hydrologySystem,
    camera,
    getSunDirection: () => currentLighting().sunDirection,
    getUiState: () => state,
    searchParams,
    devMode: import.meta.env.DEV,
  });
  const waterField = waterController.field;
  const waterDebugState = waterController.debugState;
  const makeWaterVisual = () => waterController.makeVisual();

  const weatherController = createWeatherController({
    scene,
    camera,
    isWebGpu,
    worldCells,
    surfaceHeight,
    surfaceNormal,
    waterSample: (x, z) => waterField.sample(x, z),
    getSettings: () => ({
      weatherMode: state.weatherMode,
      weatherIntensity: state.weatherIntensity,
      weatherWindX: state.weatherWindX,
      weatherWindZ: state.weatherWindZ,
    }),
    setStatsText: (text) => { state.weatherStats = text; },
  });
  const applyWeatherSettings = () => weatherController.applySettings();
  const updateWeatherStats = () => weatherController.refreshStats();

  const updateLighting = () => {
    skyEnvironment?.updateSettings(currentEnvironmentSettings());
    const lighting = currentLighting();
    materialController.forEachMaterial((mat) => materialController.applyLighting(mat, lighting));
    grassController.updateLighting({
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    });
    const stoneLighting = {
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    };
    stoneController.updateLighting(stoneLighting);
    treeController.updateLighting(lighting);
    understoryController.updateLighting(lighting);
    waterController.updateSunDirection(lighting.sunDirection);
  };

  const averageFpsRef = { value: 0 };
  let lastDigSummary = "";
  let lastArchiveSummary = "";

  const cutChangedRef: { fn: () => void } = { fn: () => {} };
  const selectionController = createClodSelectionController({
    config: {
      clodRuntime,
      hysteresisMergeFactor: cfg.selection.hysteresis_merge_factor,
      chunksPerPage: cfg.page.chunks_per_page,
      chunkSize: cfg.page.chunk_size,
      readbackMode: queryReadbackMode,
      forceContinuousParity: queryWebGpuParity,
      webGpuUnavailableReason,
      poolTerrainMaterial,
    },
    roots: result.roots,
    allNodes,
    views,
    getClodErrorCompute: () => clodErrorCompute,
    getSettings: () => ({
      thresholdPx: state.thresholdPx,
      enforce21: state.enforce21,
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
    getSelectionCenter: () => interaction.mode === "playing" ? player.position : controls.target,
    renderer,
    camera,
    overlays: { boundaryGroup, seamGroup, crossLodBorderGroup },
    lockedBorderOverlay,
    staleEditedAncestorIds,
    onCutChanged: () => cutChangedRef.fn(),
  });
  const updateSelection = () => selectionController.update();

  waterController.installDebugApi({
    exitToOrbit: () => interaction.exitToOrbit(),
    resetPlayerInput: () => bindings.resetPlayerInput(),
    setControlsEnabled: (enabled) => { controls.enabled = enabled; },
    setControlsTarget: (x, y, z) => { controls.target.set(x, y, z); },
    setCameraPosition: (x, y, z) => { camera.position.set(x, y, z); },
    cameraLookAt: (x, y, z) => { camera.lookAt(x, y, z); },
    controlsUpdate: () => { controls.update(); },
    updatePlayerModeUi: () => bindings.updatePlayerModeUi(),
    updateSelection: () => updateSelection(),
    setWaterDebugModeState: (mode) => { state.waterDebugMode = mode; },
  });

  const currentOverlaySnapshot = (): ClodOverlaySnapshot => {
    const selection = selectionController.stats();
    return {
      worldSize: WORLD,
      renderedTriangles: selection.triCount,
      nodesByLod: selection.nodesByLod,
      forcedSplits: selection.forcedSplits,
      bubbleForcedSplits: selection.nearFieldForcedSplits,
      cutFrozen: state.freeze,
      errorThreshold: state.thresholdPx,
      buildStatus,
      digCostLine: lastDigSummary || undefined,
      polishLine,
    };
  };

  const updateInfo = () => {
    const selection = selectionController.stats();
    const playerLine = interaction.mode === "playing"
      ? `player: grounded=${player.grounded}  physics p95=${player.physicsP95Ms().toFixed(2)} ms  collider pages=${player.lastPagesTested}`
      : `view: ${interaction.mode}`;
    const sceneLabel = queryGrassPerfScene ? "  GRASS PERF" : queryTreePerfScene ? "  TREE PERF" : queryForestFloorScene ? "  FOREST FLOOR" : "";
    info.textContent =
      `Drusniel Voxels Web — ${WORLD}x${WORLD} pages${sceneLabel}\n` +
      `cut: ${selection.renderedCount} nodes  (${selection.levelSummary})\n` +
      `tris rendered: ${selection.triCount.toLocaleString()}   2:1 forced splits: ${selection.forcedSplits}   ` +
      `bubble forced splits: ${selection.nearFieldForcedSplits}   xLOD borders: ${selection.crossLodAdjacencyCount}\n` +
      `threshold: ${state.thresholdPx.toFixed(2)} px   avg FPS: ${averageFpsRef.value.toFixed(1)}   ` +
      `${state.forceMaxLevel === "auto" ? "" : `forced<=${state.forceMaxLevel}   `}${state.freeze ? "[FROZEN]" : ""}\n` +
      `renderer: ${isWebGpu ? "WebGPU" : "WebGL"}   selection: ${selection.selectionSource} ${selection.selectionMs.toFixed(2)}ms   gpu-compute: ${selectionController.formatWebGpuStats(state.webgpuSelection)}\n` +
      `${polishLine}\n` +
      `worker: parents pending=${pendingParentCount} rebuilt=${pendingParentNodes} ${pendingParentMs.toFixed(0)}ms   ` +
      `colliders loaded=${terrainColliders.loadedPageCount()}${state.clodPerfMode ? "   CLOD PERF" : ""}\n` +
      `grass: ${state.grassEnabled ? "enabled" : "disabled"} ${state.grassShaderMode} ` +
      `${state.grassBladeCount.toLocaleString()} blades` +
      `${grassStats ? ` patches=${grassStats.visiblePatches}/${grassStats.patches} ` +
      `tiers n/m/f/s=${grassStats.nearPatches}/${grassStats.midPatches}/${grassStats.coveragePatches}/${grassStats.superPatches} ` +
      `edge-skip=${grassStats.edgeSuppressedCandidates} rebuilds=${grassStats.patchRebuildCount} build=${grassStats.buildMs.toFixed(1)}ms` : ""}` +
      `${grassStats && grassStats.gpuRingStatus !== "disabled"
        ? ` gpu-grass=${grassStats.gpuRingStatus}` +
          ` gpu-n/m/f/s=${grassStats.gpuRingVisibleNear}/${grassStats.gpuRingVisibleMid}/${grassStats.gpuRingVisibleFar}/${grassStats.gpuRingVisibleSuper}` +
          ` gpu-dispatch=${grassStats.gpuRingDispatchMs === null ? "-" : grassStats.gpuRingDispatchMs.toFixed(2)}ms`
        : grassStats ? ` gpu-grass=${grassStats.gpuRingStatus}` : ""}\n` +
      `${formatTreeInfoLine(state.treesEnabled, state.treeTotal, treeStats)}\n` +
      `${formatUnderstoryInfoLine(state.understoryEnabled, state.understoryTotal, understoryStats)}\n` +
      `${formatForestLightingInfoLine(state.forestLightingEnabled, forestLightingStats)}\n` +
      `brush: ${state.digEnabled ? "on" : "off"}  ${state.brushOp === "add" ? "raise" : "dig"} ${state.brushShape} r=${state.digRadius}  edits=${digEditCount()}\n` +
      `${lastDigSummary ? `last: ${lastDigSummary}\n` : ""}` +
      `${lastArchiveSummary ? `${lastArchiveSummary}\n` : ""}` +
      playerLine;
    updateClodOverlay(currentOverlaySnapshot());
  };
  cutChangedRef.fn = updateInfo;

  // Swap a rebuilt node's mesh into its view (and, for LOD0, its collider + raw-chunk
  // bubble). Returns geometry-swap and collider-update cost in ms (0 for parents).
  // Shared by the synchronous LOD0 phase and the deferred ancestor drain.
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
    // drop the cached raw-chunk bubble meshes; they regenerate lazily when owned
    nearFieldBubbleController.invalidatePage(node.id);
    return { geometrySwapMs, colliderMs: performance.now() - tc };
  };

  let pendingParentNodes = 0;
  let pendingParentMs = 0;
  let pendingParentCount = 0;

  clodWorker.onParentRebuilt = (batch) => {
    for (const node of batch.changed) {
      applyNodeMesh(node);
      staleEditedAncestorIds.delete(node.id);
    }
    selectionController.patchNodes(batch.changed);
    pendingParentNodes = batch.parentNodes;
    pendingParentMs = batch.parentMs;
    pendingParentCount = batch.pendingParents;
    selectionController.invalidate();
    if (!state.freeze) updateSelection();
    updateInfo();
  };
  clodWorker.onParentsComplete = (_requestId, parentNodes, parentMs) => {
    pendingParentNodes = parentNodes;
    pendingParentMs = parentMs;
    pendingParentCount = 0;
    staleEditedAncestorIds.clear();
    if (parentNodes > 0) {
      lastDigSummary = `${lastDigSummary} + ancestors ${parentNodes}n ${parentMs.toFixed(0)}ms`;
    }
    updateSelection();
    updateInfo();
  };

  let terraformEditCheckbox: HTMLInputElement | null = null;
  const playerTerraformEditActive = () => terraformEditCheckbox?.checked ?? false;

  const terrainEditService = createTerrainEditService({
    clodWorker,
    terrainRaycast,
    getBrushParams: () => ({
      digRadius: state.digRadius,
      brushShape: state.brushShape,
      brushOp: state.brushOp,
      brushMaterial: state.brushMaterial,
      brushHeight: state.brushHeight,
      brushStrength: state.brushStrength,
      brushFalloff: state.brushFalloff,
    }),
    getVegetationState: () => ({
      grassEnabled: state.grassEnabled,
      treesEnabled: state.treesEnabled,
      understoryEnabled: state.understoryEnabled,
    }),
    applyNodeMesh,
    markEditedAncestorsStale,
    selectionController,
    applyTerrainTextures,
    grassSystem,
    treeSystem,
    understorySystem,
    vegetationDirtyQueue,
    fallingTrees,
    refreshGrassStats: bindings.refreshGrassStats,
    refreshTreeStats: bindings.refreshTreeStats,
    refreshUnderstoryStats: bindings.refreshUnderstoryStats,
    updateInfo,
    getLastDigSummary: () => lastDigSummary,
    setLastDigSummary: (summary) => { lastDigSummary = summary; },
    setPendingParentCount: (count) => { pendingParentCount = count; },
    setPendingParentNodes: (nodes) => { pendingParentNodes = nodes; },
    setPendingParentMs: (ms) => { pendingParentMs = ms; },
  });
  const flushAncestors = () => terrainEditService.flushAncestors();
  const scheduleDig = (ray: THREE.Ray) => terrainEditService.scheduleDig(ray);

  let playerModeController!: ReturnType<typeof createPlayerModeController>;
  let playerInputController!: ReturnType<typeof createPlayerInputController>;
  let digRadiusController!: { updateDisplay: () => unknown };

  const wirePlayerControllers = () => {
    playerInputController = createPlayerInputController({
      renderer,
      camera,
      controls,
      player,
      interaction,
      getDigEnabled: () => state.digEnabled,
      getTerraformEditActive: playerTerraformEditActive,
      getBrushFlowMs: () => state.brushFlowMs,
      scheduleDig,
      getLastDigAt: () => terrainEditService.lastDigAt,
      onTabUiHoldChange: () => { playerModeController.updatePlayerModeUi(); },
      onPlayerModeUiChange: () => { playerModeController.updatePlayerModeUi(); },
      exitPlayerMode: () => playerModeController.exitPlayerMode(),
      adjustDigRadius: (delta) => {
        state.digRadius = THREE.MathUtils.clamp(state.digRadius - Math.sign(delta) * 0.5, 1, 8);
        digRadiusController.updateDisplay();
        bindings.syncTerraformMenu();
        updateInfo();
      },
    });
    playerModeController = createPlayerModeController({
      renderer,
      camera,
      controls,
      player,
      interaction,
      terrainColliders,
      surfaceHeight,
      orbitModeButton,
      playerModeButton,
      playerModeStatus,
      searchParams,
      getTerraformEditActive: playerTerraformEditActive,
      getTabUiHold: () => playerInputController.tabUiHold,
      onBeforeExitMode: () => playerInputController.onBeforeExitMode(),
      resetPlayerInput: () => playerInputController.resetPlayerInput(),
      onStartPlayingFacing: (yaw, pitch) => playerInputController.setPlayerYawPitch(yaw, pitch),
    });
    bindings.resetPlayerInput = () => playerInputController.resetPlayerInput();
    bindings.updatePlayerModeUi = () => playerModeController.updatePlayerModeUi();
    playerModeController.applyQuerySpawn();
    playerModeController.updatePlayerModeUi();
  };

  const drainVegetationDirtyQueue = (): void => {
    drainVegetationDirty({
      queue: vegetationDirtyQueue,
      grassEnabled: state.grassEnabled,
      treesEnabled: state.treesEnabled,
      understoryEnabled: state.understoryEnabled,
      markGrassDirty: () => {
        grassSystem.markPatchesDirty();
        bindings.refreshGrassStats();
      },
      markTreesDirty: () => {
        treeController.markPatchesDirty();
        bindings.refreshTreeStats();
      },
      markUnderstoryDirty: () => {
        understoryController.markPatchesDirty();
        bindings.refreshUnderstoryStats();
      },
    });
  };

  updateLighting();
  updateSelection();

  const setPerfModeQuery = (enabled: boolean) => {
    const next = new URLSearchParams(location.search);
    if (enabled) next.set("clodPerf", "1");
    else next.delete("clodPerf");
    history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
  };
  const setWebGpuSelectionQuery = (enabled: boolean) => {
    const next = new URLSearchParams(location.search);
    if (enabled) next.set("webgpuSelection", "1");
    else next.delete("webgpuSelection");
    history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
  };
  const setMaterialTiersQuery = (enabled: boolean) => {
    const next = new URLSearchParams(location.search);
    if (enabled) next.set("materialTiers", "1");
    else next.delete("materialTiers");
    history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
  };
  const applyClodPerfMode = (enabled: boolean) => {
    state.clodPerfMode = enabled;
    if (enabled) {
      state.colorByLod = true;
      state.albedo = false;
      state.normalMap = false;
      state.triplanar = false;
      state.postProcessEnabled = false;
      state.postProcessDebugMode = "off";
      state.bubble = false;
      state.showBounds = false;
      state.showSeamPoints = false;
      state.showCrossLodBorders = false;
      state.showNodeLabels = false;
      state.showLockedBorderVertices = false;
      state.grassEnabled = false;
      colorByLodUserOverride = true;
      applyColorByLodToMaterials(true);
      nodeLabelOverlay.setVisible(false);
      lockedBorderOverlay.rebuild(selectionController.stats().renderedNodes, false);
      grassSystem?.setEnabled(false);
      postProcess?.updateSettings(currentPostProcessSettings());
      applyTerrainTextures();
    }
    skyEnvironment?.setVisible(!enabled);
    setPerfModeQuery(enabled);
    selectionController.invalidate();
    updateSelection();
    updateInfo();
  };

  let weatherStatsController: { updateDisplay: () => unknown } | null = null;
  let grassBladeCountController: { updateDisplay: () => unknown } | null = null;
  let grassVisiblePatchesController: { updateDisplay: () => unknown } | null = null;
  let grassTierSummaryController: { updateDisplay: () => unknown } | null = null;
  let grassEdgeSuppressedController: { updateDisplay: () => unknown } | null = null;
  let grassCandidateCountController: { updateDisplay: () => unknown } | null = null;
  const guiResult = createClodPocGui(state, {
    clod: {
      world: WORLD,
      worldOptions: clodRuntime.runtime.worldOptions,
      isWebGpu,
      views: views.values(),
      materialController,
      selectionController,
      farShellController,
      nodeLabelOverlay,
      applyClodPerfMode,
      setMaterialTiersQuery,
      setWebGpuSelectionQuery,
      ensureClodErrorCompute,
      updateSelection,
      updateInfo,
      applyColorByLodToMaterials,
      setColorByLodUserOverride: (on) => { colorByLodUserOverride = on; },
      recomputedNormalsFor: (view) => recomputedNormalsFor(view as NodeView),
    },
    environment: {
      updateLighting,
      applyColorAdjustmentsToTerrain,
      currentPostProcessSettings,
      postProcess,
    },
    weather: {
      weatherController,
      applyWeatherSettings,
    },
    vegetation: {
      grassController,
      stoneController,
      treeController,
      understoryController,
      forestLightingController,
      farShellController,
      treeSystem,
      understorySystem,
      treeConfig,
      understoryConfig,
      renderer,
      visibleStoneClasses,
      updateInfo,
      bakeImpostorsOnStart: treeConfig.impostors.bakeOnStart,
      impostorsEnabled: treeConfig.impostors.enabled,
    },
    water: {
      waterController,
      waterDebugState,
      makeWaterVisual,
      setWaterEnabled: (enabled) => { state.waterEnabled = enabled; },
      setWaterDebugMode: (mode) => { state.waterDebugMode = mode; },
      setWaterClipmapTint: (enabled) => { state.waterClipmapTint = enabled; },
      setWaterWireframe: (enabled) => { state.waterWireframe = enabled; },
      setWaterDepthWrite: (on) => { state.waterDepthWrite = on; },
    },
  });
  const gui = guiResult.gui;
  colorByLodController = guiResult.colorByLodController;
  weatherStatsController = guiResult.weatherStatsController;
  bindings.refreshGrassStats = guiResult.refreshGrassStats;
  bindings.refreshTreeStats = guiResult.refreshTreeStats;
  bindings.refreshUnderstoryStats = guiResult.refreshUnderstoryStats;
  onStoneScatterComplete = guiResult.onStoneScatterComplete;
  forestLightingStatsController = guiResult.forestLightingStatsController;
  ({
    grassBladeCount: grassBladeCountController,
    grassVisiblePatches: grassVisiblePatchesController,
    grassTierSummary: grassTierSummaryController,
    grassEdgeSuppressed: grassEdgeSuppressedController,
    grassCandidateCount: grassCandidateCountController,
    stoneTotal: stoneTotalController,
    stoneClassSummary: stoneClassSummaryController,
    stoneVisible: stoneVisibleController,
    treeTotal: treeTotalController,
    treeVisiblePatches: treeVisiblePatchesController,
    treeLodSummary: treeLodSummaryController,
    treeGpuSummary: treeGpuSummaryController,
    understoryTotal: understoryTotalController,
    understoryVisiblePatches: understoryVisiblePatchesController,
    understoryClassSummary: understoryClassSummaryController,
    understoryGpuSummary: understoryGpuSummaryController,
  } = guiResult.statControllers);

  const textureProgress = {
    setPhase: (label: string, fraction: number) => {
      buildProgress.hidden = false;
      buildProgressPhase.textContent = label;
      buildProgressPercent.textContent = `${Math.round(fraction * 100)}%`;
      buildProgressBar.value = fraction;
    },
  };
  const textureModal = createTerrainTextureModal({
    textureController,
    textureLoadOptions,
    applyTerrainTextures,
    setLoadedTextureFiles: (value) => {
      state.loadedTextureFiles = value;
    },
    onBrushMaterialClamped: (maxIndex) => {
      if (state.brushMaterial > maxIndex) state.brushMaterial = 0;
    },
  });
  if (stagedImport) {
    textureModal.rebuildTextureSlotCards();
    await textureController.restoreStagedImport(textureProgress);
  } else if (!state.clodPerfMode && state.terrainMaterialSource === "external_pbr") {
    await textureController.loadDefaultBuiltinTextures(textureProgress);
  } else {
    state.loadedTextureFiles = state.clodPerfMode ? "perf mode" : state.terrainMaterialSource;
  }
  textureModal.syncTextureModalControls();
  textureModal.updateTextureSlotPreviews();
  textureModal.refreshTextureState();
  buildProgress.hidden = true;

  const { digRadiusController: digRadiusGuiController } = createClodPocTerrainMaterialGui(gui, state, {
    terrainMaterial: {
      textureModal,
      applyTerrainTextures,
      updateSelection,
      updateInfo,
      applyBubbleTint: (enabled) => nearFieldBubbleController.applyTint(enabled),
    },
  });
  digRadiusController = digRadiusGuiController;

  wirePlayerControllers();

  const terraformMenuRoot = document.getElementById("terraform-menu")!;
  const terraformMenuUi = createTerraformMenu({
    root: terraformMenuRoot,
    state,
    materialController,
    digRadiusController,
    updateInfo,
    bindTerraformEditCheckbox: (input) => playerModeController.bindTerraformEditCheckbox(input),
    bindEditToggleInput: (input) => playerModeController.bindEditToggleInput(input),
    onEditToggleChanged: (enabled) => {
      if (!enabled) {
        playerInputController.clearDigHold();
        brushPreview.hide();
      }
      playerModeController.updatePlayerModeUi();
    },
  });
  terraformEditCheckbox = terraformMenuUi.editCheckbox;
  bindings.refreshTerraformSwatches = terraformMenuUi.refreshSwatches;
  bindings.syncTerraformMenu = terraformMenuUi.syncMenu;

  const projectArchiveController = createProjectArchiveController({
    importButton,
    exportButton,
    projectImportInput,
    buildProgress,
    buildProgressPhase,
    buildProgressPercent,
    buildProgressBar,
    getState: () => state,
    getWorldSize: () => WORLD,
    getConfig: () => cfg,
    getNodesByLevel: () => result.nodesByLevel,
    textureController,
    camera,
    controls,
    flushAncestors,
    setBuildStatus: (status) => { buildStatus = status; },
    updateOverlay: () => updateClodOverlay(currentOverlaySnapshot()),
    setLastArchiveSummary: (summary) => { lastArchiveSummary = summary; },
    updateInfo,
  });
  projectArchiveController.bindImportExportButtons();

  // Imported controller values need the same side effects as interactive GUI changes.
  materialController.forEachMaterial((material) => {
    material.setWireframe(state.wireframe);
    material.setDebug({
      normalColor: state.normalColor,
      normalDivergence: state.normalDivergence,
      divergenceGain: state.divergenceGain,
    });
    material.setSide(state.frontSideOnly ? THREE.FrontSide : THREE.DoubleSide);
  });
  for (const view of views.values()) {
    view.mat.setBaseColor(state.colorByLod ? LOD_COLORS[Math.min(view.node.level, 3)] : 0xb9c0c8);
    if (state.recomputedNormals) {
      view.mesh.geometry.setAttribute("normal", new THREE.BufferAttribute(recomputedNormalsFor(view), 3));
    }
  }
  applyColorAdjustmentsToTerrain();
  updateLighting();
  applyTerrainTextures();
  grassSystem?.setEnabled(state.grassEnabled);
  grassSystem?.updateSettings(makeGrassSettings());
  bindings.refreshGrassStats();
  treeSystem.setEnabled(state.treesEnabled);
  treeController.applySettings();
  bindings.refreshTreeStats();
  understorySystem.setEnabled(state.understoryEnabled);
  understoryController.applySettings();
  bindings.refreshUnderstoryStats();
  forestLightingController.bumpSettingsVersion();
  forestLightingController.applySettings();
  updateSelection();
  updateInfo();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postProcess?.setSize(window.innerWidth, window.innerHeight);
  });

  const grassProfileEnabled = searchParams.get("grassProfile") === "1";
  const grassPrepassEnabled = searchParams.get("prepass") !== "0";
  const profileFrameMs = resolveSlowFrameMsThreshold(searchParams, clodRuntime.profiling.slowFrameMs);
  bindClodFrameLoop({
    renderer: renderer as THREE.WebGLRenderer,
    scene,
    camera,
    controls,
    player,
    interaction,
    state,
    selectionController,
    playerInputController,
    skyEnvironment,
    drainVegetationDirtyQueue,
    treeController,
    updateSelection,
    playerTerraformEditActive,
    brushPreview,
    terrainRaycast,
    pageTransitionMode,
    crossfadeStep,
    nearFieldBubbleController,
    views,
    worldCells,
    grassController,
    understoryController,
    forestLightingController,
    applyForestLightingToPropMaterials,
    stoneController,
    waterController,
    weatherController,
    updateWeatherStats,
    weatherStatsController,
    grassSystem,
    treeSystem,
    understorySystem,
    forestLightingSystem,
    stoneSystem,
    currentLighting,
    getGrassStats: () => grassStats,
    setGrassStats: (stats) => { grassStats = stats; },
    getTreeStats: () => treeStats,
    setTreeStats: (stats) => { treeStats = stats; },
    getStoneStats: () => stoneStats,
    setStoneStats: (stats) => { stoneStats = stats; },
    getUnderstoryStats: () => understoryStats,
    setUnderstoryStats: (stats) => { understoryStats = stats; },
    getForestLightingStats: () => forestLightingStats,
    setForestLightingStats: (stats) => { forestLightingStats = stats; },
    formatTreeGpuSummary,
    formatUnderstoryGpuSummary,
    grassBladeCountController,
    grassVisiblePatchesController,
    grassTierSummaryController,
    grassEdgeSuppressedController,
    grassCandidateCountController,
    treeTotalController,
    treeVisiblePatchesController,
    treeLodSummaryController,
    treeGpuSummaryController,
    stoneTotalController,
    stoneClassSummaryController,
    stoneVisibleController,
    understoryTotalController,
    understoryVisiblePatchesController,
    understoryClassSummaryController,
    understoryGpuSummaryController,
    forestLightingStatsController,
    nodeLabelOverlay,
    postProcess,
    currentPostProcessSettings,
    makeGrassSettings,
    updateInfo,
    averageFpsRef,
    getHooks: () => longViewHooks,
    longViewSettleWaiters,
    maxTerrainLevel,
    farShellBuilt: () => farShellController.isBuilt(),
    farShellCanopyEnabled: () => farShellController.canopyShell !== null,
    isLongView,
    phase0TargetVisibleM,
    phase0Config,
    queryScene,
    phase0VelocityX,
    phase0VelocityZ,
    phase0Streaming,
    longViewDiagnosticsCfg: cfg,
    getFarShellRadiusFactor: () => state.farShellRadiusFactor,
    profileFrameMs,
    grassProfileEnabled,
    grassPrepassEnabled,
    submitMsChanged,
  });

  bindUiAudioShell();

  window.addEventListener("beforeunload", () => {
    nearFieldBubbleController.dispose();
    lockedBorderOverlay.dispose();
    grassSystem.dispose();
    forestLightingController.dispose();
    treeController.dispose();
    stoneSystem.dispose();
    waterController.dispose();
    weatherController.dispose();
    skyEnvironment?.dispose();
    postProcess?.dispose();
    clodErrorCompute?.destroy();
    clodWorker.dispose();
    farShellController.dispose();
    shadowProxyResult.dispose();
  }, { once: true });
}
