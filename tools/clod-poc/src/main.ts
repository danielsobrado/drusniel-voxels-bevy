import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createClodPocGui, createClodPocTerrainMaterialGui } from "./ui/gui/gui_root.js";
import { parseConfig } from "./config.js";
import { initHooks, type ClodHooks } from "./core/hooks.js";
import { failLoud, installGlobalErrorHooks } from "./core/diagnostics.js";
import { buildTerrainSummary, createHeightTexture } from "./clod/terrain_summary.js";
import { buildFarTerrainShadowProxy } from "./gpu/far_terrain_shadow_proxy.js";
import { bakeMacroTint } from "./gpu/terrain_node_material.js";
import { computeEffectiveVisibleMeters, computeVisibleTargetMet } from "./phase0/phase0_metrics.js";
import { simulateStreamingCoverage } from "./phase0/streaming_coverage_sim.js";
import { parsePhase0Config, type Phase0Config } from "./phase0/phase0_config.js";
import phase0ConfigText from "../config/infinite_streaming_phase0.yaml?raw";
import configText from "../config/clod_pages.yaml?raw";
import stoneConfigText from "../config/stones.yaml?raw";
import treeConfigText from "../config/trees.yaml?raw";
import understoryConfigText from "../config/understory.yaml?raw";
import proceduralConfigText from "../config/procedural_textures.yaml?raw";
import grassConfigText from "../config/grass.yaml?raw";
import waterConfigText from "../config/water.yaml?raw";
import forestLightingConfigText from "../config/forest_lighting.yaml?raw";
import { ClodWorkerClient } from "./clod_worker_client.js";
import { emitAudio, getAudioState } from "./audio/index.js";
import {
  baseSurfaceHeight,
  type BrushOp,
  type BrushShape,
  digEditCount,
  getDigEditsSnapshot,
  meshChunk,
  replaceDigEdits,
  setTerrainSurfaceOverride,
  surfaceNormal,
  surfaceHeight,
} from "./terrain.js";
import { GpuChunkMesher } from "./gpu/gpu_chunk_mesher.js";
import { resolveDigEdits } from "./gpu/terrain_field_core.js";
import { compareChunkSurfaces } from "./gpu/gpu_mesh_parity.js";
import { loadContentRegistry, validateContentRegistry } from "./content/index.js";
import { ClodPageNode, PageMesh } from "./types.js";
import {
  DEFAULT_TERRAIN_COLOR_ADJUSTMENTS,
  type TerrainColorAdjustments,
} from "./material.js";
import {
  type TerrainMaterialHandle,
} from "./rendering/terrain_material.js";
import {
  createWebGlAppRenderer,
  createWebGpuAppRenderer,
  parseRendererBackend,
} from "./rendering/renderer_backend.js";
import { getRendererGpuDevice } from "./rendering/webgpu_device_bridge.js";
import {
  parseGrassConfig,
  type GrassLighting,
  type GrassSettings,
  type GrassStats,
} from "./grass.js";
import { parseStoneConfig } from "./stones/stone_config.js";
import { type StoneStats } from "./stones/stone_instances.js";
import { formatTreeInfoLine, formatTreeTotalDisplay, parseTreeConfig, type TreeStats } from "./trees/index.js";
import {
  formatUnderstoryInfoLine,
  parseUnderstoryConfig,
  type UnderstoryStats,
} from "./understory/index.js";
import {
  createForestLightingIntegrationWarner,
  formatForestLightingInfoLine,
  parseForestLightingConfig,
  type ForestLightingDebugMode,
  type ForestLightingStats,
} from "./forest_lighting/index.js";
import {
  PlayerController,
  PlayerInteractionState,
} from "./player_controller.js";
import { ClodErrorPxCompute } from "./gpu/clod_error_px_compute.js";
import { requestWebGpuDevice } from "./gpu/webgpu_device.js";
import { parseReadbackMode, type WebGpuReadbackMode } from "./core/webgpu_readback_mode.js";
import { TerrainColliderSet, type TerrainColliderPage } from "./terrain_collider.js";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  DEFAULT_ENVIRONMENT_SETTINGS,
  SkyEnvironment,
  type EnvironmentLighting,
  type EnvironmentSettings,
} from "./environment.js";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  PostProcessPipeline,
  type PostProcessSettings,
} from "./postprocess.js";
import {
  buildGrassInstancedGeometry,
  createGrassNodeMaterial,
} from "./gpu/grass_node_material.js";
import {
  parseWaterConfig,
  WATER_DEBUG_MODES,
  resolveWaterConfig,
  HydrologySystem,
  makeFakeBodyCarvedSampler,
} from "./water/index.js";
import { createSkyNodeMaterial, type SkyNodeHandle } from "./gpu/sky_node_material.js";
import { WebGpuPostProcessPipeline } from "./gpu/webgpu_postprocess.js";
import {
  consumeStagedProjectImport,
  createProjectArchive,
  parseProjectArchive,
  PROJECT_SCHEMA_VERSION,
  stageProjectImport,
  type ClodProjectManifestV1,
  type ProjectArchiveContents,
  type ProjectSessionState,
  type TextureBlendMode,
} from "./project_archive.js";
import { type ClodIconKind } from "./ui/icons/index.js";
import { setButtonIcon, setIconOnlyButton } from "./ui/dom_icons.js";
import { createClodOverlay, updateClodOverlay, type ClodOverlaySnapshot } from "./ui/overlay_panel.js";
import { aggregateDiagonalPolishStats, formatDiagonalPolishStats } from "./diagonalPolish.js";
import { LockedBorderOverlay } from "./ui/locked_border_overlay.js";
import { NodeLabelOverlay } from "./ui/node_labels.js";
import {
  materialCarouselBounds,
  materialCarouselPageForSelection,
} from "./material_carousel.js";
import { terrainTextureSlotLabel } from "./terrain_textures.js";
import { parseProceduralTextureConfig } from "./textures/materialRecipes.js";
import { createProceduralTerrainTextures } from "./textures/terrainTextureArrays.js";
import {
  DEFAULT_RAIN_WEATHER_SETTINGS,
  DEFAULT_SANDSTORM_WEATHER_SETTINGS,
  DEFAULT_SNOW_WEATHER_SETTINGS,
} from "./weather/rain.js";
import { LOD_COLORS, PAINT_SWATCH_COLORS, type WeatherMode } from "./app/clod_constants.js";
import { parseClodRuntimeConfig, resolveSlowFrameMsThreshold } from "./app/runtime_config.js";
import { computeGeometryNormals, toGeometry } from "./terrain_runtime/page_geometry.js";
import { createClodSelectionController } from "./terrain_runtime/clod_selection_controller.js";
import { packHydrologyData } from "./systems/hydrology_packing.js";
import { type TerrainTextureLoadOptions } from "./terrain_runtime/texture_loader.js";
import { BUILTIN_TERRAIN_TEXTURES } from "./terrain_runtime/terrain_builtin_textures.js";
import { createTerrainTextureController } from "./terrain_runtime/terrain_texture_controller.js";
import { createTerrainMaterialController } from "./terrain_runtime/terrain_material_controller.js";
import {
  TEXTURE_BLEND_MODES,
  terrainMaterialSourceParam,
  type ProceduralDebugMode,
  type TerrainMaterialSource,
} from "./terrain_runtime/terrain_material_constants.js";
import { createTerrainTextureModal } from "./terrain_runtime/terrain_texture_modal.js";
import { createFarShellController } from "./systems/far_shell_controller.js";
import { createGrassController } from "./systems/grass_controller.js";
import { createStoneController } from "./systems/stone_controller.js";
import { createTreeController } from "./systems/tree_controller.js";
import { createUnderstoryController } from "./systems/understory_controller.js";
import { createForestLightingController } from "./systems/forest_lighting_controller.js";
import { createWaterController } from "./systems/water_controller.js";
import { createWeatherController } from "./systems/weather_controller.js";
import { drainVegetationDirty, type VegetationDirtyQueue } from "./systems/vegetation_dirty.js";
import { createTerrainRaycastService } from "./player/terrain_raycast_service.js";
import { createBrushPreviewController } from "./player/brush_preview_controller.js";
import { createPlayerModeController } from "./player/player_mode_controller.js";
import { createPlayerInputController } from "./player/player_input_controller.js";
import { createTerrainEditService } from "./terrain_runtime/terrain_edit_service.js";

const positiveNumberParam = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

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

interface AppSky {
  lighting(): EnvironmentLighting;
  setVisible(visible: boolean): void;
  updateCamera(camera: THREE.Camera): void;
  updateSettings(settings: Partial<EnvironmentSettings>): void;
  dispose(): void;
}

interface AppPostProcess {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(width: number, height: number): void;
  updateSettings(settings: Partial<PostProcessSettings>): void;
  dispose(): void;
}

class WebGpuSkyEnvironment implements AppSky {
  private readonly scene: THREE.Scene;
  private readonly renderer: { toneMappingExposure: number };
  private readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.Material>;
  private readonly previousBackground: THREE.Scene["background"];
  private readonly background = new THREE.Color();
  private readonly settings: EnvironmentSettings;
  private readonly colors = {
    sun: DEFAULT_ENVIRONMENT_COLORS.sun.clone(),
    zenith: DEFAULT_ENVIRONMENT_COLORS.zenith.clone(),
    horizon: DEFAULT_ENVIRONMENT_COLORS.horizon.clone(),
    ground: DEFAULT_ENVIRONMENT_COLORS.ground.clone(),
    skyLight: DEFAULT_ENVIRONMENT_COLORS.skyLight.clone(),
    groundLight: DEFAULT_ENVIRONMENT_COLORS.groundLight.clone(),
  };
  private handle: SkyNodeHandle;
  private disposed = false;

  constructor(options: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer | { toneMappingExposure: number };
    radius: number;
    settings: EnvironmentSettings;
  }) {
    this.scene = options.scene;
    this.renderer = options.renderer;
    this.settings = { ...options.settings };
    this.previousBackground = this.scene.background;
    this.handle = createSkyNodeMaterial(this.settings, this.colors);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(options.radius, 48, 24), this.handle.material);
    this.mesh.name = "webgpu-sky-environment";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.scene.add(this.mesh);
    this.renderer.toneMappingExposure = this.settings.exposure;
    this.updateBackground();
  }

  lighting(): EnvironmentLighting {
    const lighting = this.handle.lighting;
    return {
      sunDirection: lighting.sunDirection.clone(),
      sunColor: lighting.sunColor.clone(),
      skyLight: lighting.skyLight.clone(),
      groundLight: lighting.groundLight.clone(),
    };
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  updateCamera(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  updateSettings(settings: Partial<EnvironmentSettings>): void {
    Object.assign(this.settings, settings);
    this.handle.updateSettings(this.settings);
    this.renderer.toneMappingExposure = this.settings.exposure;
    this.updateBackground();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this.scene.background === this.background) this.scene.background = this.previousBackground;
  }

  private updateBackground(): void {
    this.background.copy(this.colors.horizon).multiplyScalar(this.settings.skyIntensity);
    this.scene.background = this.background;
  }
}

async function main() {
  const info = document.getElementById("info")!;
  const earlySearchParams = new URLSearchParams(location.search);
  const earlyScene = earlySearchParams.get("scene");
  if (
    (earlyScene === "sanity" || earlyScene === "phase1-terrain") &&
    earlySearchParams.get("webgpuSpike") !== "1" &&
    earlySearchParams.get("webgpu") !== "1" &&
    earlySearchParams.get("grassFirstInstanceSmoke") !== "1"
  ) {
    if (earlyScene === "phase1-terrain") {
      const { runPhase1TerrainScene } = await import("./phase1/phase1_scene.js");
      await runPhase1TerrainScene();
    } else {
      const { runPhase0SanityScene } = await import("./debug/sanity_scene.js");
      await runPhase0SanityScene();
    }
    return;
  }
  installGlobalErrorHooks();
  const clodRuntime = parseClodRuntimeConfig();

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

  const infoPanel = document.getElementById("info-panel")!;
  const infoClose = document.getElementById("info-close") as HTMLButtonElement;
  const infoReopen = document.getElementById("info-reopen") as HTMLButtonElement;
  const setInfoPanelVisible = (visible: boolean) => {
    infoPanel.hidden = !visible;
    infoReopen.hidden = visible;
  };
  infoClose.addEventListener("click", () => setInfoPanelVisible(false));
  infoReopen.addEventListener("click", () => setInfoPanelVisible(true));
  createClodOverlay(document.getElementById("clod-overlay")!);
  const importButton = document.getElementById("project-import") as HTMLButtonElement;
  const exportButton = document.getElementById("project-export") as HTMLButtonElement;
  const projectImportInput = document.getElementById("project-import-input") as HTMLInputElement;
  const orbitModeButton = document.getElementById("orbit-mode") as HTMLButtonElement;
  const playerModeButton = document.getElementById("player-mode") as HTMLButtonElement;
  const playerModeStatus = document.getElementById("player-mode-status")!;
  const buildProgress = document.getElementById("build-progress")!;
  const buildProgressBar = document.getElementById("build-progress-bar") as HTMLProgressElement;
  const buildProgressPhase = document.getElementById("build-progress-phase")!;
  const buildProgressPercent = document.getElementById("build-progress-percent")!;
  setIconOnlyButton(importButton, "project", "import", "Import project");
  setIconOnlyButton(exportButton, "project", "export", "Export project");
  setButtonIcon(orbitModeButton, "camera", "orbit", "Orbit");
  setButtonIcon(playerModeButton, "camera", "player", "Player");
  const searchParams = new URLSearchParams(location.search);
  const queryScene = searchParams.get("scene");
  const queryGrassPerfScene = queryScene === "grass-perf";
  const queryTreePerfScene = queryScene === "trees-perf" || searchParams.get("treesPerf") === "1";
  const queryTreeGpuRing = searchParams.get("treeGpu") === "1" || searchParams.get("treeGpuRing") === "1";
  const queryForestFloorScene = queryScene === "forest-floor";
  const queryLongViewScene = queryScene === "long-view-4km" || queryScene === "long-view-forest-4km" || queryScene === "long-view-edit-stress"
    || queryScene === "infinite-stream-straight" || queryScene === "infinite-stream-fast-turn";
  // Phase 0: Parse infinite streaming config and resolve active scene.
  const phase0Config: Phase0Config = parsePhase0Config(phase0ConfigText);
  const sceneNameToConfigKey: Record<string, string> = {
    "long-view-4km": "long_view_4km",
    "long-view-forest-4km": "long_view_forest_4km",
    "long-view-edit-stress": "long_view_edit_stress",
    "infinite-stream-straight": "infinite_stream_straight",
    "infinite-stream-fast-turn": "infinite_stream_fast_turn",
  };
  const activePhase0SceneKey = queryScene ? sceneNameToConfigKey[queryScene] : undefined;
  const activePhase0Scene = activePhase0SceneKey ? phase0Config.phase0.scenes[activePhase0SceneKey] : undefined;
  const phase0TargetVisibleM = activePhase0Scene?.require_visible_m ?? phase0Config.phase0.target_visible_m;
  // Resolve streaming simulation parameters from config.
  const phase0Streaming = phase0Config.phase0.streaming;
  let phase0VelocityX = 0;
  let phase0VelocityZ = 0;
  if (activePhase0Scene?.camera.mode === "scripted" && activePhase0Scene.camera.speed_mps !== undefined) {
    const speed = activePhase0Scene.camera.speed_mps;
    const dirDeg = activePhase0Scene.camera.direction_degrees ?? 90;
    const dirRad = (dirDeg * Math.PI) / 180;
    phase0VelocityX = Math.cos(dirRad) * speed;
    phase0VelocityZ = Math.sin(dirRad) * speed;
  }
  const queryFarShell = searchParams.get("farShell") === "1";
  const queryCanopy = searchParams.get("canopy") === "1";
  const queryPerfMode = searchParams.get("clodPerf") === "1";
  const queryWebGpuSelection = searchParams.get("webgpuSelection") === "1";
  const queryReadbackMode: WebGpuReadbackMode = parseReadbackMode(searchParams);
  const queryMaterialTiers = searchParams.get("materialTiers") === "1";
  // CPU/GPU error_px parity is a full per-node sweep; opt-in keeps it from hitching the
  // frame. Off: verify once when the first GPU map lands. On: re-verify periodically.
  const queryWebGpuParity = searchParams.get("webgpuParity") === "1";
  // Phase 1 WebGPURenderer de-risk spike (docs/webgpu-migration.md). Dynamically imported
  // so `three/webgpu` stays out of the normal WebGL bundle; short-circuits the app.
  if (searchParams.get("webgpuSpike") === "1") {
    const { runWebGpuSpike } = await import("./gpu/webgpu_spike.js");
    await runWebGpuSpike();
    return;
  }
  // Phase 2 WebGPU terrain preview: real terrain meshes rendered with the ported terrain
  // NodeMaterial, for material-parity QA before the full renderer abstraction lands.
  if (searchParams.get("webgpu") === "1") {
    const { runWebGpuPreview } = await import("./gpu/webgpu_preview.js");
    await runWebGpuPreview(searchParams);
    return;
  }
  if (searchParams.get("grassFirstInstanceSmoke") === "1") {
    const { runGrassFirstInstanceSmoke } = await import("./gpu/grass_first_instance_smoke.js");
    await runGrassFirstInstanceSmoke();
    return;
  }
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
    const lvStats: import("./core/hooks.js").EngineStats = {
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

  const weatherParam = searchParams.get("weather");
  const queryWeatherMode: WeatherMode = searchParams.get("sandstorm") === "1" || searchParams.get("sand") === "1" || weatherParam === "sandstorm" || weatherParam === "sand"
    ? "sandstorm"
    : searchParams.get("snow") === "1" || weatherParam === "snow"
    ? "snow"
    : searchParams.get("rain") === "1" || weatherParam === "rain"
      ? "rain"
      : "off";
  const weatherDefaults = queryWeatherMode === "sandstorm"
    ? DEFAULT_SANDSTORM_WEATHER_SETTINGS
    : queryWeatherMode === "snow"
      ? DEFAULT_SNOW_WEATHER_SETTINGS
      : DEFAULT_RAIN_WEATHER_SETTINGS;
  const weatherIntensityParam = searchParams.get("weatherIntensity")
    ?? (queryWeatherMode === "sandstorm"
      ? searchParams.get("sandstormIntensity") ?? searchParams.get("sandIntensity")
      : queryWeatherMode === "snow"
        ? searchParams.get("snowIntensity")
        : searchParams.get("rainIntensity"));
  const weatherWindXParam = searchParams.get("weatherWindX")
    ?? (queryWeatherMode === "sandstorm"
      ? searchParams.get("sandstormWindX") ?? searchParams.get("sandWindX")
      : queryWeatherMode === "snow"
        ? searchParams.get("snowWindX")
        : searchParams.get("rainWindX"));
  const weatherWindZParam = searchParams.get("weatherWindZ")
    ?? (queryWeatherMode === "sandstorm"
      ? searchParams.get("sandstormWindZ") ?? searchParams.get("sandWindZ")
      : queryWeatherMode === "snow"
        ? searchParams.get("snowWindZ")
        : searchParams.get("rainWindZ"));
  const queryWeatherIntensity = weatherIntensityParam === null ? Number.NaN : Number(weatherIntensityParam);
  const queryWeatherWindX = weatherWindXParam === null ? Number.NaN : Number(weatherWindXParam);
  const queryWeatherWindZ = weatherWindZParam === null ? Number.NaN : Number(weatherWindZParam);
  const queryTerrainMaterialSource = terrainMaterialSourceParam(searchParams.get("terrainMaterial"));
  const textureMipmapsEnabled = searchParams.get("textureMipmaps") !== "0";
  const textureLoadOptions: TerrainTextureLoadOptions = { textureMipmapsEnabled, maxAnisotropy };
  const queryGrassRingGrid = positiveNumberParam(searchParams.get("grassRingGrid"));
  const queryGrassRingCell = positiveNumberParam(searchParams.get("grassRingCell"));
  const digHoldIntervalMs = clodRuntime.digging.holdIntervalMs;
  const state = {
    clodPerfMode: queryPerfMode,
    webgpuSelection: queryWebGpuSelection,
    materialTiers: queryMaterialTiers,
    thresholdPx: cfg.selection.error_threshold_px,
    enforce21: true,
    freeze: false,
    wireframe: false,
    showBounds: false,
    showSeamPoints: false,
    showCrossLodBorders: false,
    showNodeLabels: false,
    showLockedBorderVertices: false,
    colorByLod: queryPerfMode,
    normalColor: false,
    normalDivergence: false,
    divergenceGain: 8,
    frontSideOnly: false,
    recomputedNormals: false,
    forceMaxLevel: "auto",
    terrainMaterialSource: (queryTerrainMaterialSource ?? "external_pbr") as TerrainMaterialSource,
    proceduralDebugMode: "final" as ProceduralDebugMode,
    proceduralMicroNormals: true,
    textureScale: 1,
    triplanar: !queryPerfMode && searchParams.get("terrainTriplanar") !== "0", // [DEBUG-tdr] isolate triplanar 3x sample cost
    albedo: !queryPerfMode,
    normalMap: false,
    normalIntensity: 1,
    roughness: 0.9,
    metalness: 0,
    textureBlendMode: TEXTURE_BLEND_MODES[1] as TextureBlendMode,
    textureBlendWidth: 6,
    loadedTextureFiles: "none",
    terrainBrightness: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.brightness,
    terrainContrast: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.contrast,
    terrainSaturation: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.saturation,
    terrainWarmth: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.warmth,
    sunAzimuthDeg: DEFAULT_ENVIRONMENT_SETTINGS.sunAzimuthDeg,
    sunElevationDeg: DEFAULT_ENVIRONMENT_SETTINGS.sunElevationDeg,
    sunIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunIntensity,
    skyIntensity: DEFAULT_ENVIRONMENT_SETTINGS.skyIntensity,
    groundIntensity: DEFAULT_ENVIRONMENT_SETTINGS.groundIntensity,
    exposure: DEFAULT_ENVIRONMENT_SETTINGS.exposure,
    horizonSoftness: DEFAULT_ENVIRONMENT_SETTINGS.horizonSoftness,
    sunDiskIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunDiskIntensity,
    sunGlowIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunGlowIntensity,
    hazeIntensity: DEFAULT_ENVIRONMENT_SETTINGS.hazeIntensity,
    postProcessEnabled: queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.enabled,
    postProcessOpacity: DEFAULT_POST_PROCESS_SETTINGS.opacity,
    postProcessExposure: DEFAULT_POST_PROCESS_SETTINGS.exposure,
    postProcessContrast: DEFAULT_POST_PROCESS_SETTINGS.contrast,
    postProcessSaturation: DEFAULT_POST_PROCESS_SETTINGS.saturation,
    postProcessVignette: DEFAULT_POST_PROCESS_SETTINGS.vignette,
    postProcessDebugMode: DEFAULT_POST_PROCESS_SETTINGS.debugMode,
    bubble: false,
    bubbleRadius: cfg.near_field.radius_chunks * cfg.page.chunk_size,
    tintBubble: true,
    digEnabled: true,
    digRadius: 3,
    brushOp: "remove" as BrushOp,
    brushShape: "sphere" as BrushShape,
    brushMaterial: 0,
    brushHeight: 3,
    brushStrength: 1,
    brushFalloff: 0,
    brushFlowMs: digHoldIntervalMs,
    audioEnabled: getAudioState().enabled,
    audioVolume: getAudioState().masterVolume,
    grassEnabled: grassConfig.enabled,
    grassRingDebug: searchParams.get("grassRingDebug") === "1",
    grassShaderMode: grassConfig.shaderMode,
    grassAlphaToCoverage: grassConfig.alphaToCoverage,
    grassNearCrossedQuads: grassConfig.nearCrossedQuads,
    grassDistance: grassConfig.distance,
    grassBladeSpacing: grassConfig.bladeSpacing,
    grassBladeHeight: grassConfig.bladeHeight,
    grassBladeHeightVariation: grassConfig.bladeHeightVariation,
    grassBladeWidth: grassConfig.bladeWidth,
    grassWindStrength: grassConfig.windStrength,
    grassWindSpeed: grassConfig.windSpeed,
    grassSlopeMinY: grassConfig.slopeMinY,
    grassMinHeight: grassConfig.minHeight,
    grassMaxHeight: grassConfig.maxHeight,
    grassMaxBlades: grassConfig.maxBlades,
    grassSeed: grassConfig.seed,
    grassBladeCount: 0,
    grassVisiblePatches: "0/0",
    grassTierSummary: "0/0/0/0",
    grassEdgeSuppressed: 0,
    grassCandidateCount: 0,
    grassPatchRebuildCount: 0,
    grassBuildMs: 0,
    stonesEnabled: stoneConfig.enabled,
    stoneDensity: stoneConfig.density,
    stoneMaxInstances: stoneConfig.maxInstances,
    stoneSeed: stoneConfig.seedSalt,
    stoneShowLarge: true,
    stoneShowMedium: true,
    stoneShowSmall: true,
    stoneTotal: 0,
    stoneClassSummary: "0/0/0",
    stoneVisible: 0,
    treesEnabled: treeConfig.enabled,
    treeDistance: treeConfig.distanceM,
    treeMaxInstances: treeConfig.maxInstances,
    treeDebugColorByLod: treeConfig.render.debugColorByLod,
    treeWindEnabled: treeConfig.wind.enabled,
    treeWindStrength: treeConfig.wind.strength,
    treeWindSpeed: treeConfig.wind.speed,
    treeGustStrength: treeConfig.wind.gustStrength,
    treeTrunkSwayStrength: treeConfig.wind.trunkSwayStrength,
    treeLeafFlutterStrength: treeConfig.wind.leafFlutterStrength,
    treeGpuEnabled: treeConfig.gpu.enabled,
    treeGpuForceCpu: treeConfig.gpu.debugForceCpu,
    treeGpuShowCounts: treeConfig.gpu.debugShowGpuCounts,
    treeTotal: 0 as number | string,
    treeVisiblePatches: "0/0",
    treeLodSummary: "0/0/0/0",
    treeGpuSummary: "disabled",
    understoryEnabled: understoryConfig.enabled,
    understoryDistance: understoryConfig.distanceM,
    understoryMaxInstances: understoryConfig.maxInstances,
    understoryDebugColorByClass: understoryConfig.render.debugColorByClass,
    understoryTotal: 0,
    understoryVisiblePatches: "0/0",
    understoryClassSummary: "0/0/0/0/0/0",
    understoryGpuSummary: "disabled",
    forestLightingEnabled: forestLightingConfig.enabled,
    forestLightingAoStrength: forestLightingConfig.ambientOcclusion.strength,
    forestLightingShadowStrength: forestLightingConfig.shadowProxy.strength,
    forestLightingFogStrength: forestLightingConfig.atmosphere.forestFogStrength,
    forestLightingSunShaftsStrength: forestLightingConfig.atmosphere.sunShaftsStrength,
    forestLightingDebugMode: forestLightingConfig.materialIntegration.debugMode as ForestLightingDebugMode,
    forestLightingStats: "pending",
    profileEnabled: searchParams.get("profile") === "1",
    farShellEnabled: queryFarShell || isLongView,
    farShellRadiusFactor: 1.5,
    farShellHeightBias: 0.6,
    farShellHeightDrop: 2,
    waterEnabled: waterConfig.enabled,
    waterDebugMode: (Object.entries(WATER_DEBUG_MODES).find(([, v]) => v === waterConfig.debug.mode)?.[0] ?? "final") as keyof typeof WATER_DEBUG_MODES,
    waterClipmapTint: waterConfig.debug.clipmapTint,
    waterWireframe: waterConfig.debug.wireframe,
    waterDepthWrite: waterConfig.visual.depthWrite,
    weatherMode: queryWeatherMode,
    weatherIntensity: Number.isFinite(queryWeatherIntensity)
      ? THREE.MathUtils.clamp(queryWeatherIntensity, 0, 1.6)
      : weatherDefaults.intensity,
    weatherWindX: Number.isFinite(queryWeatherWindX) ? queryWeatherWindX : weatherDefaults.windX,
    weatherWindZ: Number.isFinite(queryWeatherWindZ) ? queryWeatherWindZ : weatherDefaults.windZ,
    weatherStats: "off",
  };
  if (stagedImport) Object.assign(state, stagedImport.manifest.state);
  if (isWebGpu) state.normalDivergence = false;
  if (queryPerfMode) {
    state.clodPerfMode = true;
    state.colorByLod = true;
    state.albedo = false;
    state.normalMap = false;
    state.triplanar = false;
    state.terrainMaterialSource = "debug_flat";
    state.proceduralDebugMode = "page LOD";
    state.proceduralMicroNormals = false;
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.bubble = false;
    state.showBounds = false;
    state.showSeamPoints = false;
    state.showCrossLodBorders = false;
    state.showNodeLabels = false;
    state.showLockedBorderVertices = false;
    state.grassEnabled = false;
    state.stonesEnabled = false;
    state.treesEnabled = false;
    state.waterEnabled = false;
    state.weatherMode = "off";
  }
  if (queryGrassPerfScene) {
    state.grassEnabled = true;
    state.grassShaderMode = isWebGpu ? "webgpu-ring-v1" : "terrain-patch-v2";
    state.grassDistance = grassConfig.distance;
    state.grassMaxBlades = grassConfig.maxBlades;
    state.stonesEnabled = false;
    state.treesEnabled = false;
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.showBounds = false;
    state.showSeamPoints = false;
    state.showCrossLodBorders = false;
    state.showNodeLabels = false;
    state.showLockedBorderVertices = false;
  }
  if (queryTreePerfScene) {
    state.grassEnabled = false;
    state.stonesEnabled = false;
    state.treesEnabled = true;
    state.understoryEnabled = searchParams.get("understory") === "1";
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.showBounds = false;
    state.showSeamPoints = false;
    state.showCrossLodBorders = false;
    state.showNodeLabels = false;
    state.showLockedBorderVertices = false;
  }
  if (queryForestFloorScene) {
    state.grassEnabled = true;
    state.stonesEnabled = false;
    state.treesEnabled = true;
    state.understoryEnabled = true;
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.showBounds = false;
    state.showSeamPoints = false;
    state.showCrossLodBorders = false;
    state.showNodeLabels = false;
    state.showLockedBorderVertices = false;
  }
  if (searchParams.get("stones") === "1") state.stonesEnabled = true;
  if (searchParams.get("stones") === "0") state.stonesEnabled = false;
  if (searchParams.get("grass") === "1") state.grassEnabled = true;
  if (searchParams.get("grass") === "0") state.grassEnabled = false;
  if (searchParams.get("trees") === "1") state.treesEnabled = true;
  if (searchParams.get("trees") === "0") state.treesEnabled = false;
  if (queryTreeGpuRing) {
    state.treesEnabled = true;
    state.treeGpuEnabled = true;
  }
  if (searchParams.get("understory") === "1") state.understoryEnabled = true;
  if (searchParams.get("understory") === "0") state.understoryEnabled = false;
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
  let refreshTerraformSwatches: () => void = () => {};
  let syncTerraformMenu: () => void = () => {};
  let resetPlayerInput: () => void = () => {};
  let updatePlayerModeUi: () => void = () => {};
  let refreshGrassStats: () => void = () => {};
  let refreshTreeStats: () => void = () => {};
  let refreshUnderstoryStats: () => void = () => {};

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
    onTexturesApplied: () => refreshTerraformSwatches(),
    onColorByLodChanged: () => {},
    getColorByLodUserOverride: () => colorByLodUserOverride,
    setColorByLodUserOverride: (value) => { colorByLodUserOverride = value; },
    getColorByLodController: () => colorByLodController,
  });
  const applyTerrainTextures = () => materialController.applyTerrainTextures();
  const applyColorByLodToMaterials = (on: boolean) => materialController.applyColorByLodToMaterials(on);
  const activeTerrainSlots = () => materialController.activeTerrainSlots();

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
  const P = cfg.page.chunks_per_page;
  // Max bubble pages whose raw chunk groups (P^2 meshChunk each) we build per frame. Caps the
  // walk spike from many pages entering the bubble at once; un-built pages keep their welded
  // LOD0 page mesh visible meanwhile, so it's a latency/seamlessness trade, not a visual gap.
  const chunkGroupBuildBudget = clodRuntime.nearField.chunkGroupBuildBudget;
  // Opt-in (?gpuMesh=1): mesh bubble chunks on WebGPU compute (gpu_chunk_mesher) instead of CPU
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
  const chunkGroups = new Map<
    string,
    { group: THREE.Group; mats: TerrainMaterialHandle[]; unsubs: Array<() => void>; ready: boolean }
  >();
  const buildChunkMaterial = (): TerrainMaterialHandle => {
    const mat = materialController.makeTerrainMaterial(state.tintBubble ? 0xc94b4b : 0xffffff);
    materialController.configureChunkMaterial(mat);
    return mat;
  };
  const addChunkMesh = (
    group: THREE.Group,
    mats: TerrainMaterialHandle[],
    unsubs: Array<() => void>,
    cm: PageMesh,
  ) => {
    const mat = buildChunkMaterial();
    const mesh = new THREE.Mesh(toGeometry(cm), mat.material);
    unsubs.push(mat.onMaterialChanged((material) => {
      mesh.material = material;
    }));
    group.add(mesh);
    mats.push(mat);
  };
  const ensureChunkGroup = (node: ClodPageNode) => {
    const existing = chunkGroups.get(node.id);
    if (existing) return existing;
    const [px, pz] = node.id.slice(3).split(",").map(Number);
    const group = new THREE.Group();
    const mats: TerrainMaterialHandle[] = [];
    const unsubs: Array<() => void> = [];

    if (gpuMesher) {
      // GPU path: dispatch P^2 chunk meshes async; the group stays hidden until all resolve.
      const mesher = gpuMesher;
      const entry = { group, mats, unsubs, ready: false };
      group.visible = false;
      scene.add(group);
      chunkGroups.set(node.id, entry);
      const edits = resolveDigEdits(getDigEditsSnapshot());
      let pending = P * P;
      const settle = () => { if (--pending === 0) entry.ready = true; };
      for (let dz = 0; dz < P; dz++) {
        for (let dx = 0; dx < P; dx++) {
          mesher.meshChunk(px * P + dx, pz * P + dz, worldBounds, edits)
            .then((cm) => {
              // Bail if a dig (applyNodeMesh) replaced this group while meshing.
              if (chunkGroups.get(node.id) !== entry) return;
              if (cm.indices.length > 0) addChunkMesh(group, mats, unsubs, cm);
              settle();
            })
            .catch(() => settle());
        }
      }
      return entry;
    }

    // CPU path (default): synchronous build, ready immediately.
    for (let dz = 0; dz < P; dz++) {
      for (let dx = 0; dx < P; dx++) {
        addChunkMesh(group, mats, unsubs, meshChunk(px * P + dx, pz * P + dz, cfg, worldBounds));
      }
    }
    scene.add(group);
    const entry = { group, mats, unsubs, ready: true };
    chunkGroups.set(node.id, entry);
    return entry;
  };

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

  let averageFps = 0;
  // Phase 0: Rolling frame-time buffer for p95/p99 computation.
  const phase0FrameMsBuffer: number[] = [];
  const PHASE0_P95_WINDOW = 120;
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
    resetPlayerInput: () => resetPlayerInput(),
    setControlsEnabled: (enabled) => { controls.enabled = enabled; },
    setControlsTarget: (x, y, z) => { controls.target.set(x, y, z); },
    setCameraPosition: (x, y, z) => { camera.position.set(x, y, z); },
    cameraLookAt: (x, y, z) => { camera.lookAt(x, y, z); },
    controlsUpdate: () => { controls.update(); },
    updatePlayerModeUi: () => updatePlayerModeUi(),
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
      `threshold: ${state.thresholdPx.toFixed(2)} px   avg FPS: ${averageFps.toFixed(1)}   ` +
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
    const chunkEntry = chunkGroups.get(node.id);
    if (chunkEntry) {
      scene.remove(chunkEntry.group);
      for (const child of chunkEntry.group.children) (child as THREE.Mesh).geometry.dispose();
      for (const unsub of chunkEntry.unsubs) unsub();
      for (const m of chunkEntry.mats) {
        // Never dispose the shared pooled material (still used by every other terrain mesh).
        if (m === materialController.sharedMaterial) continue;
        materialController.materials.delete(m);
        m.material.dispose();
      }
      chunkGroups.delete(node.id);
    }
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
    refreshGrassStats,
    refreshTreeStats,
    refreshUnderstoryStats,
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
        syncTerraformMenu();
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
    resetPlayerInput = () => playerInputController.resetPlayerInput();
    updatePlayerModeUi = () => playerModeController.updatePlayerModeUi();
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
        refreshGrassStats();
      },
      markTreesDirty: () => {
        treeController.markPatchesDirty();
        refreshTreeStats();
      },
      markUnderstoryDirty: () => {
        understoryController.markPatchesDirty();
        refreshUnderstoryStats();
      },
    });
  };

  updateLighting();
  updateSelection();

  const fpsSamples: number[] = [];
  let lastFrameAt = performance.now();
  let lastFpsRefreshAt = lastFrameAt;
  const updateAverageFps = () => {
    const now = performance.now();
    const dt = now - lastFrameAt;
    lastFrameAt = now;
    if (dt <= 0) return;

    fpsSamples.push(1000 / dt);
    if (fpsSamples.length > 120) fpsSamples.shift();
    averageFps = fpsSamples.reduce((sum, fps) => sum + fps, 0) / fpsSamples.length;

    if (now - lastFpsRefreshAt >= 250) {
      lastFpsRefreshAt = now;
      updateInfo();
    }
  };

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
  refreshGrassStats = guiResult.refreshGrassStats;
  refreshTreeStats = guiResult.refreshTreeStats;
  refreshUnderstoryStats = guiResult.refreshUnderstoryStats;
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
      chunkGroups: chunkGroups.values(),
    },
  });
  digRadiusController = digRadiusGuiController;

  wirePlayerControllers();

  // ---- bottom-left terraform menu: material palette + optional brush/sculpt edit ----
  // Material swatches map to terrain texture slots 0..3 (what `add` deposits paint with);
  // brush controls drive the same global state the click handlers and preview read.
  const terraformMenu = document.getElementById("terraform-menu")!;
  const menuHeader = document.createElement("div");
  menuHeader.className = "tf-menu-header";
  const paletteSection = document.createElement("div");
  paletteSection.className = "tf-palette";
  const editToggle = document.createElement("label");
  editToggle.className = "tf-edit-toggle";
  editToggle.title = "Show brush and sculpt controls";
  const editToggleInput = document.createElement("input");
  editToggleInput.type = "checkbox";
  editToggleInput.checked = true;
  terraformEditCheckbox = editToggleInput;
  playerModeController.bindTerraformEditCheckbox(editToggleInput);
  playerModeController.bindEditToggleInput(editToggleInput);
  editToggle.append(editToggleInput, document.createTextNode(" Edit"));
  editToggleInput.addEventListener("change", () => {
    document.body.dataset.tfEdit = editToggleInput.checked ? "true" : "false";
    if (!editToggleInput.checked) {
      playerInputController.clearDigHold();
      brushPreview.hide();
    }
    playerModeController.updatePlayerModeUi();
  });
  menuHeader.appendChild(editToggle);
  terraformMenu.appendChild(menuHeader);
  terraformMenu.appendChild(paletteSection);
  const editSection = document.createElement("div");
  editSection.className = "tf-edit-section";
  terraformMenu.appendChild(editSection);
  document.body.dataset.tfEdit = "true";

  const makeRow = (label: string, parent: HTMLElement = terraformMenu) => {
    const row = document.createElement("div");
    row.className = "tf-row";
    const tag = document.createElement("span");
    tag.className = "tf-label";
    tag.textContent = label;
    row.appendChild(tag);
    parent.appendChild(row);
    return row;
  };

  const materialRow = makeRow("Material", paletteSection);
  materialRow.classList.add("tf-row-material");
  let materialSwatchPage = 0;
  const materialCarousel = document.createElement("div");
  materialCarousel.className = "tf-material-carousel";
  const carouselPrev = document.createElement("button");
  carouselPrev.type = "button";
  carouselPrev.className = "tf-carousel-nav tf-carousel-prev";
  carouselPrev.setAttribute("aria-label", "Previous materials");
  carouselPrev.textContent = "‹";
  const materialSwatches = document.createElement("div");
  materialSwatches.className = "tf-material-swatches";
  const carouselNext = document.createElement("button");
  carouselNext.type = "button";
  carouselNext.className = "tf-carousel-nav tf-carousel-next";
  carouselNext.setAttribute("aria-label", "Next materials");
  carouselNext.textContent = "›";
  materialCarousel.append(carouselPrev, materialSwatches, carouselNext);
  materialRow.appendChild(materialCarousel);
  const swatchButtons: HTMLButtonElement[] = [];
  const ensureSwatchButton = (index: number) => {
    while (swatchButtons.length <= index) {
      const slotIndex = swatchButtons.length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tf-swatch";
      const name = document.createElement("span");
      btn.appendChild(name);
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        state.brushMaterial = slotIndex;
        refreshTerraformSwatches();
      });
      swatchButtons.push(btn);
      materialSwatches.appendChild(btn);
    }
  };
  const syncMaterialCarousel = () => {
    const count = activeTerrainSlots().length;
    const bounds = materialCarouselBounds(count, materialSwatchPage);
    materialSwatchPage = bounds.page;
    materialCarousel.classList.toggle("tf-material-carousel-active", bounds.needsCarousel);
    carouselPrev.disabled = bounds.page <= 0;
    carouselNext.disabled = bounds.page >= bounds.maxPage;
    for (let i = 0; i < swatchButtons.length; i++) {
      const visible = i < count && (!bounds.needsCarousel || (i >= bounds.start && i < bounds.end));
      swatchButtons[i].style.display = visible ? "" : "none";
    }
  };
  carouselPrev.addEventListener("click", () => {
    materialSwatchPage = Math.max(0, materialSwatchPage - 1);
    syncMaterialCarousel();
  });
  carouselNext.addEventListener("click", () => {
    const { maxPage } = materialCarouselBounds(activeTerrainSlots().length, materialSwatchPage);
    materialSwatchPage = Math.min(maxPage, materialSwatchPage + 1);
    syncMaterialCarousel();
  });

  const makeToggleGroup = <T extends string>(
    row: HTMLElement,
    options: { value: T; label: string; icon?: readonly [ClodIconKind, string] }[],
    get: () => T,
    set: (v: T) => void,
  ) => {
    const buttons = options.map(({ value, label, icon }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (icon) {
        const [kind, id] = icon;
        setButtonIcon(btn, kind, id, label);
      }
      btn.addEventListener("click", () => {
        set(value);
        sync();
        emitAudio("terrain.tool.select");
      });
      row.appendChild(btn);
      return { value, btn };
    });
    const sync = () => {
      for (const { value, btn } of buttons) btn.setAttribute("aria-pressed", String(get() === value));
    };
    sync();
    return sync;
  };

  // Brush row: size slider on the left, then op + shape toggles.
  const brushRow = makeRow("Brush", editSection);
  const sizeWrap = document.createElement("div");
  sizeWrap.className = "tf-size";
  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.min = "1"; sizeInput.max = "8"; sizeInput.step = "0.5";
  sizeInput.value = String(state.digRadius);
  const sizeOut = document.createElement("output");
  sizeOut.textContent = String(state.digRadius);
  sizeInput.addEventListener("input", () => {
    state.digRadius = Number(sizeInput.value);
    sizeOut.textContent = String(state.digRadius);
    digRadiusController.updateDisplay();
    updateInfo();
    emitAudio("terrain.brush.radius");
  });
  sizeWrap.append(sizeInput, sizeOut);
  brushRow.appendChild(sizeWrap);

  const sizeGap = document.createElement("span");
  sizeGap.style.width = "8px";
  brushRow.appendChild(sizeGap);

  const syncOp = makeToggleGroup<BrushOp>(
    brushRow,
    [
      { value: "remove", label: "Dig", icon: ["tool", "dig"] },
      { value: "add", label: "Raise", icon: ["tool", "raise"] },
    ],
    () => state.brushOp,
    (v) => { state.brushOp = v; updateInfo(); },
  );
  const spacer = document.createElement("span");
  spacer.style.width = "6px";
  brushRow.appendChild(spacer);
  makeToggleGroup<BrushShape>(
    brushRow,
    [
      { value: "sphere", label: "Sphere", icon: ["tool", "smooth"] },
      { value: "cube", label: "Cube", icon: ["tool", "lower"] },
      { value: "cylinder", label: "Cyl", icon: ["tool", "paint"] },
    ],
    () => state.brushShape,
    (v) => { state.brushShape = v; },
  );

  // labelled slider (label · range · value); returns its sync fn for external updates
  const makeSlider = (
    parent: HTMLElement,
    label: string,
    min: number, max: number, step: number,
    get: () => number, set: (v: number) => void,
    fmt: (v: number) => string = String,
  ) => {
    const group = document.createElement("div");
    group.className = "tf-slider";
    const lab = document.createElement("span");
    lab.className = "tf-slider-label";
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(get());
    const out = document.createElement("output");
    out.textContent = fmt(get());
    input.addEventListener("input", () => {
      const v = Number(input.value);
      set(v);
      out.textContent = fmt(v);
      updateInfo();
    });
    group.append(lab, input, out);
    parent.appendChild(group);
    return () => { input.value = String(get()); out.textContent = fmt(get()); };
  };

  // sculpt sliders: how hard, how tall, how soft the edge, how fast when held
  const sculptRow = makeRow("Sculpt", editSection);
  sculptRow.classList.add("tf-row-sculpt");
  const syncStrength = makeSlider(
    sculptRow, "Strength", 0, 1, 0.05,
    () => state.brushStrength, (v) => { state.brushStrength = v; }, (v) => v.toFixed(2),
  );
  const syncHeight = makeSlider(
    sculptRow, "Height", 1, 16, 0.5,
    () => state.brushHeight, (v) => { state.brushHeight = v; },
  );
  const syncFalloff = makeSlider(
    sculptRow, "Falloff", 0, 1, 0.05,
    () => state.brushFalloff, (v) => { state.brushFalloff = v; }, (v) => v.toFixed(2),
  );
  const syncFlow = makeSlider(
    sculptRow, "Flow", 80, 600, 20,
    () => state.brushFlowMs, (v) => { state.brushFlowMs = v; }, (v) => `${v}ms`,
  );

  refreshTerraformSwatches = () => {
    const slots = activeTerrainSlots();
    if (state.brushMaterial >= slots.length) state.brushMaterial = 0;
    materialSwatchPage = materialCarouselPageForSelection(
      state.brushMaterial,
      materialSwatchPage,
      slots.length,
    );
    for (let i = 0; i < slots.length; i++) {
      ensureSwatchButton(i);
      const btn = swatchButtons[i];
      const slot = slots[i];
      const label = btn.firstChild as HTMLSpanElement;
      btn.disabled = state.terrainMaterialSource === "external_pbr" && !slot.texture;
      btn.style.backgroundImage = slot.previewUrl ? `url("${slot.previewUrl}")` : "";
      btn.style.backgroundColor = slot.previewUrl ? "transparent" : PAINT_SWATCH_COLORS[i % PAINT_SWATCH_COLORS.length];
      const displayName = slot.name && slot.name !== "empty" ? slot.name : terrainTextureSlotLabel(i);
      label.textContent = displayName;
      btn.title = displayName;
      btn.setAttribute("aria-pressed", String(state.brushMaterial === i && !btn.disabled));
    }
    syncMaterialCarousel();
  };
  // keep the slider/op in sync if state changes elsewhere (e.g. Shift+wheel radius)
  syncTerraformMenu = () => {
    sizeInput.value = String(state.digRadius);
    sizeOut.textContent = String(state.digRadius);
    syncOp();
    syncStrength(); syncHeight(); syncFalloff(); syncFlow();
  };
  refreshTerraformSwatches();

  const currentProjectState = (): ProjectSessionState => ({
    thresholdPx: state.thresholdPx,
    enforce21: state.enforce21,
    freeze: state.freeze,
    wireframe: state.wireframe,
    showBounds: state.showBounds,
    showSeamPoints: state.showSeamPoints,
    showCrossLodBorders: state.showCrossLodBorders,
    colorByLod: state.colorByLod,
    normalColor: state.normalColor,
    normalDivergence: state.normalDivergence,
    divergenceGain: state.divergenceGain,
    frontSideOnly: state.frontSideOnly,
    recomputedNormals: state.recomputedNormals,
    forceMaxLevel: state.forceMaxLevel as ProjectSessionState["forceMaxLevel"],
    textureScale: state.textureScale,
    triplanar: state.triplanar,
    albedo: state.albedo,
    normalMap: state.normalMap,
    normalIntensity: state.normalIntensity,
    roughness: state.roughness,
    metalness: state.metalness,
    textureBlendMode: state.textureBlendMode,
    textureBlendWidth: state.textureBlendWidth,
    terrainBrightness: state.terrainBrightness,
    terrainContrast: state.terrainContrast,
    terrainSaturation: state.terrainSaturation,
    terrainWarmth: state.terrainWarmth,
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
    postProcessEnabled: state.postProcessEnabled,
    postProcessOpacity: state.postProcessOpacity,
    postProcessExposure: state.postProcessExposure,
    postProcessContrast: state.postProcessContrast,
    postProcessSaturation: state.postProcessSaturation,
    postProcessVignette: state.postProcessVignette,
    postProcessDebugMode: state.postProcessDebugMode,
    bubble: state.bubble,
    bubbleRadius: state.bubbleRadius,
    tintBubble: state.tintBubble,
    digEnabled: state.digEnabled,
    digRadius: state.digRadius,
    brushOp: state.brushOp,
    brushShape: state.brushShape,
    brushMaterial: state.brushMaterial,
    brushHeight: state.brushHeight,
    brushStrength: state.brushStrength,
    brushFalloff: state.brushFalloff,
    brushFlowMs: state.brushFlowMs,
    grassEnabled: state.grassEnabled,
    grassShaderMode: state.grassShaderMode,
    grassAlphaToCoverage: state.grassAlphaToCoverage,
    grassDistance: state.grassDistance,
    grassBladeSpacing: state.grassBladeSpacing,
    grassBladeHeight: state.grassBladeHeight,
    grassBladeHeightVariation: state.grassBladeHeightVariation,
    grassBladeWidth: state.grassBladeWidth,
    grassWindStrength: state.grassWindStrength,
    grassWindSpeed: state.grassWindSpeed,
    grassSlopeMinY: state.grassSlopeMinY,
    grassMinHeight: state.grassMinHeight,
    grassMaxHeight: state.grassMaxHeight,
    grassMaxBlades: state.grassMaxBlades,
    grassSeed: state.grassSeed,
    treesEnabled: state.treesEnabled,
    treeDistance: state.treeDistance,
    treeMaxInstances: state.treeMaxInstances,
    treeDebugColorByLod: state.treeDebugColorByLod,
    treeWindEnabled: state.treeWindEnabled,
    treeWindStrength: state.treeWindStrength,
    treeWindSpeed: state.treeWindSpeed,
    treeGustStrength: state.treeGustStrength,
    treeTrunkSwayStrength: state.treeTrunkSwayStrength,
    treeLeafFlutterStrength: state.treeLeafFlutterStrength,
  });

  const setProjectBusy = (busy: boolean, phase = "preparing", fraction = 0) => {
    importButton.disabled = busy;
    exportButton.disabled = busy;
    buildProgress.hidden = !busy;
    buildProgressPhase.textContent = phase;
    buildProgressPercent.textContent = `${Math.round(fraction * 100)}%`;
    buildProgressBar.value = fraction;
    buildStatus = busy ? phase : "ready";
    updateClodOverlay(currentOverlaySnapshot());
  };

  const showProjectError = (operation: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    lastArchiveSummary = `${operation} failed: ${message}`;
    updateInfo();
    window.alert(`${operation} failed\n\n${message}`);
  };

  const validateArchiveTextures = async (contents: ProjectArchiveContents) => {
    for (const slot of contents.manifest.textures) {
      if (slot.source === "builtin" && !BUILTIN_TERRAIN_TEXTURES.some((texture) => texture.id === slot.selectedId)) {
        throw new Error(`project.json references unknown built-in texture ${slot.selectedId}`);
      }
      if (slot.source !== "custom" || !slot.customPath) continue;
      const bytes = contents.customTextures.get(slot.customPath);
      if (!bytes) throw new Error(`The archive is missing ${slot.customPath}`);
      const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
        type: slot.mimeType ?? "application/octet-stream",
      });
      const previewUrl = URL.createObjectURL(blob);
      try {
        await new Promise<void>((resolve, reject) => {
          const image = new Image();
          const timeout = window.setTimeout(() => reject(new Error("image decode timed out")), 5_000);
          image.onload = () => {
            window.clearTimeout(timeout);
            resolve();
          };
          image.onerror = () => {
            window.clearTimeout(timeout);
            reject(new Error("image decode failed"));
          };
          image.src = previewUrl;
        });
      } catch {
        throw new Error(`Custom texture ${slot.name} is not a decodable image`);
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
    }
  };

  importButton.addEventListener("click", () => {
    emitAudio("project.import.open");
    projectImportInput.click();
  });
  projectImportInput.addEventListener("change", async () => {
    const file = projectImportInput.files?.[0];
    projectImportInput.value = "";
    if (!file) return;
    try {
      setProjectBusy(true, "validating project archive", 0.2);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const contents = await parseProjectArchive(new Uint8Array(await file.arrayBuffer()));
      await validateArchiveTextures(contents);
      setProjectBusy(true, "staging project for rebuild", 0.65);
      const token = await stageProjectImport(contents);
      emitAudio("project.import.success");
      const next = new URLSearchParams(location.search);
      next.set("world", String(contents.manifest.worldSize));
      next.set("import", token);
      location.search = `?${next.toString()}`;
    } catch (error) {
      emitAudio("project.import.error");
      setProjectBusy(false);
      showProjectError("Project import", error);
    }
  });

  exportButton.addEventListener("click", async () => {
    const startedAt = performance.now();
    try {
      setProjectBusy(true, "settling edited LODs", 0.05);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await flushAncestors();
      setProjectBusy(true, "exporting all LOD meshes", 0.25);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const { exportAllLodsToGlb } = await import("./gltf_export.js");
      const terrainGlb = await exportAllLodsToGlb(result.nodesByLevel);
      setProjectBusy(true, "packing project archive", 0.8);
      const textures = textureController.projectTextureMetadata();
      const customTextures = new Map<string, Uint8Array>();
      for (const texture of textures) {
        if (texture.source === "custom" && texture.customPath) {
          const bytes = textureController.slots[texture.index].customBytes;
          if (!bytes) throw new Error(`Custom texture slot ${texture.index} has no source bytes`);
          customTextures.set(texture.customPath, bytes);
        }
        if (texture.normalPath) {
          const bytes = textureController.slots[texture.index].normalBytes;
          if (!bytes) throw new Error(`Normal-map slot ${texture.index} has no source bytes`);
          customTextures.set(texture.normalPath, bytes);
        }
      }
      const manifest: ClodProjectManifestV1 = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        kind: "drusniel-clod-project",
        exportedAt: new Date().toISOString(),
        worldSize: WORLD,
        config: structuredClone(cfg),
        state: currentProjectState(),
        terrainEdits: getDigEditsSnapshot(),
        textures,
        camera: {
          position: camera.position.toArray() as [number, number, number],
          target: controls.target.toArray() as [number, number, number],
        },
      };
      const archive = await createProjectArchive(manifest, terrainGlb, customTextures);
      setProjectBusy(true, "downloading project", 1);
      const url = URL.createObjectURL(new Blob([new Uint8Array(archive).buffer as ArrayBuffer], { type: "application/zip" }));
      const link = document.createElement("a");
      const stamp = manifest.exportedAt.replace(/[:.]/g, "-");
      link.href = url;
      link.download = `drusniel-clod-world-${WORLD}-${stamp}.zip`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const elapsed = performance.now() - startedAt;
      lastArchiveSummary = `export: ${(archive.byteLength / 1048576).toFixed(1)} MiB in ${(elapsed / 1000).toFixed(2)}s`;
      console.info(`[project export] ${lastArchiveSummary}; GLB ${(terrainGlb.byteLength / 1048576).toFixed(1)} MiB`);
      updateInfo();
      emitAudio("project.export.success");
    } catch (error) {
      emitAudio("project.export.error");
      showProjectError("Project export", error);
    } finally {
      setProjectBusy(false);
    }
  });

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
  refreshGrassStats();
  treeSystem.setEnabled(state.treesEnabled);
  treeController.applySettings();
  refreshTreeStats();
  understorySystem.setEnabled(state.understoryEnabled);
  understoryController.applySettings();
  refreshUnderstoryStats();
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

  let elapsedSeconds = 0;
  // ?profile=1 (or the "profiling" gui toggle → state.profileEnabled) logs a per-phase
  // breakdown for any frame slower than profileFrameMs. Helps locate transient zoom/walk
  // stutters (chunk meshing, geometry upload, render/pipeline stalls).
  const grassProfileEnabled = searchParams.get("grassProfile") === "1";
  const grassPrepassEnabled = searchParams.get("prepass") !== "0";
  let grassProfileFrame = 0;
  const grassProfileMs = (value: number | null): string => value === null ? "-" : `${value.toFixed(2)}ms`;
  const logGrassProfile = (stats: GrassStats, grassAndPropsMs: number): void => {
    if (!grassProfileEnabled) return;
    const settings = makeGrassSettings();
    const visible = stats.gpuRingVisibleNear
      + stats.gpuRingVisibleMid
      + stats.gpuRingVisibleFar
      + stats.gpuRingVisibleSuper;
    // eslint-disable-next-line no-console
    console.info(
      `[grass-profile] mode=${stats.mode}` +
        ` dispatch=${grassProfileMs(stats.gpuRingDispatchMs)}` +
        ` readback=${grassProfileMs(stats.gpuRingReadbackMs)}` +
        ` visible=${visible}` +
        ` near=${stats.gpuRingVisibleNear}` +
        ` mid=${stats.gpuRingVisibleMid}` +
        ` far=${stats.gpuRingVisibleFar}` +
        ` super=${stats.gpuRingVisibleSuper}` +
        ` prepass=${grassPrepassEnabled ? "on" : "off"}` +
        ` grid=${settings.ring.grid}` +
        ` cell=${settings.ring.cell}` +
        ` slots=${settings.ring.grid * settings.ring.grid}` +
        ` grass+props=${grassAndPropsMs.toFixed(2)}ms`,
    );
  };
  const profileFrameMs = resolveSlowFrameMsThreshold(searchParams, clodRuntime.profiling.slowFrameMs);
  const submitMsChanged = (a: number | null, b: number | null): boolean =>
    a === b ? false : a === null || b === null ? true : Math.abs(a - b) >= 0.05;
  renderer.setAnimationLoop(() => {
    const frameStart = performance.now();
    selectionController.advanceFrame();
    const selectionStats = selectionController.stats();
    const activeTerrainViews = selectionController.activeTerrainViews();
    const currentTerrainViews = selectionController.currentTerrainViews();
    playerInputController.playerTimer.update();
    const playerDelta = Math.min(playerInputController.playerTimer.getDelta(), 0.1);
    elapsedSeconds += playerDelta;
    updateAverageFps();
    playerInputController.updateFrame(playerDelta);
    skyEnvironment?.updateCamera(camera);
    drainVegetationDirtyQueue();
    treeController.updateFallingTrees(playerDelta);
    if (!state.freeze) updateSelection();

    // LV-0: Emit long-view counters into hooks.stats for the shot harness / QA.
    if (longViewHooks?.stats) {
      const s = longViewHooks.stats;
      s.fps = averageFps;
      s.frameMs = performance.now() - frameStart;
      s.frame++;
      const info = renderer.info as unknown as { render: { drawCalls?: number; triangles?: number } };
      s.drawCalls = info.render.drawCalls ?? 0;
      s.triangles = info.render.triangles ?? 0;
      for (let lvl = 0; lvl <= maxTerrainLevel; lvl++) {
        s.counters[`built_page_count_lod${lvl}`] = selectionStats.nodesByLod[lvl] ?? 0;
      }
      s.counters["terrain_draw_calls"] = selectionStats.renderedCount;
      s.counters["terrain_triangles"] = selectionStats.triCount;
      // LV-5: Vegetation ring stats for long-view validation.
      if (grassStats) {
        s.counters["gpu_grass_visible"] = grassStats.gpuRingVisibleNear + grassStats.gpuRingVisibleMid
          + grassStats.gpuRingVisibleFar + grassStats.gpuRingVisibleSuper;
        s.counters["gpu_grass_dispatch_ms"] = grassStats.gpuRingDispatchMs ?? 0;
      }
      if (treeStats) {
        s.counters["gpu_tree_visible"] = treeStats.gpuVisibleCount;
        s.counters["gpu_tree_dispatch_ms"] = treeStats.gpuDispatchMs ?? 0;
      }
      if (stoneStats) {
        s.counters["gpu_stone_visible"] = stoneStats.visible;
        s.counters["gpu_stone_drawn_near"] = stoneStats.drawnNear;
        s.counters["gpu_stone_drawn_far"] = stoneStats.drawnFar;
      }

      // Phase 0: Update additional counters for infinite streaming baseline.
      const effectiveVisible = computeEffectiveVisibleMeters({
        worldCells,
        farShellEnabled: farShellController.isBuilt(),
        farShellRadiusM: worldCells * state.farShellRadiusFactor,
      });
      s.counters["effective_far_radius_m"] = worldCells * state.farShellRadiusFactor;
      s.counters["effective_visible_m"] = effectiveVisible;
      s.counters["visible_target_met"] = computeVisibleTargetMet({
        effectiveVisibleM: effectiveVisible,
        targetVisibleM: phase0TargetVisibleM,
      }) ? 1 : 0;
      s.counters["far_shell_enabled"] = farShellController.isBuilt() ? 1 : 0;
      s.counters["far_shell_radius_m"] = worldCells * state.farShellRadiusFactor;
      s.counters["far_shell_grid_res"] = 128;
      s.counters["shadow_proxy_enabled"] = isLongView ? 1 : 0;
      s.counters["shadow_proxy_inert"] = 1;
      s.counters["canopy_enabled"] = farShellController.canopyShell !== null ? 1 : 0;
      // rendered_page_count_lod* mirrors the rendered cut (same as built for now).
      for (let lvl = 0; lvl <= maxTerrainLevel; lvl++) {
        s.counters[`rendered_page_count_lod${lvl}`] = selectionStats.nodesByLod[lvl] ?? 0;
      }
      s.counters["rendered_terrain_tris"] = selectionStats.triCount;
      s.counters["total_scene_tris"] = s.triangles;
      s.counters["draw_calls"] = s.drawCalls;
      s.counters["frame_ms_avg"] = s.fps > 0 ? 1000 / s.fps : 0;
      // Phase 0: Compute p95/p99 from rolling frame-time buffer.
      phase0FrameMsBuffer.push(s.frameMs);
      if (phase0FrameMsBuffer.length > PHASE0_P95_WINDOW) phase0FrameMsBuffer.shift();
      if (phase0FrameMsBuffer.length >= 10) {
        const sorted = [...phase0FrameMsBuffer].sort((a, b) => a - b);
        s.counters["frame_ms_p95"] = sorted[Math.floor(sorted.length * 0.95)] ?? -1;
        s.counters["frame_ms_p99"] = sorted[Math.floor(sorted.length * 0.99)] ?? -1;
      }
      s.counters["horizon_hole_ratio"] = -1; // -1 = no real detector implemented yet
      // Compute streaming coverage simulation using config-derived velocity.
      const streamingReport = simulateStreamingCoverage({
        worldCells,
        chunkSize: cfg.page.chunk_size,
        pageSizeCells: cfg.page.chunks_per_page * cfg.page.chunk_size,
        playerX: camera.position.x,
        playerZ: camera.position.z,
        velocityX: phase0VelocityX,
        velocityZ: phase0VelocityZ,
        preloadSeconds: phase0Streaming.preload_seconds,
        liveRadiusM: phase0Streaming.live_radius_m,
        clodRadiusM: phase0Streaming.clod_radius_m,
      });
      s.counters["streamer_simulated_required_chunks"] = streamingReport.requiredChunkCount;
      s.counters["streamer_simulated_required_pages"] = streamingReport.requiredPageCount;
      s.counters["streamer_simulated_missing_chunks"] = streamingReport.missingChunkCount;
      s.counters["streamer_simulated_missing_pages"] = streamingReport.missingPageCount;

      // Validate required counters from config (fix 2).
      const missingCounters = phase0Config.metrics.required_counters.filter((k) => !(k in s.counters));
      // Export Phase 0 report for tooling.
      window.__drusnielPhase0Report = {
        scene: queryScene ?? "unknown",
        config_hash: "phase0",
        timestamp: new Date().toISOString(),
        metrics: { ...s.counters },
        required_counters_present: missingCounters.length === 0,
        missing_counters: missingCounters,
      };
    }

    playerInputController.updateHoldToDig();

    brushPreview.update({
      digEnabled: state.digEnabled,
      interactionMode: interaction.mode,
      terraformEditActive: playerTerraformEditActive(),
      brushShape: state.brushShape,
      brushOp: state.brushOp,
      digRadius: state.digRadius,
      brushHeight: state.brushHeight,
      raycastEditableTerrain: terrainRaycast.raycastEditableTerrain,
      getPlayingAimRay: () => playerInputController.getPlayingAimRay(),
      getOrbitHoverRay: () => playerInputController.getOrbitHoverRay(),
    });

    // Textured terrain page LOD swaps are atomic. Screen-door fades are visually
    // noisy on terrain, even with complementary masks. Only views entering/leaving the cut
    // need per-frame work; stable visible/hidden pages keep their last material state.
    for (const v of activeTerrainViews) {
      if (pageTransitionMode === "instant") {
        v.fade = v.target;
        v.mesh.visible = v.target > 0.5;
        v.mat.setFade(1, v.target > 0.5, false);
        activeTerrainViews.delete(v);
        continue;
      }

      if (v.fade < v.target) v.fade = Math.min(v.target, v.fade + crossfadeStep);
      else if (v.fade > v.target) v.fade = Math.max(v.target, v.fade - crossfadeStep);
      v.mesh.visible = v.fade > 0.001;
      v.mat.setFade(v.fade, v.target > 0.5, v.fade > 0.001 && v.fade < 0.999);
      if (v.fade === v.target) activeTerrainViews.delete(v);
    }

    const tBubbleStart = performance.now();
    // Near-field bubble: a LOD0 page within the radius is owned by its raw chunks instead.
    // Binary per-page ownership (no overlap band) — both draw the same welded surface.
    let chunkGroupsBuiltThisFrame = 0;
    if (state.bubble) {
      const bubbleViews = new Set([...currentTerrainViews, ...activeTerrainViews]);
      const bubbleCenter = interaction.mode === "playing" ? player.position : controls.target;
      for (const v of bubbleViews) {
        const owned =
          v.node.level === 0 &&
          v.target > 0.5 &&
          Math.hypot(
            bubbleCenter.x - (v.node.footprint.minX + v.node.footprint.maxX) / 2,
            bubbleCenter.z - (v.node.footprint.minZ + v.node.footprint.maxZ) / 2,
          ) < state.bubbleRadius;
        if (owned) {
          // Building a page's raw chunk group is P^2 synchronous meshChunk calls. When walking,
          // many pages cross the bubble edge in one frame; building them all at once is the walk
          // spike. Budget builds per frame and keep showing the welded LOD0 page mesh (same
          // surface) until this page's chunk group is ready, so the swap stays seamless.
          let grp = chunkGroups.get(v.node.id);
          if (!grp) {
            // No group yet — entering the bubble, or a dig just dropped this page's cached chunks
            // (applyNodeMesh). The welded LOD0 page mesh (already rebuilt with the edit) MUST stay
            // visible or the page flashes a hole until its chunk group is rebuilt.
            if (chunkGroupsBuiltThisFrame >= chunkGroupBuildBudget) {
              v.mesh.visible = true;
              continue;
            }
            grp = ensureChunkGroup(v.node);
            chunkGroupsBuiltThisFrame++;
          }
          // Only swap to the raw chunk group once it's fully built (GPU meshing is async); until
          // then keep the welded page mesh visible and the partial group hidden so there's no hole.
          if (grp.ready) {
            v.mesh.visible = false;
            grp.group.visible = true;
          } else {
            v.mesh.visible = true;
            grp.group.visible = false;
          }
        } else {
          // Page left the bubble: hide its raw chunks and restore the welded LOD0 mesh, or the
          // page goes black (it was hidden while the chunks owned it).
          const grp = chunkGroups.get(v.node.id);
          if (grp) grp.group.visible = false;
          v.mesh.visible = v.fade > 0.001;
        }
      }
    } else if (chunkGroups.size > 0) {
      // Bubble turned off: hide every cached chunk group and restore the welded page meshes the
      // bubble had hidden, otherwise the previously-bubbled pages stay black.
      for (const [nodeId, { group }] of chunkGroups) {
        group.visible = false;
        const view = views.get(nodeId);
        if (view) view.mesh.visible = view.fade > 0.001;
      }
    }
    const tPropsStart = performance.now();
    const grassCenter = interaction.mode === "playing" ? player.position : controls.target;
    // LV-5: Clamp ring center to world bounds so GPU vegetation rings produce candidates
    // when the camera is outside the terrain (long-view scenes at 4 km).
    const ringClampMargin = 2;
    const ringCenter = new THREE.Vector3(
      THREE.MathUtils.clamp(grassCenter.x, ringClampMargin, worldCells - ringClampMargin),
      grassCenter.y,
      THREE.MathUtils.clamp(grassCenter.z, ringClampMargin, worldCells - ringClampMargin),
    );
    grassController.update(elapsedSeconds, ringCenter, camera);
    treeController.update(elapsedSeconds, ringCenter, camera);
    understoryController.update(elapsedSeconds, ringCenter, camera);
    forestLightingController.update(elapsedSeconds, grassCenter, {
      treeProxies: treeSystem.getLightingProxies(),
      understoryProxies: understorySystem.getLightingProxies(),
      sunDirection: currentLighting().sunDirection,
    });
    applyForestLightingToPropMaterials();
    stoneController.update(ringCenter);
    // Water follows the camera every frame, independent of state.freeze, so the
    // fake lake/river clipmap keeps tracking the viewer while CLOD pages can be
    // frozen. Updated after camera movement and before the render call below.
    waterController.update(Math.min(playerDelta, 0.1), camera.position);
    weatherController.update(playerDelta, elapsedSeconds, camera.position, grassCenter);
    if (state.weatherMode !== "off" && selectionStats.frameId % 30 === 0) {
      updateWeatherStats();
      weatherStatsController?.updateDisplay();
    }
    waterController.logDevInitOnce(worldCells);
    const nextTreeStats = treeSystem?.getStats();
    if (
      nextTreeStats && (
      !treeStats ||
      nextTreeStats.totalTrees !== treeStats.totalTrees ||
      nextTreeStats.visiblePatches !== treeStats.visiblePatches ||
      nextTreeStats.patches !== treeStats.patches ||
      nextTreeStats.nearTrees !== treeStats.nearTrees ||
      nextTreeStats.midTrees !== treeStats.midTrees ||
      nextTreeStats.farTrees !== treeStats.farTrees ||
      nextTreeStats.impostorTrees !== treeStats.impostorTrees ||
      nextTreeStats.gpuStatus !== treeStats.gpuStatus ||
      nextTreeStats.gpuCandidateCount !== treeStats.gpuCandidateCount ||
      nextTreeStats.gpuAcceptedCount !== treeStats.gpuAcceptedCount ||
      nextTreeStats.gpuVisibleCount !== treeStats.gpuVisibleCount ||
      nextTreeStats.gpuOverflowed !== treeStats.gpuOverflowed)
    ) {
      treeStats = nextTreeStats;
      state.treeTotal = formatTreeTotalDisplay(nextTreeStats);
      state.treeVisiblePatches = `${nextTreeStats.visiblePatches}/${nextTreeStats.patches}`;
      state.treeLodSummary = `${nextTreeStats.nearTrees}/${nextTreeStats.midTrees}/${nextTreeStats.farTrees}/${nextTreeStats.impostorTrees}`;
      state.treeGpuSummary = formatTreeGpuSummary(nextTreeStats);
      treeTotalController?.updateDisplay();
      treeVisiblePatchesController?.updateDisplay();
      treeLodSummaryController?.updateDisplay();
      treeGpuSummaryController?.updateDisplay();
    }
    const nextStoneStats = stoneSystem?.getStats();
    if (nextStoneStats && (!stoneStats || nextStoneStats.total !== stoneStats.total || nextStoneStats.visible !== stoneStats.visible)) {
      stoneStats = nextStoneStats;
      state.stoneTotal = nextStoneStats.total;
      state.stoneClassSummary = `${nextStoneStats.large}/${nextStoneStats.medium}/${nextStoneStats.small}`;
      state.stoneVisible = nextStoneStats.visible;
      stoneTotalController?.updateDisplay();
      stoneClassSummaryController?.updateDisplay();
      stoneVisibleController?.updateDisplay();
    }
    const nextUnderstoryStats = understorySystem?.getStats();
    if (
      nextUnderstoryStats && (
      !understoryStats ||
      nextUnderstoryStats.totalInstances !== understoryStats.totalInstances ||
      nextUnderstoryStats.visiblePatches !== understoryStats.visiblePatches ||
      nextUnderstoryStats.patches !== understoryStats.patches ||
      nextUnderstoryStats.gpuStatus !== understoryStats.gpuStatus ||
      nextUnderstoryStats.gpuVisibleCount !== understoryStats.gpuVisibleCount ||
      nextUnderstoryStats.gpuCandidateCount !== understoryStats.gpuCandidateCount ||
      nextUnderstoryStats.gpuAcceptedCount !== understoryStats.gpuAcceptedCount ||
      nextUnderstoryStats.gpuOverflowed !== understoryStats.gpuOverflowed ||
      submitMsChanged(nextUnderstoryStats.gpuDispatchMs, understoryStats.gpuDispatchMs))
    ) {
      understoryStats = nextUnderstoryStats;
      state.understoryTotal = nextUnderstoryStats.totalInstances;
      state.understoryVisiblePatches = `${nextUnderstoryStats.visiblePatches}/${nextUnderstoryStats.patches}`;
      state.understoryClassSummary =
        `${nextUnderstoryStats.shrub}/${nextUnderstoryStats.fern}/${nextUnderstoryStats.sapling}/${nextUnderstoryStats.flower}/${nextUnderstoryStats.deadLog}/${nextUnderstoryStats.stump}`;
      state.understoryGpuSummary = formatUnderstoryGpuSummary(nextUnderstoryStats);
      understoryTotalController?.updateDisplay();
      understoryVisiblePatchesController?.updateDisplay();
      understoryClassSummaryController?.updateDisplay();
      understoryGpuSummaryController?.updateDisplay();
    }
    const nextForestLightingStats = forestLightingSystem.getStats();
    if (
      !forestLightingStats ||
      nextForestLightingStats.textureUpdates !== forestLightingStats.textureUpdates ||
      nextForestLightingStats.enabled !== forestLightingStats.enabled ||
      nextForestLightingStats.treeProxies !== forestLightingStats.treeProxies ||
      nextForestLightingStats.understoryProxies !== forestLightingStats.understoryProxies
    ) {
      forestLightingStats = nextForestLightingStats;
      state.forestLightingStats = nextForestLightingStats.enabled
        ? `canopy=${nextForestLightingStats.maxCanopy.toFixed(2)} ao=${nextForestLightingStats.maxAo.toFixed(2)} ` +
          `shadow=${nextForestLightingStats.maxShadow.toFixed(2)} fog=${nextForestLightingStats.maxFog.toFixed(2)}`
        : "disabled";
      forestLightingStatsController?.updateDisplay();
    }
    const nextGrassStats = grassSystem?.getStats();
    if (
      nextGrassStats && (
      !grassStats ||
      nextGrassStats.blades !== grassStats.blades ||
      nextGrassStats.visiblePatches !== grassStats.visiblePatches ||
      nextGrassStats.patches !== grassStats.patches ||
      nextGrassStats.nearPatches !== grassStats.nearPatches ||
      nextGrassStats.midPatches !== grassStats.midPatches ||
      nextGrassStats.coveragePatches !== grassStats.coveragePatches ||
      nextGrassStats.superPatches !== grassStats.superPatches ||
      nextGrassStats.gpuRingStatus !== grassStats.gpuRingStatus ||
      nextGrassStats.gpuRingVisibleNear !== grassStats.gpuRingVisibleNear ||
      nextGrassStats.gpuRingVisibleMid !== grassStats.gpuRingVisibleMid ||
      nextGrassStats.gpuRingVisibleFar !== grassStats.gpuRingVisibleFar ||
      nextGrassStats.gpuRingVisibleSuper !== grassStats.gpuRingVisibleSuper ||
      nextGrassStats.edgeSuppressedCandidates !== grassStats.edgeSuppressedCandidates ||
      nextGrassStats.generatedCandidates !== grassStats.generatedCandidates)
    ) {
      grassStats = nextGrassStats;
      state.grassBladeCount = nextGrassStats.blades;
      state.grassVisiblePatches = `${nextGrassStats.visiblePatches}/${nextGrassStats.patches}`;
      state.grassTierSummary = `${nextGrassStats.nearPatches}/${nextGrassStats.midPatches}/${nextGrassStats.coveragePatches}/${nextGrassStats.superPatches}`;
      state.grassEdgeSuppressed = nextGrassStats.edgeSuppressedCandidates;
      state.grassCandidateCount = nextGrassStats.generatedCandidates;
      grassBladeCountController?.updateDisplay();
      grassVisiblePatchesController?.updateDisplay();
      grassTierSummaryController?.updateDisplay();
      grassEdgeSuppressedController?.updateDisplay();
      grassCandidateCountController?.updateDisplay();
    }
    const currentGrassStats = nextGrassStats ?? grassStats;
    nodeLabelOverlay.update({
      nodes: selectionStats.renderedNodes,
      camera,
      viewport: renderer.domElement,
      viewportHeight: renderer.domElement.height,
      fovY: THREE.MathUtils.degToRad(camera.fov),
    });
    postProcess?.updateSettings(currentPostProcessSettings());
    const tRenderStart = performance.now();
    if (grassProfileEnabled && currentGrassStats && grassProfileFrame++ % 60 === 0) {
      logGrassProfile(currentGrassStats, tRenderStart - tPropsStart);
    }
    if (postProcess) postProcess.render(scene, camera);
    else renderer.render(scene, camera);

    // LV-0: Signal ready to the shot harness after the first rendered frame.
    if (longViewHooks && !longViewHooks.ready) {
      longViewHooks.ready = true;
      longViewHooks.progress = 1;
      longViewHooks.progressMsg = "ready";
    }

    // LV-0: Drain settle waiters for the shot harness.
    for (const waiter of longViewSettleWaiters) waiter.frames -= 1;
    const doneWaiters = longViewSettleWaiters.filter((w) => w.frames <= 0);
    for (const waiter of doneWaiters) waiter.resolve();
    for (const waiter of doneWaiters) longViewSettleWaiters.splice(longViewSettleWaiters.indexOf(waiter), 1);

    if (state.profileEnabled) {
      const end = performance.now();
      const frameMs = end - frameStart;
      if (frameMs >= profileFrameMs) {
        const bubbleMs = tPropsStart - tBubbleStart;
        const propsMs = tRenderStart - tPropsStart;
        const renderMs = end - tRenderStart;
        const otherMs = frameMs - selectionStats.selectionMs - bubbleMs - propsMs - renderMs;
        // eslint-disable-next-line no-console
        console.warn(
          `[profile] frame ${frameMs.toFixed(1)}ms` +
            ` | selection ${selectionStats.selectionMs.toFixed(1)}` +
            ` (cut ${selectionStats.subphases.cut.toFixed(1)} book ${selectionStats.subphases.book.toFixed(1)} info ${selectionStats.subphases.info.toFixed(1)} overlays ${selectionStats.subphases.overlays.toFixed(1)})` +
            ` bubble/chunks ${bubbleMs.toFixed(1)} (built ${chunkGroupsBuiltThisFrame})` +
            ` props ${propsMs.toFixed(1)}` +
            ` render ${renderMs.toFixed(1)}` +
            ` other ${otherMs.toFixed(1)}` +
            ` | cut=${selectionStats.renderedCount} chunkGroups=${chunkGroups.size} mode=${interaction.mode}`,
        );
      }
    }
  });

  // Global click & hover feedback for UI elements
  if (typeof window !== "undefined") {
    window.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (!target) return;
      const isInteractive =
        target.tagName === "BUTTON" ||
        target.tagName === "SELECT" ||
        target.tagName === "A" ||
        (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") ||
        target.classList.contains("tf-swatch") ||
        target.classList.contains("texture-preview") ||
        window.getComputedStyle(target).cursor === "pointer";
      if (isInteractive) {
        if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") {
          emitAudio((target as HTMLInputElement).checked ? "ui.toggle.on" : "ui.toggle.off");
        } else {
          emitAudio("ui.click");
        }
      }
    }, { capture: true, passive: true });

    let lastHoveredElement: HTMLElement | null = null;
    window.addEventListener("pointerover", (event) => {
      const target = event.target as HTMLElement;
      if (!target || target === lastHoveredElement) return;
      lastHoveredElement = target;
      const isInteractive =
        target.tagName === "BUTTON" ||
        target.tagName === "SELECT" ||
        target.tagName === "A" ||
        (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") ||
        target.classList.contains("tf-swatch") ||
        target.classList.contains("texture-preview");
      if (isInteractive) {
        emitAudio("ui.hover");
      }
    }, { capture: true, passive: true });
    window.addEventListener("pointerout", () => {
      lastHoveredElement = null;
    }, { capture: true, passive: true });
  }
  window.addEventListener("beforeunload", () => {
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

main().catch((e) => {
  const buildProgress = document.getElementById("build-progress");
  if (buildProgress) buildProgress.hidden = true;
  document.getElementById("info")!.textContent = "build failed: " + (e?.message ?? e);
  console.error(e);
});
