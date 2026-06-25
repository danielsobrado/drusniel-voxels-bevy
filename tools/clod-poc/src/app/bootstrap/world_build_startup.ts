import * as THREE from "three";
import { parseConfig, type ClodPagesConfig } from "../../config.js";
import { ClodWorkerClient } from "../../clod_worker_client.js";
import { emitAudio } from "../../audio/index.js";
import {
  baseSurfaceHeight,
  getDigEditsSnapshot,
  replaceDigEdits,
  setTerrainSurfaceOverride,
} from "../../terrain.js";
import { buildTerrainSummary } from "../../clod/terrain_summary.js";
import { publishTerrainSummary } from "./diagnostics_startup.js";
import { bakeMacroTint } from "../../gpu/terrain_node_material.js";
import { aggregateDiagonalPolishStats, formatDiagonalPolishStats } from "../../diagonalPolish.js";
import { parseProceduralTextureConfig } from "../../textures/materialRecipes.js";
import { createProceduralTerrainTextures } from "../../textures/terrainTextureArrays.js";
import { parseGrassConfig } from "../../grass.js";
import { parseStoneConfig } from "../../stones/stone_config.js";
import { parseTreeConfig } from "../../trees/index.js";
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
import type { ProjectArchiveContents } from "../../project_archive.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import { updateClodOverlay } from "../../ui/overlay_panel.js";
import configText from "../../../config/clod_pages.yaml?raw";
import stoneConfigText from "../../../config/stones.yaml?raw";
import treeConfigText from "../../../config/trees.yaml?raw";
import understoryConfigText from "../../../config/understory.yaml?raw";
import proceduralConfigText from "../../../config/procedural_textures.yaml?raw";
import grassConfigText from "../../../config/grass.yaml?raw";
import waterConfigText from "../../../config/water.yaml?raw";
import forestLightingConfigText from "../../../config/forest_lighting.yaml?raw";

export interface WorldBuildStartupInput {
  stagedImport: ProjectArchiveContents | null;
  clodRuntime: ClodRuntimeConfig;
  searchParams: URLSearchParams;
  queryGrassPerfScene: boolean;
  queryTreePerfScene: boolean;
  queryForestFloorScene: boolean;
  queryLongViewScene: boolean;
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
  proceduralTerrain: ReturnType<typeof createProceduralTerrainTextures> | null;
  proceduralTextureConfig: ReturnType<typeof parseProceduralTextureConfig>;
  bakedMacroTint: THREE.DataTexture | null;
  clodWorker: ClodWorkerClient;
  WORLD: number;
  worldCells: number;
  worldSizeCells: number;
  allNodes: ClodPageNode[];
  maxTerrainLevel: number;
  terrainSummary: ReturnType<typeof buildTerrainSummary>;
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
    buildProgress,
    buildProgressPhase,
    buildProgressPercent,
    buildProgressBar,
    info,
  } = input;

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

  const requested = Number(searchParams.get("world"));
  const WORLD = stagedImport?.manifest.worldSize ?? (
    clodRuntime.runtime.worldOptions.includes(requested)
      ? requested
      : queryGrassPerfScene || queryTreePerfScene || queryForestFloorScene || queryLongViewScene
        ? 16
        : 4
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
  waterConfig = resolveWaterConfig(waterConfig, worldCells);

  const buildStatus = { value: "preparing" };
  const updateBuildOverlay = () => updateClodOverlay({
    worldSize: WORLD,
    renderedTriangles: 0,
    nodesByLod: {},
    forcedSplits: 0,
    bubbleForcedSplits: 0,
    cutFrozen: false,
    errorThreshold: cfg.selection.error_threshold_px,
    buildStatus: buildStatus.value,
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
  buildStatus.value = `${stagedImport ? "import: " : ""}building ${WORLD}x${WORLD}`;
  updateBuildOverlay();
  await new Promise((r) => setTimeout(r, 16));

  const result = await clodWorker.buildWorld(WORLD, WORLD, cfg, getDigEditsSnapshot(), ({ done, total, level, phase }) => {
    const fraction = total > 0 ? Math.min(1, done / total) : 0;
    buildProgressBar.value = fraction;
    buildProgressPercent.textContent = `${Math.floor(fraction * 100)}%`;
    buildProgressPhase.textContent = `${phase}  L${level}  ${done}/${total}`;
    info.textContent = `building ${WORLD}x${WORLD} world… ${Math.floor(fraction * 100)}%\n${phase}  L${level}  ${done}/${total}`;
    buildStatus.value = `${phase} L${level} ${done}/${total}`;
    updateBuildOverlay();
  }, hydrologyTerrain);

  buildProgress.hidden = true;
  buildStatus.value = "ready";
  const polishLine = formatDiagonalPolishStats(aggregateDiagonalPolishStats(result.stats.map((s) => s.polish)));
  const allNodes: ClodPageNode[] = result.nodesByLevel.get(0) ?? [];
  const maxTerrainLevel = Math.max(...result.nodesByLevel.keys());
  const worldSizeCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
  const terrainSummary = buildTerrainSummary(allNodes, worldSizeCells, 8);
  publishTerrainSummary(terrainSummary);

  return {
    cfg,
    stoneConfig,
    treeConfig,
    understoryConfig,
    forestLightingConfig,
    grassConfig,
    waterConfig,
    proceduralTerrain,
    proceduralTextureConfig,
    bakedMacroTint,
    clodWorker,
    WORLD,
    worldCells,
    worldSizeCells,
    allNodes,
    maxTerrainLevel,
    terrainSummary,
    result,
    hydrologySystem,
    polishLine,
    buildStatus,
  };
}
