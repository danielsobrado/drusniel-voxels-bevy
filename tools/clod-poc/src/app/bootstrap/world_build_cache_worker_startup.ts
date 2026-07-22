import type { ClodPagesConfig } from "../../config.js";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
import {
  type BorderCoastOceanConfig,
  type TerrainFieldConfig,
  type VoxelEditSnapshot,
} from "../../terrain/terrain.js";
import type { StartupHeightfieldRaster } from "../../terrain/startup_heightfield_raster.js";
import type { HydrologyGraphArtifact } from "../../world/hydrology_graph/index.js";
import { publishTerrainSummaryForDiagnostics } from "./diagnostics_startup.js";
import {
  initClodCacheContext,
  loadTerrainSummaryWithCacheSimple,
  createCacheDebugOverlay,
  isCacheSessionDisabled,
} from "../../cache/index.js";
import type { TerrainSourceInputs } from "../../cache/terrainSource.js";
import { getWorkerCacheBuildStats } from "../../cache/cacheMetricsBridge.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import { aggregateDiagonalPolishStats, formatDiagonalPolishStats } from "../../diagonalPolish.js";
import type { ClodPageNode } from "../../types.js";
import type { WorldSource } from "../../world_source/world_source.js";
import type { HeightmapSource } from "../../terrain/heightmap_source.js";
import type { FeatureStampField } from "../../world/feature_stamps.js";
import { splitWorldBuildNodes } from "./world_build_nodes.js";
import { measureAsync, type StartupTimings } from "./world_build_startup_params.js";
import type { HydrologyCarveConfig } from "./world_build_hydrology_startup.js";

export interface WorldBuildCacheWorkerResult {
  result: Awaited<ReturnType<ClodWorkerClient["buildWorld"]>>;
  lod0Nodes: ClodPageNode[];
  allNodes: ClodPageNode[];
  maxTerrainLevel: number;
  terrainSummary: TerrainSummaryField;
  polishLine: string;
}

export async function runWorldBuildCacheWorkerStartup(input: {
  cfg: ClodPagesConfig;
  WORLD: number;
  worldCells: number;
  terrainSource: TerrainSourceInputs;
  clodWorker: ClodWorkerClient;
  searchParams: URLSearchParams;
  voxelSnapshot: VoxelEditSnapshot;
  terrainFieldConfig: TerrainFieldConfig;
  hydrologyTerrain: {
    res: number;
    worldCells: number;
    carvedBed: Float32Array;
  } | null;
  effectiveBorderCoast: BorderCoastOceanConfig;
  startupHeightfield: StartupHeightfieldRaster | null;
  hydrologyGraphArtifact: HydrologyGraphArtifact | null;
  graphCarveConfig: HydrologyCarveConfig | null;
  tracedCarveConfig: HydrologyCarveConfig | null;
  featureStamps: FeatureStampField | null | undefined;
  heightmapSource: HeightmapSource | null;
  worldSource: WorldSource;
  buildProgress: HTMLElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  buildStatus: { value: string };
  updateBuildOverlay: () => void;
  info: HTMLElement;
  startupTimings: StartupTimings;
  startupStartedAt: number;
  configuredWorld: number;
}): Promise<WorldBuildCacheWorkerResult> {
  const {
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
  } = input;

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
      hydrologyGraphArtifact ? graphCarveConfig : tracedCarveConfig,
      featureStamps?.stamps,
      heightmapSource,
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
    result,
    lod0Nodes,
    allNodes,
    maxTerrainLevel,
    terrainSummary,
    polishLine,
  };
}
