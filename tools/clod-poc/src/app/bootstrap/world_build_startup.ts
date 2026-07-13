import * as THREE from "three";
import { parseConfig, type ClodPagesConfig } from "../../config.js";
import { ClodWorkerClient } from "../../clod_worker_client.js";
import { emitAudio } from "../../audio/index.js";
import {
  baseSurfaceHeight,
  resolveTerrainFieldConfig,
  setTerrainFieldConfig,
  getDigEditRevision,
  getVoxelEditSnapshot,
  replaceVoxelEdits,
  setTerrainSurfaceOverride,
  setBorderCoastRuntime,
  parseBorderCoastOceanConfig,
  type BorderCoastOceanConfig,
  type VoxelEditSnapshot,
} from "../../terrain/terrain.js";
import { setTerrainFieldCoreConfig } from "../../gpu/terrain_field_core.js";
import {
  buildStartupHeightfieldRaster,
  planStartupHeightfieldRaster,
  startupHeightfieldDescriptor,
} from "../../terrain/startup_heightfield_raster.js";
import { startupRasterHeightfieldSampler } from "../../world/heightfield_sampler.js";
import { buildWorldManifest, withWorldManifestArtifact, type WorldManifest } from "../../world/world_manifest.js";
import {
  computeHydrologyGraphParamsHash,
  createHydrologyGraphWorkerClient,
  IndexedDbHydrologyGraphStore,
  openHydrologyGraphDb,
  type HydrologyGraphArtifact,
} from "../../world/hydrology_graph/index.js";
import { publishWorldManifestForDiagnostics } from "../../core/hooks.js";
import { publishTerrainSummaryForDiagnostics } from "./diagnostics_startup.js";
import {
  initClodCacheContext,
  loadTerrainSummaryWithCacheSimple,
  createCacheDebugOverlay,
  isCacheSessionDisabled,
  setCacheSessionDisabled,
  buildAcceptanceWorldCacheKey,
} from "../../cache/index.js";
import {
  buildProceduralTextureHash,
  buildStagedImportHash,
  buildVoxelSnapshotHash,
  type TerrainSourceInputs,
} from "../../cache/terrainSource.js";
import {
  clearWorkerCacheSnapshot,
  getWorkerCacheBuildStats,
} from "../../cache/cacheMetricsBridge.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import { createBakedMacroTintTexture } from "../../gpu/terrain_node_baked_macro_tint.js";
import { aggregateDiagonalPolishStats, formatDiagonalPolishStats } from "../../diagonalPolish.js";
import { parseProceduralTextureConfig } from "../../textures/materialRecipes.js";
import { createProceduralTerrainTextures } from "../../textures/terrainTextureArrays.js";
import { parseGrassConfig, applyGrassMaterialBiasFromYaml } from "../../grass.js";
import { parseStoneConfig } from "../../stones/stone_config.js";
import { parseTreeConfig, applyTreeMaterialBiasFromYaml } from "../../trees/index.js";
import { parseUnderstoryConfig } from "../../understory/index.js";
import {
  createForestLightingIntegrationWarner,
  parseForestLightingConfig,
} from "../../forest_lighting/index.js";
import {
  parseWaterConfig,
  resolveWaterConfig,
  HydrologySystem,
  makeFakeBodyCarvedSampler,
  applyRiverParityTestWaterConfig,
  isRiverParityTestScene,
  type WaterConfig,
} from "../../water/index.js";
import { applyWaterQueryOverrides } from "../../water/water_quality_overrides.js";
import type { ClodPageNode } from "../../types.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import {
  CONTINENT_SCENE,
  INFINITE_ISLANDS_SCENE,
  describeWorldMode,
  resolveWorldMode,
  type WorldModeConfig,
} from "../world_mode.js";
import { isLongViewCapableScene } from "./bootstrap_long_view.js";
import { farClipmapRendererAllowed } from "../../terrain/far_clipmap/far_clipmap_config.js";
import { updateClodOverlay } from "../../ui/overlay_panel.js";
import configText from "../../../config/clod_pages.yaml?raw";
import stoneConfigText from "../../../config/stones.yaml?raw";
import treeConfigText from "../../../config/trees.yaml?raw";
import understoryConfigText from "../../../config/understory.yaml?raw";
import proceduralConfigText from "../../../config/procedural_textures.yaml?raw";
import grassConfigText from "../../../config/grass.yaml?raw";
import waterConfigText from "../../../config/water.yaml?raw";
import borderCoastOceanConfigText from "../../../config/border_coast_ocean.yaml?raw";
import borderOceanSceneConfigText from "../../../config/border_ocean_scene.yaml?raw";
import forestLightingConfigText from "../../../config/forest_lighting.yaml?raw";
import customPropsConfigText from "../../../config/custom_props.yaml?raw";
import customPropPlacementsText from "../../../config/custom_prop_placements.yaml?raw";
import customPropPlacements500Text from "../../../config/custom_prop_placements_500.yaml?raw";
import customPropPlacements5000Text from "../../../config/custom_prop_placements_5000.yaml?raw";
import customPropPlacements20000Text from "../../../config/custom_prop_placements_20000.yaml?raw";
import { parseCustomPropsConfig } from "../../props/prop_config.js";
import { parsePropPlacements } from "../../props/prop_placements.js";
import type { CustomPropsSettings } from "../../props/prop_types.js";
import type { PropPlacementScene } from "../../props/prop_types.js";
import { parseBorderOceanSceneConfig } from "../../debug/border_ocean_scene.js";
import { splitWorldBuildNodes } from "./world_build_nodes.js";
import { ProceduralWorldSource } from "../../world_source/world_source.js";
import type { WorldSource } from "../../world_source/world_source.js";
import { createCarvedGraphHydrologySampler, createGraphHydrologySampler } from "../../water/graph_hydrology.js";

function numberParam(searchParams: URLSearchParams, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function booleanParam(searchParams: URLSearchParams, keys: readonly string[], fallback: boolean): boolean {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    return raw !== "0" && raw !== "false";
  }
  return fallback;
}

const DEFAULT_INFINITE_BOOTSTRAP_WORLD_PAGES = 2;
const HEIGHTFIELD_RASTER_REASON_CODES = {
  enabled: 0,
  invalid_world_cells: 1,
  sample_budget: 2,
  byte_budget: 3,
} as const;

type StartupTimings = Record<string, number>;

function measure<T>(timings: StartupTimings, key: string, fn: () => T): T {
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    timings[key] = performance.now() - startedAt;
  }
}

async function measureAsync<T>(timings: StartupTimings, key: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    timings[key] = performance.now() - startedAt;
  }
}

function addTiming(timings: StartupTimings, key: string, ms: number): void {
  timings[key] = (timings[key] ?? 0) + ms;
}

function createLazyPropPlacementScenes(timings: StartupTimings): Record<string, PropPlacementScene> {
  const texts: Record<string, string> = {
    smoke: customPropPlacementsText,
    "500": customPropPlacements500Text,
    "5000": customPropPlacements5000Text,
    "20000": customPropPlacements20000Text,
  };
  const cache = new Map<string, PropPlacementScene>();
  const scenes = {} as Record<string, PropPlacementScene>;
  for (const [sceneId, text] of Object.entries(texts)) {
    Object.defineProperty(scenes, sceneId, {
      enumerable: true,
      configurable: false,
      get: () => {
        const cached = cache.get(sceneId);
        if (cached) return cached;
        const startedAt = performance.now();
        const parsed = parsePropPlacements(text);
        const elapsed = performance.now() - startedAt;
        cache.set(sceneId, parsed);
        addTiming(timings, "startup.prop_placements_ms", elapsed);
        timings[`startup.prop_placement_${sceneId}_ms`] = elapsed;
        return parsed;
      },
    });
  }
  return scenes;
}

function configuredWorldPages(
  stagedImport: VoxelProjectArchiveContents | null,
  clodRuntime: ClodRuntimeConfig,
  searchParams: URLSearchParams,
  queries: {
    queryGrassPerfScene: boolean;
    queryTreePerfScene: boolean;
    queryForestFloorScene: boolean;
    queryLongViewScene: boolean;
    queryBorderOceanScene: boolean;
  },
  borderOceanDefaultWorldPages: number,
): number {
  const requested = Number(searchParams.get("world"));
  return stagedImport?.manifest.worldSize ?? (
    clodRuntime.runtime.worldOptions.includes(requested)
      ? requested
      : queries.queryGrassPerfScene || queries.queryTreePerfScene || queries.queryForestFloorScene || queries.queryLongViewScene || queries.queryBorderOceanScene
        ? queries.queryBorderOceanScene
          ? borderOceanDefaultWorldPages
          : 16
        : 8
  );
}

function startupWorldPages(
  configuredWorld: number,
  stagedImport: VoxelProjectArchiveContents | null,
  clodRuntime: ClodRuntimeConfig,
  searchParams: URLSearchParams,
  sceneName: string,
): number {
  if (stagedImport) return configuredWorld;
  const requestedStartupWorld = Number(searchParams.get("infiniteStartupWorld") ?? searchParams.get("startupWorld"));
  if (clodRuntime.runtime.worldOptions.includes(requestedStartupWorld)) {
    return Math.min(requestedStartupWorld, configuredWorld);
  }
  if (sceneName === INFINITE_ISLANDS_SCENE && searchParams.get("acceptance") === "1") {
    return Math.min(DEFAULT_INFINITE_BOOTSTRAP_WORLD_PAGES, configuredWorld);
  }
  return configuredWorld;
}

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

  const parsedConfigs = measure(startupTimings, "startup.parse_configs_ms", () => {
    const cfg = stagedImport?.manifest.config ?? parseConfig(configText);
    const stoneConfig = parseStoneConfig(stoneConfigText);
    const treeConfig = applyTreeMaterialBiasFromYaml(parseTreeConfig(treeConfigText), treeConfigText);
    const understoryConfig = parseUnderstoryConfig(understoryConfigText);
    const forestLightingConfig = parseForestLightingConfig(forestLightingConfigText);
    createForestLightingIntegrationWarner()(forestLightingConfig);
    const grassConfig = applyGrassMaterialBiasFromYaml(parseGrassConfig(grassConfigText), grassConfigText);
    const customPropsConfig = parseCustomPropsConfig(customPropsConfigText);
    const propPlacementScenes = createLazyPropPlacementScenes(startupTimings);
    const waterConfig = applyWaterQueryOverrides(parseWaterConfig(waterConfigText), searchParams);
    const borderCoastOceanConfig = parseBorderCoastOceanConfig(borderCoastOceanConfigText);
    const borderOceanSceneConfig = parseBorderOceanSceneConfig(borderOceanSceneConfigText);
    const proceduralTextureConfig = parseProceduralTextureConfig(proceduralConfigText);
    return {
      cfg,
      stoneConfig,
      treeConfig,
      understoryConfig,
      forestLightingConfig,
      grassConfig,
      customPropsConfig,
      propPlacementScenes,
      waterConfig,
      borderCoastOceanConfig,
      borderOceanSceneConfig,
      proceduralTextureConfig,
    };
  });
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
  const isInfiniteIslands = sceneName === INFINITE_ISLANDS_SCENE;
  const isContinent = sceneName === CONTINENT_SCENE;
  const isStreamedWorld = isInfiniteIslands || isContinent;
  const continentHydrologyRequested = isContinent
    && booleanParam(searchParams, ["continentHydrology", "continent_hydrology"], false);
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
  const worldSource = new ProceduralWorldSource(terrainFieldConfig);
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

  const unifiedHydrologyRequested = isInfiniteIslands
    && waterConfig.enabled
    && waterConfig.source === "hydrology"
    && waterConfig.hydrology.enabled
    && waterConfig.hydrology.infinite.unifiedStartup;
  let hydrologySystem = measure(startupTimings, "startup.hydrology_ms", () => {
    if (continentHydrologyRequested) return null;
    const baseTerrainSampler = { surfaceHeight: baseSurfaceHeight };
    const preHydrologyTerrain = unifiedHydrologyRequested
      ? baseTerrainSampler
      : makeFakeBodyCarvedSampler(waterConfig, baseTerrainSampler);
    const system = waterConfig.enabled && waterConfig.source === "hydrology" && waterConfig.hydrology.enabled
      ? HydrologySystem.build(waterConfig.hydrology, worldCells, preHydrologyTerrain, {
          infiniteWorldSamples: isStreamedWorld,
        })
      : null;
    if (system?.unifiedStartupActive()) {
      // Water is now a raster/view of the traced authority. Terrain remains the procedural
      // field on main and worker paths, so there is no startup-grid carve to serialize.
      setTerrainSurfaceOverride(null);
    } else if (system) {
      const hydroCells = system.grid.worldCells;
      setTerrainSurfaceOverride((x, z) =>
        (x < 0 || z < 0 || x > hydroCells || z > hydroCells)
          ? baseSurfaceHeight(x, z)
          : system.terrainHeight(x, z));
    } else if (waterConfig.enabled && waterConfig.fakeBodies.carveTerrain) {
      setTerrainSurfaceOverride((x, z) => preHydrologyTerrain.surfaceHeight(x, z));
    } else {
      setTerrainSurfaceOverride(null);
    }
    if (system) console.log("[water] hydrology built", system.stats);
    return system;
  });
  const unifiedHydrology = continentHydrologyRequested || hydrologySystem?.unifiedStartupActive() === true;
  startupTimings["startup.hydrology_unified_startup"] = unifiedHydrology ? 1 : 0;

  const heightfieldRasterRequested = unifiedHydrology
    && booleanParam(searchParams, ["heightfieldRaster", "heightfield_raster"], true);
  const heightfieldRasterPlan = planStartupHeightfieldRaster(worldCells);
  startupTimings["startup.heightfield_raster_requested"] = heightfieldRasterRequested ? 1 : 0;
  startupTimings["startup.heightfield_raster_budget_enabled"] = heightfieldRasterPlan.enabled ? 1 : 0;
  startupTimings["startup.heightfield_raster_budget_reason_code"] = HEIGHTFIELD_RASTER_REASON_CODES[heightfieldRasterPlan.reason];
  startupTimings["startup.heightfield_raster_samples"] = heightfieldRasterPlan.sampleCount;
  startupTimings["startup.heightfield_raster_bytes"] = heightfieldRasterPlan.byteLength;
  let startupHeightfield = heightfieldRasterRequested && heightfieldRasterPlan.enabled && !continentHydrologyRequested
    ? measure(startupTimings, "startup.heightfield_raster_ms", () => buildStartupHeightfieldRaster(worldCells))
    : null;
  if (startupHeightfield) {
    const sampler = startupRasterHeightfieldSampler(startupHeightfield);
    setTerrainSurfaceOverride(sampler.sampleHeight);
    startupTimings["startup.heightfield_raster_res"] = startupHeightfield.res;
  }
  startupTimings["startup.heightfield_raster_enabled"] = startupHeightfield ? 1 : 0;

  const hydrologyTerrain = hydrologySystem && !unifiedHydrology
    ? {
        res: hydrologySystem.grid.res,
        worldCells: hydrologySystem.grid.worldCells,
        carvedBed: hydrologySystem.grid.carvedBed,
      }
    : null;

  const proceduralTextureHash = await buildProceduralTextureHash(
    proceduralTextureConfig.enabled,
    proceduralTextureConfig.enabled ? `${proceduralTextureConfig.seed}:${proceduralTextureConfig.noise.resolution}` : null,
  );
  const stagedImportHash = await buildStagedImportHash(stagedImport?.manifest ?? null);
  const voxelSnapshotHash = await buildVoxelSnapshotHash(voxelSnapshot);
  const graphCarveConfig = continentHydrologyRequested ? {
    depthM: waterConfig.hydrology.rivers.carveDepthM,
    power: waterConfig.hydrology.rivers.carvePower,
    lakeBedDepthM: waterConfig.hydrology.rivers.visibleDepthM,
  } : null;
  const terrainSource: TerrainSourceInputs = {
    scene: sceneName,
    worldSeed: String(seed),
    terrainFieldConfig,
    worldPages: WORLD,
    worldMode: worldMode.mode,
    borderCoastMode: worldMode.borderCoastEnabled ? "finite_rect" : "none",
    generatorVersion: cfg.meshopt_package_version,
    digRevision: getDigEditRevision(),
    hydrologyTerrain,
    startupHeightfield: startupHeightfieldDescriptor(startupHeightfield),
    borderCoastOceanConfig: effectiveBorderCoast,
    waterConfig: {
      enabled: waterConfig.enabled,
      source: waterConfig.source,
      fakeBodies: { carveTerrain: waterConfig.fakeBodies.carveTerrain },
      hydrology: { enabled: waterConfig.hydrology.enabled, unifiedStartup: unifiedHydrology },
    },
    proceduralTextureEnabled: proceduralTextureConfig.enabled,
    stagedImportHash,
    voxelSnapshotHash,
    proceduralTextureHash,
    longViewScene: queryLongViewScene,
    hydrologyGraphHash: null,
    hydrologyCarve: null,
  };
  let acceptanceCacheKey = await buildAcceptanceWorldCacheKey({ cfg, terrainSource });
  window.__drusnielAcceptanceWorldCacheKey = acceptanceCacheKey;
  let worldManifest = buildWorldManifest({
    worldMode,
    terrainFieldConfig,
    terrainSourceHash: acceptanceCacheKey.terrainSourceHash,
    seaLevelM: seaLevel,
  });
  let hydrologyGraphArtifact: HydrologyGraphArtifact | null = null;
  startupTimings["hydrology_graph_present"] = 0;
  startupTimings["hydrology_graph_build_pct"] = 0;
  startupTimings["hydrology_graph_store_hit"] = 0;
  if (continentHydrologyRequested) {
    if (!worldManifest.sizeM) throw new Error("continent hydrology requires bounded manifest size");
    const originM = { x: -worldManifest.sizeM.x / 2, z: -worldManifest.sizeM.z / 2 };
    const graphParamsHash = await computeHydrologyGraphParamsHash({
      worldId: worldManifest.worldId,
      seed,
      sizeM: worldManifest.sizeM,
      originM,
      terrainFieldConfig,
    });
    const graphDb = await openHydrologyGraphDb();
    const graphStore = new IndexedDbHydrologyGraphStore(
      graphDb,
      acceptanceCacheKey.terrainSourceHash,
      graphParamsHash,
    );
    const graphStartedAt = performance.now();
    try {
      hydrologyGraphArtifact = await graphStore.load();
      if (hydrologyGraphArtifact) {
        startupTimings["hydrology_graph_store_hit"] = 1;
        startupTimings["hydrology_graph_build_pct"] = 100;
      } else {
        const graphWorker = createHydrologyGraphWorkerClient();
        if (!graphWorker) throw new Error("continent hydrology graph worker is unavailable");
        try {
          hydrologyGraphArtifact = await graphWorker.build({
            worldId: worldManifest.worldId,
            seed,
            sizeM: worldManifest.sizeM,
            originM,
            terrainFieldConfig,
          }, (buildPct) => {
            startupTimings["hydrology_graph_build_pct"] = buildPct;
            buildProgress.hidden = false;
            buildProgressPhase.textContent = "continental hydrology";
            buildProgressPercent.textContent = `${Math.round(buildPct)}%`;
            buildProgressBar.value = buildPct / 100;
            buildStatus.value = "continental hydrology";
            updateBuildOverlay();
          });
          await graphStore.save(hydrologyGraphArtifact);
        } finally {
          graphWorker.dispose();
        }
      }
    } finally {
      graphStore.close();
      startupTimings["startup.hydrology_graph_ms"] = performance.now() - graphStartedAt;
    }
    startupTimings["hydrology_graph_present"] = 1;
    const graphSampler = createGraphHydrologySampler(
      hydrologyGraphArtifact.graph,
      { surfaceHeight: baseSurfaceHeight },
      waterConfig.hydrology.waterSurface.drySentinelDepth,
    );
    const carvedGraphSampler = createCarvedGraphHydrologySampler(
      hydrologyGraphArtifact.graph,
      { surfaceHeight: baseSurfaceHeight },
      graphCarveConfig!,
      waterConfig.hydrology.waterSurface.drySentinelDepth,
    );
    waterConfig.hydrology.infinite.source = "graph";
    if (heightfieldRasterRequested && heightfieldRasterPlan.enabled) {
      startupHeightfield = measure(startupTimings, "startup.heightfield_raster_ms", () =>
        buildStartupHeightfieldRaster(worldCells, (x, z) =>
          Math.fround(graphSampler.carveHeight(x, z, baseSurfaceHeight(x, z), graphCarveConfig!))));
      if (startupHeightfield) {
        setTerrainSurfaceOverride(startupRasterHeightfieldSampler(startupHeightfield).sampleHeight);
        startupTimings["startup.heightfield_raster_res"] = startupHeightfield.res;
      }
      startupTimings["startup.heightfield_raster_enabled"] = startupHeightfield ? 1 : 0;
    }
    hydrologySystem = measure(startupTimings, "startup.hydrology_graph_grid_ms", () => HydrologySystem.build(
      waterConfig.hydrology,
      worldCells,
      { surfaceHeight: baseSurfaceHeight },
      {
        infiniteWorldSamples: true,
        worldSampler: (x, z) => carvedGraphSampler.sample(x, z),
      },
    ));
    terrainSource.startupHeightfield = startupHeightfieldDescriptor(startupHeightfield);
    terrainSource.hydrologyGraphHash = hydrologyGraphArtifact.ref.hash;
    terrainSource.hydrologyCarve = graphCarveConfig;
    acceptanceCacheKey = await buildAcceptanceWorldCacheKey({ cfg, terrainSource });
    window.__drusnielAcceptanceWorldCacheKey = acceptanceCacheKey;
    worldManifest = withWorldManifestArtifact(buildWorldManifest({
      worldMode,
      terrainFieldConfig,
      terrainSourceHash: acceptanceCacheKey.terrainSourceHash,
      seaLevelM: seaLevel,
    }), "hydrologyGraph", hydrologyGraphArtifact.ref);
  }
  terrainSource.worldManifest = worldManifest;
  startupTimings["world_manifest_present"] = 1;
  startupTimings["world_manifest_seed"] = worldManifest.seed;
  publishWorldManifestForDiagnostics(worldManifest);
  const cacheContext = await initClodCacheContext({
    cfg,
    worldPages: WORLD,
    terrainSource,
    forceDisabled: isCacheSessionDisabled(),
  });
  const cacheOverlay = searchParams.get("cacheDebug") === "1"
    ? createCacheDebugOverlay({ clearWorkerCache: () => clodWorker.clearCache() })
    : null;

  const result = await measureAsync(startupTimings, "startup.build_world_ms", () =>
    clodWorker.buildWorld(
      WORLD,
      WORLD,
      cfg,
      voxelSnapshot,
      (progress) => {
        const fraction = progress.total > 0 ? progress.done / progress.total : 0;
        buildProgress.hidden = false;
        buildProgressPhase.textContent = progress.phase;
        buildProgressPercent.textContent = `${Math.round(fraction * 100)}%`;
        buildProgressBar.value = fraction;
        buildStatus.value = progress.phase;
        updateBuildOverlay();
      },
      terrainFieldConfig,
      hydrologyTerrain,
      effectiveBorderCoast,
      isCacheSessionDisabled(),
      terrainSource,
      startupHeightfield,
      hydrologyGraphArtifact?.graph ?? null,
      hydrologyGraphArtifact ? graphCarveConfig : null,
    ));
  const workerCacheStats = getWorkerCacheBuildStats();
  startupTimings["startup_build_world_ms"] = startupTimings["startup.build_world_ms"];
  startupTimings["clod_cache_hit"] = workerCacheStats && workerCacheStats.cacheHits > 0 && workerCacheStats.cacheMisses === 0 ? 1 : 0;
  startupTimings["clod_cache_miss"] = workerCacheStats && workerCacheStats.cacheMisses > 0 ? 1 : 0;
  startupTimings["clod_cache_rehydrate_ms"] = workerCacheStats?.cacheDecodeMs ?? 0;
  startupTimings["clod_cache_key_match"] = cacheContext?.effective ? 1 : 0;
  startupTimings["clod_cache_nodes_from_cache"] = workerCacheStats?.nodesFromCache ?? 0;
  startupTimings["clod_cache_nodes_built"] = workerCacheStats?.nodesBuilt ?? 0;
  startupTimings["clod_cache_hits"] = workerCacheStats?.cacheHits ?? 0;
  startupTimings["clod_cache_misses"] = workerCacheStats?.cacheMisses ?? 0;
  startupTimings["clod_cache_cold_build_ms_avoided"] = workerCacheStats?.coldBuildMsAvoided ?? 0;
  cacheOverlay?.update();

  const { lod0Nodes, allNodes } = splitWorldBuildNodes(result.nodesByLevel);
  const summaryResult = await measureAsync(startupTimings, "startup.terrain_summary_ms", () =>
    loadTerrainSummaryWithCacheSimple(
      lod0Nodes,
      worldCells,
      cacheContext?.farReduceFactor ?? 8,
      cacheContext,
      worldSource,
    ));
  startupTimings["startup_terrain_summary_ms"] = startupTimings["startup.terrain_summary_ms"];
  startupTimings["terrain_summary_cache_hit"] = summaryResult.fromCache ? 1 : 0;
  startupTimings["terrain_summary_cache_miss"] = summaryResult.fromCache ? 0 : 1;
  const terrainSummary = summaryResult.summary;
  publishTerrainSummaryForDiagnostics(terrainSummary);
  const maxTerrainLevel = result.nodesByLevel.size > 0 ? Math.max(...result.nodesByLevel.keys()) : 0;
  const polish = aggregateDiagonalPolishStats(result.stats.map((s) => s.polish));
  const polishLine = formatDiagonalPolishStats(polish);
  info.textContent = "ready";
  buildProgress.hidden = true;
  buildStatus.value = "ready";
  updateBuildOverlay();
  startupTimings["startup.world_build_startup_ms"] = performance.now() - startupStartedAt;
  startupTimings["startup_total_ms"] = startupTimings["startup.world_build_startup_ms"];
  console.info(
    "[startup]",
    `parse=${startupTimings["startup.parse_configs_ms"].toFixed(1)}ms`,
    `textures=${startupTimings["startup.procedural_textures_ms"].toFixed(1)}ms`,
    `hydrology=${startupTimings["startup.hydrology_ms"].toFixed(1)}ms`,
    `buildWorld=${startupTimings["startup.build_world_ms"].toFixed(1)}ms`,
    `terrainSummary=${startupTimings["startup.terrain_summary_ms"].toFixed(1)}ms`,
    `world=${WORLD}x${WORLD}`,
    configuredWorld !== WORLD ? `configured=${configuredWorld}x${configuredWorld}` : "",
  );

  return {
    cfg,
    stoneConfig,
    treeConfig,
    understoryConfig,
    forestLightingConfig,
    grassConfig,
    waterConfig,
    borderCoastOceanConfig,
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
    polishLine,
    buildStatus,
  };
}
