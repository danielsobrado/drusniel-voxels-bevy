import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import { ClodWorkerClient } from "../../clod_worker_client.js";
import { emitAudio } from "../../audio/index.js";
import {
  baseSurfaceHeight,
  getVoxelEditSnapshot,
  replaceVoxelEdits,
  setTerrainFieldConfig,
  setBorderCoastRuntime,
  setVoxelOverlaySource,
  buildCaveTestVoxelOverlay,
  resolveTerrainFieldConfig,
  type BorderCoastOceanConfig,
  type VoxelEditSnapshot,
} from "../../terrain/terrain.js";
import { setTerrainFieldCoreConfig } from "../../gpu/terrain_field_core.js";
import type { WorldManifest } from "../../world/world_manifest.js";
import type { HydrologyGraphArtifact } from "../../world/hydrology_graph/index.js";
import { publishWorldManifestForDiagnostics } from "../../core/hooks.js";
import {
  clearWorkerCacheSnapshot,
} from "../../cache/cacheMetricsBridge.js";
import {
  setCacheSessionDisabled,
} from "../../cache/index.js";
import { lightweightArrayDigest } from "../../cache/terrainSource.js";
import { loadHeightmapSource } from "../../terrain/heightmap_loader.js";
import {
  describeHeightmapSource,
  setHeightmapSource,
  type HeightmapSource,
} from "../../terrain/heightmap_source.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import { createBakedMacroTintTexture } from "../../gpu/terrain_node_baked_macro_tint.js";
import { parseProceduralTextureConfig } from "../../textures/materialRecipes.js";
import { createProceduralTerrainTextures } from "../../textures/terrainTextureArrays.js";
import { parseGrassConfig } from "../../grass.js";
import { parseStoneConfig } from "../../stones/stone_config.js";
import { parseTreeConfig } from "../../trees/index.js";
import { parseUnderstoryConfig } from "../../understory/index.js";
import { parseForestLightingConfig } from "../../forest_lighting/index.js";
import {
  applyRiverParityTestWaterConfig,
  isRiverParityTestScene,
  resolveWaterConfig,
  type HydrologySystem,
  type WaterConfig,
} from "../../water/index.js";
import type { ClodPageNode } from "../../types.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import {
  CONTINENT_SCENE,
  CAVE_TEST_SCENE,
  INFINITE_ISLANDS_SCENE,
  describeWorldMode,
  resolveWorldMode,
  type WorldModeConfig,
} from "../world_mode.js";
import { isLongViewCapableScene } from "./bootstrap_long_view.js";
import { farClipmapRendererAllowed } from "../../terrain/far_clipmap/far_clipmap_config.js";
import { updateClodOverlay } from "../../ui/overlay_panel.js";
import type { CustomPropsSettings } from "../../props/prop_types.js";
import type { PropPlacementScene } from "../../props/prop_types.js";
import { CanonicalWorldSource } from "../../world_source/world_source.js";
import type { WorldSource } from "../../world_source/world_source.js";
import { getSaveRuntimeFeatureStamps } from "../../save/save_runtime.js";
import {
  booleanParam,
  configuredWorldPages,
  measure,
  measureAsync,
  numberParam,
  startupWorldPages,
  type StartupTimings,
} from "./world_build_startup_params.js";
import { parseWorldBuildConfigs } from "./world_build_config_startup.js";
import {
  buildNonContinentStartupHeightfield,
  buildStartupHydrologySystem,
  graphCarveConfigFromWater,
  hydrologyTerrainPayload,
  measureTracedRiverContinuityGate,
  runContinentHydrologyGraphStartup,
  setupTracedHydrologyCarve,
} from "./world_build_hydrology_startup.js";
import {
  assembleTerrainSourceInputs,
  rekeyContinentTerrainSource,
} from "./world_build_terrain_source_startup.js";
import { runWorldBuildCacheWorkerStartup } from "./world_build_cache_worker_startup.js";

export {
  booleanParam,
  numberParam,
  configuredWorldPages,
  startupWorldPages,
  measure,
  measureAsync,
  type StartupTimings,
} from "./world_build_startup_params.js";

export interface WorldBuildStartupInput {
  stagedImport: VoxelProjectArchiveContents | null;
  clodRuntime: ClodRuntimeConfig;
  searchParams: URLSearchParams;
  queryGrassPerfScene: boolean;
  queryTreePerfScene: boolean;
  queryForestFloorScene: boolean;
  queryLongViewScene: boolean;
  queryBorderOceanScene: boolean;
  buildProgress: HTMLElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  info: HTMLElement;
}

export interface WorldBuildResult {
  cfg: ClodPagesConfig;
  stoneConfig: ReturnType<typeof parseStoneConfig>;
  treeConfig: ReturnType<typeof parseTreeConfig>;
  understoryConfig: ReturnType<typeof parseUnderstoryConfig>;
  forestLightingConfig: ReturnType<typeof parseForestLightingConfig>;
  grassConfig: ReturnType<typeof parseGrassConfig>;
  waterConfig: WaterConfig;
  borderCoastOceanConfig: BorderCoastOceanConfig;
  customPropsConfig: CustomPropsSettings;
  propPlacementScenes: Record<string, PropPlacementScene>;
  proceduralTerrain: ReturnType<typeof createProceduralTerrainTextures> | null;
  proceduralTextureConfig: ReturnType<typeof parseProceduralTextureConfig>;
  bakedMacroTint: THREE.DataTexture | null;
  clodWorker: ClodWorkerClient;
  WORLD: number;
  worldCells: number;
  worldSizeCells: number;
  worldMode: WorldModeConfig;
  worldManifest: WorldManifest;
  hydrologyGraphArtifact: HydrologyGraphArtifact | null;
  lod0Nodes: ClodPageNode[];
  allNodes: ClodPageNode[];
  maxTerrainLevel: number;
  terrainSummary: TerrainSummaryField;
  worldSource: WorldSource;
  result: Awaited<ReturnType<ClodWorkerClient["buildWorld"]>>;
  hydrologySystem: HydrologySystem | null;
  /** Far-LOD hydrology carve for traced worlds (channel width floored at the consumer's
   *  cell size); null when the world has no traced carve. */
  farCarveImprint: ((x: number, z: number, height: number, cellSizeM: number) => number) | null;
  polishLine: string;
  buildStatus: { value: string };
}

function importedVoxelSnapshot(stagedImport: VoxelProjectArchiveContents | null): VoxelEditSnapshot {
  if (!stagedImport) return getVoxelEditSnapshot();
  return stagedImport.manifest.voxelTerrainEdits;
}

export async function runWorldBuildStartup(input: WorldBuildStartupInput): Promise<WorldBuildResult> {
  const {
    stagedImport,
    clodRuntime,
    searchParams,
    queryGrassPerfScene,
    queryTreePerfScene,
    queryForestFloorScene,
    queryLongViewScene,
    queryBorderOceanScene,
    buildProgress,
    buildProgressPhase,
    buildProgressPercent,
    buildProgressBar,
    info,
  } = input;

  const sceneName = searchParams.get("scene") ?? "default";
  const startupStartedAt = performance.now();
  const startupTimings: StartupTimings = { "startup.started_at_ms": startupStartedAt };
  window.__drusnielStartupTimings = startupTimings;

  const parsedConfigs = parseWorldBuildConfigs({ stagedImport, searchParams, startupTimings });
  const {
    cfg,
    stoneConfig,
    treeConfig,
    understoryConfig,
    forestLightingConfig,
    grassConfig,
    customPropsConfig,
    propPlacementScenes,
    borderCoastOceanConfig,
    borderOceanSceneConfig,
    proceduralTextureConfig,
  } = parsedConfigs;
  let { waterConfig } = parsedConfigs;
  const seed = numberParam(searchParams, ["seed"]) ?? 0;
  const seaLevel = numberParam(searchParams, ["seaLevel", "sea_level"]) ?? 18;
  // Imported finite-world heightmap (e.g. an Azgaar Fantasy-Map-Generator grayscale export).
  // Vertical mapping defaults put luminance 0.2 (FMG sea level 20/100) at the engine sea level.
  const heightmapUrl = searchParams.get("heightmap");
  const heightmapBaseM = numberParam(searchParams, ["heightmapBaseM"]) ?? 0;
  const heightmapSpanM = numberParam(searchParams, ["heightmapSpanM"]) ?? 90;
  const heightmapDetailM = numberParam(searchParams, ["heightmapDetail"]) ?? 1.2;
  const heightmapFlipZ = booleanParam(searchParams, ["heightmapFlipZ"], false);
  const isInfiniteIslands = sceneName === INFINITE_ISLANDS_SCENE;
  const isContinent = sceneName === CONTINENT_SCENE || sceneName === CAVE_TEST_SCENE;
  const isStreamedWorld = isInfiniteIslands || isContinent;
  const continentHydrologyRequested = isContinent
    && booleanParam(searchParams, ["continentHydrology", "continent_hydrology"], true);
  const terrainFieldConfig = resolveTerrainFieldConfig({
    seed,
    seaLevel,
    islandShape: {
      enabled: booleanParam(searchParams, ["islands"], isInfiniteIslands),
      oceanRim: booleanParam(searchParams, ["oceanRim", "ocean_rim"], isStreamedWorld),
      worldRadiusM: numberParam(searchParams, ["worldRadius", "world_radius_m"]) ?? (isContinent ? 16_384 : 8192),
      spacingM: numberParam(searchParams, ["islandSpacing", "island_spacing_m"]) ?? 1500,
      radiusM: numberParam(searchParams, ["islandRadius", "island_radius_m"]) ?? 560,
      blendM: numberParam(searchParams, ["islandBlend", "island_blend_m"]) ?? 260,
    },
  });
  setTerrainFieldConfig(terrainFieldConfig);
  setTerrainFieldCoreConfig(terrainFieldConfig);
  const worldSource = new CanonicalWorldSource(terrainFieldConfig);
  const clodWorker = new ClodWorkerClient();
  clodWorker.onError = (error) => {
    emitAudio("clod.rebuild.error");
    console.error("[clod worker]", error);
  };

  const configuredWorld = configuredWorldPages(stagedImport, clodRuntime, searchParams, {
    queryGrassPerfScene,
    queryTreePerfScene,
    queryForestFloorScene,
    queryLongViewScene,
    queryBorderOceanScene,
  }, borderOceanSceneConfig.defaultWorldPages);
  const WORLD = startupWorldPages(configuredWorld, stagedImport, clodRuntime, searchParams, sceneName);
  const pageCells = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const worldCells = WORLD * pageCells;
  // Load the imported heightmap now that the finite world extent (worldCells) is known, then
  // install it as the shared CPU-field authority for the main thread; the worker receives the
  // raster in the buildWorld request below. It fully replaces the analytic field and its coast,
  // so the finite border coast is disabled (heightmapEnabled -> borderCoast off).
  let heightmapSource: HeightmapSource | null = null;
  if (heightmapUrl) {
    heightmapSource = await measureAsync(startupTimings, "startup.heightmap_load_ms", () =>
      loadHeightmapSource(heightmapUrl, {
        worldCells,
        baseM: heightmapBaseM,
        spanM: heightmapSpanM,
        flipZ: heightmapFlipZ,
        detailM: heightmapDetailM,
        seed,
      }));
  }
  setHeightmapSource(heightmapSource);
  const heightmapEnabled = heightmapSource !== null;
  const heightmapSourceHash = heightmapSource
    ? `${JSON.stringify(describeHeightmapSource(heightmapSource))}:${await lightweightArrayDigest(heightmapSource.data)}`
    : null;
  const worldMode: WorldModeConfig = resolveWorldMode({
    scene: sceneName,
    searchParams,
    configuredWorldPages: configuredWorld,
    startupWorldPages: WORLD,
    pageCells,
    islandShapeEnabled: terrainFieldConfig.islandShape.enabled,
    borderCoastConfigEnabled: borderCoastOceanConfig.enabled,
    oceanRim: terrainFieldConfig.islandShape.oceanRim,
    worldRadiusM: terrainFieldConfig.islandShape.worldRadiusM,
    longViewCapable: isLongViewCapableScene(sceneName),
    farClipmapRendererAllowed: farClipmapRendererAllowed(searchParams),
    heightmapEnabled,
  });
  window.__drusnielWorldMode = worldMode;
  startupTimings["startup.configured_world_pages"] = configuredWorld;
  startupTimings["startup.world_pages"] = WORLD;
  startupTimings["startup.world_cells"] = worldCells;
  for (const [key, value] of Object.entries(describeWorldMode(worldMode))) {
    if (typeof value === "number") startupTimings[`startup.${key}`] = value;
  }
  startupTimings["acceptance_world_reuse_enabled"] = searchParams.get("acceptance") === "1" ? 1 : 0;
  startupTimings["acceptance_world_reuse_mode"] = numberParam(searchParams, ["acceptanceReuseMode"]) ?? 0;

  let proceduralTerrain: ReturnType<typeof createProceduralTerrainTextures> | null = null;
  let bakedMacroTint: THREE.DataTexture | null = null;
  measure(startupTimings, "startup.procedural_textures_ms", () => {
    proceduralTerrain = proceduralTextureConfig.enabled
      ? createProceduralTerrainTextures(proceduralTextureConfig)
      : null;
    if (proceduralTerrain) {
      const bakeRes = Math.min(512, proceduralTerrain.noise.resolution);
      bakedMacroTint = createBakedMacroTintTexture(
        proceduralTerrain.noise.noiseA,
        proceduralTerrain.noise.noiseB,
        bakeRes,
      );
    }
  });
  if (isRiverParityTestScene(searchParams.get("scene"))) waterConfig = applyRiverParityTestWaterConfig(waterConfig);
  waterConfig = resolveWaterConfig(waterConfig, worldCells);

  // Border coast is a finite-world feature (worldMode.borderCoastEnabled). Infinite islands own
  // their coast via the procedural island field, so the finite rectangular border coast must be
  // disabled — otherwise everything outside the small startup world (worldCells, derived from
  // startupWorld) collapses to a flat sea-level sheet. We pass the disabled config to the runtime,
  // the worker, and the cache key so all three agree.
  const borderCoastActive = worldMode.borderCoastEnabled;
  const effectiveBorderCoast: BorderCoastOceanConfig = borderCoastActive
    ? borderCoastOceanConfig
    : { ...borderCoastOceanConfig, enabled: false };
  setBorderCoastRuntime(borderCoastActive ? effectiveBorderCoast : null, worldCells);

  const buildStatus = { value: "preparing" };
  const updateBuildOverlay = () => updateClodOverlay({
    worldSize: WORLD,
    renderedTriangles: 0,
    nodesByLod: {},
    forcedSplits: 0,
    blockedSplits: 0,
    bubbleForcedSplits: 0,
    cutFrozen: cfg.selection.freeze_selection,
    errorThreshold: cfg.selection.error_threshold_px,
    buildStatus: buildStatus.value,
  });
  updateBuildOverlay();

  const cacheParam = searchParams.get("cache");
  const cacheDisabled = cacheParam === "0" || cacheParam === "false";
  if (cacheDisabled) setCacheSessionDisabled(true);
  clearWorkerCacheSnapshot();

  const voxelSnapshot = importedVoxelSnapshot(stagedImport);
  replaceVoxelEdits(voxelSnapshot);
  const featureStamps = getSaveRuntimeFeatureStamps();

  const {
    unifiedHydrologyRequested,
    tracedCarveConfig,
    tracedCarvedHeight,
    farCarveImprint,
    tracedWorldSampler,
  } = setupTracedHydrologyCarve({ isInfiniteIslands, waterConfig, searchParams });
  let hydrologySystem = buildStartupHydrologySystem({
    continentHydrologyRequested,
    waterConfig,
    worldCells,
    isStreamedWorld,
    unifiedHydrologyRequested,
    tracedCarveConfig,
    tracedCarvedHeight,
    tracedWorldSampler,
    startupTimings,
  });
  const unifiedHydrology = continentHydrologyRequested || hydrologySystem?.unifiedStartupActive() === true;
  startupTimings["startup.hydrology_unified_startup"] = unifiedHydrology ? 1 : 0;
  if (tracedCarveConfig) {
    measureTracedRiverContinuityGate({
      tracedCarveConfig,
      hydrologySystem,
      worldCells,
      waterConfig,
      startupTimings,
    });
  }

  let { heightfieldRasterRequested, heightfieldRasterPlan, startupHeightfield } = buildNonContinentStartupHeightfield({
    unifiedHydrology,
    continentHydrologyRequested,
    searchParams,
    worldCells,
    tracedCarvedHeight,
    startupTimings,
  });

  const hydrologyTerrain = hydrologyTerrainPayload(hydrologySystem, unifiedHydrology);
  const graphCarveConfig = graphCarveConfigFromWater(waterConfig, continentHydrologyRequested);
  let voxelOverlay = sceneName === CAVE_TEST_SCENE ? buildCaveTestVoxelOverlay(baseSurfaceHeight) : null;

  let { terrainSource, acceptanceCacheKey, worldManifest } = await assembleTerrainSourceInputs({
    cfg,
    sceneName,
    seed,
    seaLevel,
    terrainFieldConfig,
    WORLD,
    worldMode,
    hydrologyTerrain,
    startupHeightfield,
    effectiveBorderCoast,
    waterConfig,
    unifiedHydrology,
    proceduralTextureConfig,
    stagedImport,
    voxelSnapshot,
    queryLongViewScene,
    tracedCarveConfig,
    featureStamps,
    voxelOverlay,
    heightmapSourceHash,
  });
  let hydrologyGraphArtifact: HydrologyGraphArtifact | null = null;
  startupTimings["hydrology_graph_present"] = 0;
  startupTimings["hydrology_graph_build_pct"] = 0;
  startupTimings["hydrology_graph_store_hit"] = 0;
  if (continentHydrologyRequested) {
    const continent = await runContinentHydrologyGraphStartup({
      waterConfig,
      worldManifest,
      acceptanceTerrainSourceHash: acceptanceCacheKey.terrainSourceHash,
      seed,
      terrainFieldConfig,
      worldCells,
      heightfieldRasterRequested,
      heightfieldRasterPlan,
      featureStamps,
      sceneName,
      startupHeightfield,
      voxelOverlay,
      graphCarveConfig: graphCarveConfig!,
      buildProgress,
      buildProgressPhase,
      buildProgressPercent,
      buildProgressBar,
      buildStatus,
      updateBuildOverlay,
      startupTimings,
    });
    hydrologyGraphArtifact = continent.hydrologyGraphArtifact;
    startupHeightfield = continent.startupHeightfield;
    hydrologySystem = continent.hydrologySystem;
    voxelOverlay = continent.voxelOverlay;
    const rekeyed = await rekeyContinentTerrainSource({
      cfg,
      terrainSource,
      worldMode,
      terrainFieldConfig,
      seaLevel,
      startupHeightfield,
      hydrologyGraphArtifact,
      graphCarveConfig: graphCarveConfig!,
      voxelOverlay,
    });
    acceptanceCacheKey = rekeyed.acceptanceCacheKey;
    worldManifest = rekeyed.worldManifest;
  }
  terrainSource.worldManifest = worldManifest;
  setVoxelOverlaySource(voxelOverlay);
  startupTimings["world_manifest_present"] = 1;
  startupTimings["world_manifest_seed"] = worldManifest.seed;
  publishWorldManifestForDiagnostics(worldManifest);

  const {
    result,
    lod0Nodes,
    allNodes,
    maxTerrainLevel,
    terrainSummary,
    polishLine,
  } = await runWorldBuildCacheWorkerStartup({
    cfg,
    WORLD,
    worldCells,
    terrainSource,
    clodWorker,
    searchParams,
    voxelSnapshot,
    terrainFieldConfig,
    hydrologyTerrain,
    effectiveBorderCoast,
    startupHeightfield,
    hydrologyGraphArtifact,
    graphCarveConfig,
    tracedCarveConfig,
    featureStamps,
    heightmapSource,
    worldSource,
    buildProgress,
    buildProgressPhase,
    buildProgressPercent,
    buildProgressBar,
    buildStatus,
    updateBuildOverlay,
    info,
    startupTimings,
    startupStartedAt,
    configuredWorld,
  });

  return {
    cfg,
    stoneConfig,
    treeConfig,
    understoryConfig,
    forestLightingConfig,
    grassConfig,
    waterConfig,
    // Runtime consumers (water shore surf, clipmap exclusion, deep ocean) must see the
    // world-mode-resolved coast: a streamed world with the rectangular border coast off
    // would otherwise grow phantom surf/dry bands inside the startup square.
    borderCoastOceanConfig: effectiveBorderCoast,
    customPropsConfig,
    propPlacementScenes,
    proceduralTerrain,
    proceduralTextureConfig,
    bakedMacroTint,
    clodWorker,
    WORLD,
    worldCells,
    worldSizeCells: worldCells,
    worldMode,
    worldManifest,
    hydrologyGraphArtifact,
    lod0Nodes,
    allNodes,
    maxTerrainLevel,
    terrainSummary,
    worldSource,
    result,
    hydrologySystem,
    farCarveImprint,
    polishLine,
    buildStatus,
  };
}
