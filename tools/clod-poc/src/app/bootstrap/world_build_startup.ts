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

export interface WorldBuildStartupOptions {
  stagedImport: VoxelProjectArchiveContents | null;
  clodRuntime: ClodRuntimeConfig;
  searchParams: URLSearchParams;
  queryGrassPerfScene: boolean;
  queryTreePerfScene: boolean;
  queryForestFloorScene: boolean;
  queryLongViewScene: boolean;
  queryBorderOceanScene: boolean;
  buildProgress: HTMLElement | null;
  buildProgressPhase: HTMLElement | null;
  buildProgressPercent: HTMLElement | null;
  buildProgressBar: HTMLElement | null;
  info: HTMLElement;
}

export interface WorldBuildStartupResult {
  cfg: ClodPagesConfig;
  worker: ClodWorkerClient;
  nodes: ClodPageNode[];
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  waterConfig: WaterConfig;
  cacheCtx: ClodCacheContext | null;
  borderCoastConfig: BorderCoastOceanConfig | null;
  voxelEditSnapshot: VoxelEditSnapshot;
  terrainSummary: TerrainSummaryField | null;
  customPropsSettings: CustomPropsSettings | null;
  propPlacementScene: PropPlacementScene | null;
}

export async function runWorldBuildStartup(options: WorldBuildStartupOptions): Promise<WorldBuildStartupResult> {
  const cfg = parseConfig(configText);
  const terrainFieldConfig = resolveTerrainFieldConfig(cfg.terrainField);
  setTerrainFieldConfig(terrainFieldConfig);
  setTerrainFieldCoreConfig(terrainFieldConfig);

  const proceduralTextureConfig = parseProceduralTextureConfig(proceduralConfigText);
  const proceduralTerrainTextures = createProceduralTerrainTextures(proceduralTextureConfig);
  const bakedMacroTint = createBakedMacroTintTexture(proceduralTerrainTextures.noiseA, proceduralTerrainTextures.noiseB);

  const stoneConfig = parseStoneConfig(stoneConfigText);
  const treeConfig = parseTreeConfig(treeConfigText);
  const understoryConfig = parseUnderstoryConfig(understoryConfigText);
  const grassConfig = parseGrassConfig(grassConfigText);
  applyGrassMaterialBiasFromYaml(grassConfig);
  applyTreeMaterialBiasFromYaml(treeConfig);

  const forestLightingConfig = parseForestLightingConfig(forestLightingConfigText);
  const warnForestLighting = createForestLightingIntegrationWarner(forestLightingConfig);

  const baseWaterConfig = parseWaterConfig(waterConfigText);
  const waterConfig = isRiverParityTestScene(options.searchParams)
    ? applyRiverParityTestWaterConfig(baseWaterConfig)
    : baseWaterConfig;

  const worldPagesX = options.clodRuntime.worldPages;
  const worldPagesZ = options.clodRuntime.worldPagesZ ?? worldPagesX;
  const worldCells = worldPagesX * cfg.page.chunks_per_page * cfg.page.chunk_size;

  const resolvedWaterConfig = resolveWaterConfig(waterConfig, worldCells);
  const hydrology = new HydrologySystem({
    worldCells,
    config: resolvedWaterConfig,
    terrainHeight: baseSurfaceHeight,
  });
  const hydrologyTerrain = resolvedWaterConfig.source === "hydrology" ? hydrology.buildTerrainOverride() : null;
  const fakeWaterCarver = resolvedWaterConfig.source === "fake_bodies"
    ? makeFakeBodyCarvedSampler(resolvedWaterConfig, worldCells, baseSurfaceHeight)
    : null;
  const borderCoastConfig = parseBorderCoastOceanConfig(borderCoastOceanConfigText);
  setBorderCoastRuntime(borderCoastConfig, worldCells);

  if (hydrologyTerrain) {
    const { res, carvedBed } = hydrologyTerrain;
    const scale = (res - 1) / Math.max(1e-6, worldCells);
    setTerrainSurfaceOverride((x, z) => {
      const gx = Math.max(0, Math.min(res - 1, x * scale));
      const gz = Math.max(0, Math.min(res - 1, z * scale));
      const x0 = Math.floor(gx);
      const z0 = Math.floor(gz);
      const x1 = Math.min(res - 1, x0 + 1);
      const z1 = Math.min(res - 1, z0 + 1);
      const fx = gx - x0;
      const fz = gz - z0;
      const a = carvedBed[z0 * res + x0] * (1 - fx) + carvedBed[z0 * res + x1] * fx;
      const b = carvedBed[z1 * res + x0] * (1 - fx) + carvedBed[z1 * res + x1] * fx;
      return a * (1 - fz) + b * fz;
    });
  } else if (fakeWaterCarver) {
    setTerrainSurfaceOverride(fakeWaterCarver);
  } else {
    setTerrainSurfaceOverride(null);
  }

  const stagedTerrainSources: TerrainSourceInputs[] = [];
  if (options.stagedImport) {
    stagedTerrainSources.push(...buildStagedImportHash(options.stagedImport));
  }
  stagedTerrainSources.push(...buildProceduralTextureHash(proceduralTextureConfig));

  const cacheCtx = await initClodCacheContext({
    cfg,
    worldPages: worldPagesX,
    terrainSource: stagedTerrainSources,
    forceDisabled: options.searchParams.has("noClodCache"),
    role: "main",
  });
  const cacheSessionDisabled = isCacheSessionDisabled(options.searchParams);
  setCacheSessionDisabled(cacheSessionDisabled);
  clearWorkerCacheSnapshot();

  const worker = new ClodWorkerClient(new URL("../../clod_worker.ts", import.meta.url), {
    cfg,
    worldPagesX,
    worldPagesZ,
    voxelEdits: options.stagedImport?.voxelEdits,
    terrainFieldConfig,
    hydrologyTerrain,
    borderCoastOceanConfig: borderCoastConfig,
    terrainSource: stagedTerrainSources,
    cacheDisabled: cacheSessionDisabled,
  });

  worker.onProgress((progress) => {
    options.buildProgressPhase && (options.buildProgressPhase.textContent = progress.phase);
    if (options.buildProgressPercent) options.buildProgressPercent.textContent = `${Math.round(progress.fraction * 100)}%`;
    if (options.buildProgressBar) options.buildProgressBar.style.width = `${Math.round(progress.fraction * 100)}%`;
  });

  const build = await worker.build();
  if (cacheCtx) {
    const overlay = createCacheDebugOverlay(options.info);
    overlay.update(cacheCtx.service.getMetrics());
  }

  const nodes = build.nodes;
  const lod0Nodes = nodes.filter((node) => node.level === 0);
  const terrainSummary = publishTerrainSummaryForDiagnostics(nodes, worldCells);
  const voxelEditSnapshot = getVoxelEditSnapshot();
  replaceVoxelEdits(voxelEditSnapshot);

  const borderOceanSceneConfig = parseBorderOceanSceneConfig(borderOceanSceneConfigText);
  if (options.queryBorderOceanScene) {
    const overlaySummary = `border ocean scene active: ${borderOceanSceneConfig.label}`;
    options.info.textContent = `${options.info.textContent}\n${overlaySummary}`;
  }

  const customPropsSettings = parseCustomPropsConfig(customPropsConfigText);
  const propPlacementScene = parsePropPlacements(
    [customPropPlacementsText, customPropPlacements500Text, customPropPlacements5000Text, customPropPlacements20000Text],
    customPropsSettings,
  );

  const diag = aggregateDiagonalPolishStats(nodes);
  const diagLine = formatDiagonalPolishStats(diag);
  updateClodOverlay({
    nodes: nodes.length,
    lod0: lod0Nodes.length,
    worldPages: worldPagesX,
    lodRingMode: options.clodRuntime.lodRingMode,
    diagonalPolish: diagLine,
    digRevision: getDigEditRevision(),
    cache: build.cacheStats,
    bakedMacroTint,
  });

  return {
    cfg,
    worker,
    nodes,
    lod0Nodes,
    worldCells,
    waterConfig: resolvedWaterConfig,
    cacheCtx,
    borderCoastConfig,
    voxelEditSnapshot,
    terrainSummary,
    customPropsSettings,
    propPlacementScene,
  };
}
