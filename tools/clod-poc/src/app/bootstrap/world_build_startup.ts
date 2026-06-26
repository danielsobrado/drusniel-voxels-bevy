import * as THREE from "three";
import { parseConfig, type ClodPagesConfig } from "../../config.js";
import { ClodWorkerClient } from "../../clod_worker_client.js";
import { emitAudio } from "../../audio/index.js";
import {
  baseSurfaceHeight,
  getDigEditRevision,
  getVoxelEditSnapshot,
  replaceVoxelEdits,
  setTerrainSurfaceOverride,
  setBorderCoastRuntime,
  parseBorderCoastOceanConfig,
  type BorderCoastOceanConfig,
  type VoxelEditSnapshot,
} from "../../terrain/terrain.js";
import { publishTerrainSummaryForDiagnostics } from "./diagnostics_startup.js";
import {
  initClodCacheContext,
  loadTerrainSummaryWithCacheSimple,
  createCacheDebugOverlay,
  isCacheSessionDisabled,
  setCacheSessionDisabled,
  type ClodCacheContext,
} from "../../cache/index.js";
import {
  buildProceduralTextureHash,
  buildStagedImportHash,
  type TerrainSourceInputs,
} from "../../cache/terrainSource.js";
import { clearWorkerCacheSnapshot } from "../../cache/cacheMetricsBridge.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import { bakeMacroTint } from "../../gpu/terrain_node_material.js";
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
import type { ClodPageNode } from "../../types.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
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
  lod0Nodes: ClodPageNode[];
  allNodes: ClodPageNode[];
  maxTerrainLevel: number;
  terrainSummary: TerrainSummaryField;
  result: Awaited<ReturnType<ClodWorkerClient["buildWorld"]>>;
  hydrologySystem: HydrologySystem | null;
  polishLine: string;
  buildStatus: { value: string };
}

function importedVoxelSnapshot(stagedImport: VoxelProjectArchiveContents | null): VoxelEditSnapshot {
  if (!stagedImport) return { revision: 0, deltas: [] };
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

  const cfg = stagedImport?.manifest.config ?? parseConfig(configText);
  const stoneConfig = parseStoneConfig(stoneConfigText);
  const treeConfig = applyTreeMaterialBiasFromYaml(parseTreeConfig(treeConfigText), treeConfigText);
  const understoryConfig = parseUnderstoryConfig(understoryConfigText);
  const forestLightingConfig = parseForestLightingConfig(forestLightingConfigText);
  createForestLightingIntegrationWarner()(forestLightingConfig);
  const grassConfig = applyGrassMaterialBiasFromYaml(parseGrassConfig(grassConfigText), grassConfigText);
  const customPropsConfig = parseCustomPropsConfig(customPropsConfigText);
  const propPlacementScenes: Record<string, PropPlacementScene> = {
    smoke: parsePropPlacements(customPropPlacementsText),
    "500": parsePropPlacements(customPropPlacements500Text),
    "5000": parsePropPlacements(customPropPlacements5000Text),
    "20000": parsePropPlacements(customPropPlacements20000Text),
  };
  let waterConfig = parseWaterConfig(waterConfigText);
  const borderCoastOceanConfig = parseBorderCoastOceanConfig(borderCoastOceanConfigText);
  const borderOceanSceneConfig = parseBorderOceanSceneConfig(borderOceanSceneConfigText);
  const proceduralTextureConfig = parseProceduralTextureConfig(proceduralConfigText);
  const proceduralTerrain = proceduralTextureConfig.enabled
    ? createProceduralTerrainTextures(proceduralTextureConfig)
    : null;
  const clodWorker = new ClodWorkerClient();
  clodWorker.onError = (error) => {
    emitAudio("clod.rebuild.error");
    console.error("[clod worker]", error);
  };

  const requested = Number(searchParams.get("world"));
  const WORLD = stagedImport?.manifest.worldSize ?? (
    clodRuntime.runtime.worldOptions.includes(requested)
      ? requested
      : queryGrassPerfScene || queryTreePerfScene || queryForestFloorScene || queryLongViewScene || queryBorderOceanScene
        ? queryBorderOceanScene
          ? borderOceanSceneConfig.defaultWorldPages
          : 16
        : 8
  );
  const worldCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;

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
  if (isRiverParityTestScene(searchParams.get("scene"))) waterConfig = applyRiverParityTestWaterConfig(waterConfig);
  waterConfig = resolveWaterConfig(waterConfig, worldCells);
  setBorderCoastRuntime(borderCoastOceanConfig, worldCells);

  const buildStatus = { value: "preparing" };
  const updateBuildOverlay = () => updateClodOverlay({
    worldSize: WORLD,
    renderedTriangles: 0,
    nodesByLod: {},
    forcedSplits: 0,
    blockedSplits: 0,
    bubbleForcedSplits: 0,
    cutFrozen: false,
    errorThreshold: cfg.selection.error_threshold_px,
    buildStatus: buildStatus.value,
  });
  updateBuildOverlay();

  const cacheParam = searchParams.get("cache");
  const cacheDisabled = cacheParam === "0" || cacheParam === "false";
  if (cacheDisabled) setCacheSessionDisabled(true);
  clearWorkerCacheSnapshot();

  replaceVoxelEdits(importedVoxelSnapshot(stagedImport));

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

  const scene = searchParams.get("scene") ?? "default";
  const proceduralTextureHash = await buildProceduralTextureHash(
    proceduralTextureConfig.enabled,
    proceduralTextureConfig.enabled ? `${proceduralTextureConfig.seed}:${proceduralTextureConfig.noise.resolution}` : null,
  );
  const stagedImportHash = await buildStagedImportHash(stagedImport?.manifest ?? null);
  const terrainSource: TerrainSourceInputs = {
    scene,
    worldSeed: "0",
    worldPages: WORLD,
    generatorVersion: cfg.meshopt_package_version,
    digRevision: getDigEditRevision(),
    hydrologyTerrain,
    borderCoastOceanConfig,
    waterConfig: {
      enabled: waterConfig.enabled,
      source: waterConfig.source,
      fakeBodies: { carveTerrain: waterConfig.fakeBodies.carveTerrain },
      hydrology: { enabled: waterConfig.hydrology.enabled },
    },
    proceduralTextureEnabled: proceduralTextureConfig.enabled,
    proceduralTextureHash,
    stagedImportHash,
    longViewScene: queryLongViewScene,
  };

  const cacheCtx: ClodCacheContext | null = await initClodCacheContext({
    cfg,
    worldPages: WORLD,
    terrainSource,
    forceDisabled: cacheDisabled,
    role: "main",
  });

  const buildNote = WORLD >= 16 ? " (worker build; large world may take a while)" : WORLD >= 8 ? " (worker build)" : "";
  info.textContent = `building ${WORLD}x${WORLD} world…${buildNote}`;
  buildProgress.hidden = false;
  buildProgressPhase.textContent = `${stagedImport ? "import: " : ""}building ${WORLD}x${WORLD}`;
  buildProgressPercent.textContent = "0%";
  buildProgressBar.value = 0;
  buildStatus.value = `${stagedImport ? "import: " : ""}building ${WORLD}x${WORLD}`;
  updateBuildOverlay();
  await new Promise((r) => setTimeout(r, 16));

  const result = await clodWorker.buildWorld(WORLD, WORLD, cfg, getVoxelEditSnapshot(), ({ done, total, level, phase }) => {
    const fraction = total > 0 ? Math.min(1, done / total) : 0;
    buildProgressBar.value = fraction;
    buildProgressPercent.textContent = `${Math.floor(fraction * 100)}%`;
    buildProgressPhase.textContent = `${phase}  L${level}  ${done}/${total}`;
    info.textContent = `building ${WORLD}x${WORLD} world… ${Math.floor(fraction * 100)}%\n${phase}  L${level}  ${done}/${total}`;
    buildStatus.value = `${phase} L${level} ${done}/${total}`;
    updateBuildOverlay();
  }, hydrologyTerrain, borderCoastOceanConfig, cacheDisabled || isCacheSessionDisabled(), terrainSource);

  buildProgress.hidden = true;
  buildStatus.value = "ready";
  const polishLine = formatDiagonalPolishStats(aggregateDiagonalPolishStats(result.stats.map((s) => s.polish)));
  const { lod0Nodes, allNodes } = splitWorldBuildNodes(result.nodesByLevel);
  const maxTerrainLevel = Math.max(...result.nodesByLevel.keys());
  const worldSizeCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
  const summaryResult = await loadTerrainSummaryWithCacheSimple(lod0Nodes, worldSizeCells, 8, cacheCtx);
  const terrainSummary = summaryResult.summary;
  publishTerrainSummaryForDiagnostics(terrainSummary);
  if (cacheCtx) createCacheDebugOverlay();

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
    worldSizeCells,
    lod0Nodes,
    allNodes,
    maxTerrainLevel,
    terrainSummary,
    result,
    hydrologySystem,
    polishLine,
    buildStatus,
  };
}
