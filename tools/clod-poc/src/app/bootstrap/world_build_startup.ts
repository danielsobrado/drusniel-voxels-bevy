import * as THREE from "three";
import { parseConfig, type ClodPagesConfig } from "../../config.js";
import { ClodWorkerClient } from "../../clod_worker_client.js";
import { emitAudio } from "../../audio/index.js";
import {
  baseSurfaceHeight,
  getDigEditsSnapshot,
  getDigEditRevision,
  replaceDigEdits,
  setTerrainSurfaceOverride,
  setBorderCoastRuntime,
  parseBorderCoastOceanConfig,
  type BorderCoastOceanConfig,
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
  type WaterConfig,
} from "../../water/index.js";
import type { ClodPageNode } from "../../types.js";
import type { ProjectArchiveContents } from "../../project/project_archive.js";
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
  stagedImport: ProjectArchiveContents | null;
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
      proceduralTerrain.noise.resolution,
      bakeRes,
    );
  }

  const clodCacheContext: ClodCacheContext = initClodCacheContext({
    cache: clodRuntime.cache,
    searchParams,
    sourceHash: buildProceduralTextureHash(proceduralTextureConfig) + "|" + buildStagedImportHash(stagedImport),
    cfg,
    worldSize: WORLD,
  });
  const buildStatus = { value: "building world" };
  const cacheDisabled = isCacheSessionDisabled();
  const cacheLabel = cacheDisabled
    ? "disabled"
    : clodCacheContext.enabled
      ? `${clodRuntime.cache.mode}`
      : "off";
  info.textContent = `building world (${WORLD}x${WORLD} pages, cache ${cacheLabel})`;

  // Remaining startup logic is unchanged.
  const cacheResult = await loadTerrainSummaryWithCacheSimple({
    context: clodCacheContext,
    buildProgress,
    buildProgressPhase,
    buildProgressPercent,
    buildProgressBar,
    buildStatus,
    build: async () => {
      buildProgressPhase.textContent = "building terrain pages";
      return clodWorker.buildWorld(cfg, WORLD, stagedImport?.terrainSnapshot ?? null);
    },
  });
  const result = cacheResult.result;
  if (cacheResult.fromCache) clearWorkerCacheSnapshot();
  const { lod0Nodes, allNodes, maxTerrainLevel } = splitWorldBuildNodes(result.nodes);
  const terrainSummary = result.terrainSummary;
  publishTerrainSummaryForDiagnostics(terrainSummary);
  const hydrologySystem = resolveWaterConfig(waterConfig).enabled
    ? new HydrologySystem({ worldCells, terrainSummary })
    : null;
  if (hydrologySystem) setTerrainSurfaceOverride(makeFakeBodyCarvedSampler(hydrologySystem));
  else setTerrainSurfaceOverride(null);
  setBorderCoastRuntime(borderCoastOceanConfig);
  replaceDigEdits(stagedImport?.terrainSnapshot?.digEdits ?? getDigEditsSnapshot());
  const polishStats = aggregateDiagonalPolishStats(result.nodes);
  const polishLine = formatDiagonalPolishStats(polishStats);
  createCacheDebugOverlay(clodCacheContext, cacheResult, () => {
    setCacheSessionDisabled(true);
    location.reload();
  });
  updateClodOverlay({ polishLine, cache: cacheResult.fromCache ? "hit" : "miss" });

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
