import {
  baseSurfaceHeight,
  setTerrainSurfaceOverride,
  buildCaveTestVoxelOverlay,
  type TerrainFieldConfig,
} from "../../terrain/terrain.js";
import {
  buildStartupHeightfieldRaster,
  makeStartupHeightfieldSampler,
  planStartupHeightfieldRaster,
  type StartupHeightfieldRaster,
} from "../../terrain/startup_heightfield_raster.js";
import { startupRasterHeightfieldSampler } from "../../world/heightfield_sampler.js";
import {
  computeHydrologyGraphParamsHash,
  createHydrologyGraphWorkerClient,
  IndexedDbHydrologyGraphStore,
  openHydrologyGraphDb,
  type HydrologyGraphArtifact,
} from "../../world/hydrology_graph/index.js";
import type { WorldManifest } from "../../world/world_manifest.js";
import {
  HydrologySystem,
  makeFakeBodyCarvedSampler,
  type WaterConfig,
} from "../../water/index.js";
import { createCarvedGraphHydrologySampler, createGraphHydrologySampler } from "../../water/graph_hydrology.js";
import {
  CHANNEL_CORRIDOR_LOCK_MARGIN_M,
  carveInfiniteHydrologyHeight,
  createTracedHydrologyCarver,
  isNearTracedChannel,
  measureTracedRiverContinuity,
  sampleInfiniteHydrology,
} from "../../water/infinite_hydrology.js";
import { setStreamingRootGpuMesherRuntimeControls } from "../../terrain/streaming/streamed_root_gpu_config.js";
import { setSimplifyCorridorLockQuery } from "../../lock.js";
import type { HydrologyWorldSampler } from "../../water/hydrologyTileSource.js";
import type { FeatureStampField } from "../../world/feature_stamps.js";
import { CAVE_TEST_SCENE } from "../world_mode.js";
import {
  booleanParam,
  HEIGHTFIELD_RASTER_REASON_CODES,
  measure,
  type StartupTimings,
} from "./world_build_startup_params.js";

export type HydrologyCarveConfig = {
  depthM: number;
  power: number;
  lakeBedDepthM: number;
};

export interface TracedHydrologyStartupResult {
  unifiedHydrologyRequested: boolean;
  tracedCarveConfig: HydrologyCarveConfig | null;
  tracedCarvedHeight: ((x: number, z: number) => number) | null;
  farCarveImprint: ((x: number, z: number, height: number, cellSizeM: number) => number) | null;
  tracedWorldSampler: HydrologyWorldSampler | undefined;
}

export function setupTracedHydrologyCarve(input: {
  isInfiniteIslands: boolean;
  waterConfig: WaterConfig;
  searchParams: URLSearchParams;
}): TracedHydrologyStartupResult {
  const { isInfiniteIslands, waterConfig, searchParams } = input;
  const unifiedHydrologyRequested = isInfiniteIslands
    && waterConfig.enabled
    && waterConfig.source === "hydrology"
    && waterConfig.hydrology.enabled
    && waterConfig.hydrology.infinite.unifiedStartup;
  // Traced-channel terrain carve (streamed worlds): rivers and lake beds dip under the
  // channel/spill level everywhere the terrain authority samples — same contract as the
  // continent graph carve, same config knobs.
  const tracedCarveConfig = unifiedHydrologyRequested ? {
    depthM: waterConfig.hydrology.rivers.carveDepthM,
    power: waterConfig.hydrology.rivers.carvePower,
    lakeBedDepthM: waterConfig.hydrology.rivers.visibleDepthM,
  } : null;
  const tracedCarvedHeight = tracedCarveConfig
    ? (() => {
        const carver = createTracedHydrologyCarver({ surfaceHeight: baseSurfaceHeight });
        return (x: number, z: number) => carver.carveHeight(x, z, baseSurfaceHeight(x, z), tracedCarveConfig);
      })()
    : null;
  // Far-summary carve imprint: same traced polylines, but with the channel half-width
  // floored at the consumer's cell size so a 10-28 m channel survives far-LOD sampling
  // instead of aliasing back into the pothole chain. One shared sampler object keeps the
  // channel/basin memos (WeakMap-keyed per sampler) warm across imprint and lock calls.
  const tracedMainSampler = { surfaceHeight: baseSurfaceHeight };
  const farCarveImprint = tracedCarveConfig
    ? (x: number, z: number, height: number, cellSizeM: number) =>
        carveInfiniteHydrologyHeight(x, z, height, tracedMainSampler, tracedCarveConfig, Math.max(0, cellSizeM))
    : null;
  // Main-thread analogue of the worker's corridor-lock install: parent simplification
  // that runs on this thread (the GPU root mesher's weld+simplify) locks river-corridor
  // vertices so channels survive coarse LODs.
  setSimplifyCorridorLockQuery(tracedCarveConfig
    ? (x, z) => isNearTracedChannel(x, z, tracedMainSampler, CHANNEL_CORRIDOR_LOCK_MARGIN_M)
    : null);
  // GPU-meshed roots evaluate the terrain field in WGSL, where the traced polyline carve
  // cannot run: root-level terrain reverts to uncarved pothole chains at mid distance
  // while near CPU pages and the imprinted far summary both carry the carve. Default the
  // GPU root mesher off on traced worlds (before any build, so startup pages are covered
  // too); an explicit liveClodRootGpuMesher param still wins for A/B runs.
  if (tracedCarveConfig && searchParams.get("liveClodRootGpuMesher") === null) {
    setStreamingRootGpuMesherRuntimeControls({ enabled: false });
  }
  const tracedWorldSampler: HydrologyWorldSampler | undefined = tracedCarveConfig
    ? (x, z, sampler, options) => sampleInfiniteHydrology(x, z, sampler, { ...options, carve: tracedCarveConfig })
    : undefined;
  return {
    unifiedHydrologyRequested,
    tracedCarveConfig,
    tracedCarvedHeight,
    farCarveImprint,
    tracedWorldSampler,
  };
}

export function buildStartupHydrologySystem(input: {
  continentHydrologyRequested: boolean;
  waterConfig: WaterConfig;
  worldCells: number;
  isStreamedWorld: boolean;
  unifiedHydrologyRequested: boolean;
  tracedCarveConfig: HydrologyCarveConfig | null;
  tracedCarvedHeight: ((x: number, z: number) => number) | null;
  tracedWorldSampler: HydrologyWorldSampler | undefined;
  startupTimings: StartupTimings;
}): HydrologySystem | null {
  const {
    continentHydrologyRequested,
    waterConfig,
    worldCells,
    isStreamedWorld,
    unifiedHydrologyRequested,
    tracedCarveConfig,
    tracedCarvedHeight,
    tracedWorldSampler,
    startupTimings,
  } = input;
  return measure(startupTimings, "startup.hydrology_ms", () => {
    if (continentHydrologyRequested) return null;
    const baseTerrainSampler = { surfaceHeight: baseSurfaceHeight };
    const preHydrologyTerrain = unifiedHydrologyRequested
      ? baseTerrainSampler
      : makeFakeBodyCarvedSampler(waterConfig, baseTerrainSampler);
    const system = waterConfig.enabled && waterConfig.source === "hydrology" && waterConfig.hydrology.enabled
      ? HydrologySystem.build(waterConfig.hydrology, worldCells, preHydrologyTerrain, {
          infiniteWorldSamples: isStreamedWorld,
          ...(tracedCarveConfig && tracedCarvedHeight && tracedWorldSampler ? {
            worldSampler: tracedWorldSampler,
            remoteTileAuthority: { graph: null, carve: tracedCarveConfig },
            carvedTerrainHeight: tracedCarvedHeight,
          } : {}),
        })
      : null;
    if (system?.unifiedStartupActive()) {
      // Water is a raster/view of the traced authority. With the carve enabled the
      // terrain authority is the carved field; without it the raw procedural field.
      setTerrainSurfaceOverride(tracedCarvedHeight);
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
}

export function measureTracedRiverContinuityGate(input: {
  tracedCarveConfig: HydrologyCarveConfig;
  hydrologySystem: HydrologySystem | null;
  worldCells: number;
  waterConfig: WaterConfig;
  startupTimings: StartupTimings;
}): void {
  const { tracedCarveConfig, hydrologySystem, worldCells, waterConfig, startupTimings } = input;
  if (!(tracedCarveConfig && hydrologySystem?.unifiedStartupActive())) return;
  // W1 continuity gate: every traced channel vertex near spawn must have a carved bed
  // below level - minVisibleDepth (continuous rivers, not pothole chains).
  const continuity = measure(startupTimings, "startup.river_continuity_ms", () =>
    measureTracedRiverContinuity(
      worldCells / 2,
      worldCells / 2,
      1536,
      { surfaceHeight: baseSurfaceHeight },
      tracedCarveConfig,
      waterConfig.hydrology.rivers.minVisibleDepth,
    ));
  startupTimings["river_continuity_pct"] = continuity.pct;
  startupTimings["river_continuity_channels"] = continuity.channels;
  console.info(
    `[water] traced river continuity ${continuity.pct.toFixed(1)}% ` +
      `(${continuity.okPoints}/${continuity.points} points, ${continuity.channels} channels)`,
  );
}

export function buildNonContinentStartupHeightfield(input: {
  unifiedHydrology: boolean;
  continentHydrologyRequested: boolean;
  searchParams: URLSearchParams;
  worldCells: number;
  tracedCarvedHeight: ((x: number, z: number) => number) | null;
  startupTimings: StartupTimings;
}): {
  heightfieldRasterRequested: boolean;
  heightfieldRasterPlan: ReturnType<typeof planStartupHeightfieldRaster>;
  startupHeightfield: StartupHeightfieldRaster | null;
} {
  const {
    unifiedHydrology,
    continentHydrologyRequested,
    searchParams,
    worldCells,
    tracedCarvedHeight,
    startupTimings,
  } = input;
  const heightfieldRasterRequested = unifiedHydrology
    && booleanParam(searchParams, ["heightfieldRaster", "heightfield_raster"], true);
  const heightfieldRasterPlan = planStartupHeightfieldRaster(worldCells);
  startupTimings["startup.heightfield_raster_requested"] = heightfieldRasterRequested ? 1 : 0;
  startupTimings["startup.heightfield_raster_budget_enabled"] = heightfieldRasterPlan.enabled ? 1 : 0;
  startupTimings["startup.heightfield_raster_budget_reason_code"] = HEIGHTFIELD_RASTER_REASON_CODES[heightfieldRasterPlan.reason];
  startupTimings["startup.heightfield_raster_samples"] = heightfieldRasterPlan.sampleCount;
  startupTimings["startup.heightfield_raster_bytes"] = heightfieldRasterPlan.byteLength;
  let startupHeightfield = heightfieldRasterRequested && heightfieldRasterPlan.enabled && !continentHydrologyRequested
    ? measure(startupTimings, "startup.heightfield_raster_ms", () =>
        buildStartupHeightfieldRaster(worldCells, tracedCarvedHeight ?? undefined))
    : null;
  if (startupHeightfield) {
    // With the traced carve active the raster bakes carved heights, so everything the
    // raster does not answer (fractional reads, outside the padded domain) must fall
    // back to the carved field, not the raw one.
    setTerrainSurfaceOverride(tracedCarvedHeight
      ? makeStartupHeightfieldSampler(startupHeightfield, tracedCarvedHeight)
      : startupRasterHeightfieldSampler(startupHeightfield).sampleHeight);
    startupTimings["startup.heightfield_raster_res"] = startupHeightfield.res;
  }
  startupTimings["startup.heightfield_raster_enabled"] = startupHeightfield ? 1 : 0;
  return { heightfieldRasterRequested, heightfieldRasterPlan, startupHeightfield };
}

export interface ContinentHydrologyGraphStartupResult {
  hydrologyGraphArtifact: HydrologyGraphArtifact;
  startupHeightfield: StartupHeightfieldRaster | null;
  hydrologySystem: HydrologySystem;
  voxelOverlay: ReturnType<typeof buildCaveTestVoxelOverlay> | null;
}

export async function runContinentHydrologyGraphStartup(input: {
  waterConfig: WaterConfig;
  worldManifest: WorldManifest;
  acceptanceTerrainSourceHash: string;
  seed: number;
  terrainFieldConfig: TerrainFieldConfig;
  worldCells: number;
  heightfieldRasterRequested: boolean;
  heightfieldRasterPlan: ReturnType<typeof planStartupHeightfieldRaster>;
  featureStamps: FeatureStampField | null | undefined;
  sceneName: string;
  startupHeightfield: StartupHeightfieldRaster | null;
  voxelOverlay: ReturnType<typeof buildCaveTestVoxelOverlay> | null;
  graphCarveConfig: HydrologyCarveConfig;
  buildProgress: HTMLElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  buildStatus: { value: string };
  updateBuildOverlay: () => void;
  startupTimings: StartupTimings;
}): Promise<ContinentHydrologyGraphStartupResult> {
  const {
    waterConfig,
    worldManifest,
    acceptanceTerrainSourceHash,
    seed,
    terrainFieldConfig,
    worldCells,
    heightfieldRasterRequested,
    heightfieldRasterPlan,
    featureStamps,
    sceneName,
    graphCarveConfig,
    buildProgress,
    buildProgressPhase,
    buildProgressPercent,
    buildProgressBar,
    buildStatus,
    updateBuildOverlay,
    startupTimings,
  } = input;
  let { startupHeightfield, voxelOverlay } = input;

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
    acceptanceTerrainSourceHash,
    graphParamsHash,
  );
  const graphStartedAt = performance.now();
  let hydrologyGraphArtifact: HydrologyGraphArtifact;
  try {
    const loaded = await graphStore.load();
    if (loaded) {
      hydrologyGraphArtifact = loaded;
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
    graphCarveConfig,
    waterConfig.hydrology.waterSurface.drySentinelDepth,
  );
  waterConfig.hydrology.infinite.source = "graph";
  if (heightfieldRasterRequested && heightfieldRasterPlan.enabled) {
    startupHeightfield = measure(startupTimings, "startup.heightfield_raster_ms", () =>
      buildStartupHeightfieldRaster(worldCells, (x, z) => {
        const carved = graphSampler.carveHeight(x, z, baseSurfaceHeight(x, z), graphCarveConfig);
        return Math.fround(featureStamps?.sampleHeight(x, z, carved) ?? carved);
      }));
    if (startupHeightfield) {
      setTerrainSurfaceOverride(startupRasterHeightfieldSampler(startupHeightfield).sampleHeight);
      startupTimings["startup.heightfield_raster_res"] = startupHeightfield.res;
    }
    startupTimings["startup.heightfield_raster_enabled"] = startupHeightfield ? 1 : 0;
  }
  const hydrologySystem = measure(startupTimings, "startup.hydrology_graph_grid_ms", () => HydrologySystem.build(
    waterConfig.hydrology,
    worldCells,
    { surfaceHeight: baseSurfaceHeight },
    {
      infiniteWorldSamples: true,
      worldSampler: (x, z) => carvedGraphSampler.sample(x, z),
      remoteTileAuthority: {
        graph: hydrologyGraphArtifact.graph,
        carve: graphCarveConfig,
      },
    },
  ));
  if (sceneName === CAVE_TEST_SCENE) {
    voxelOverlay = buildCaveTestVoxelOverlay((x, z) => graphSampler.carveHeight(x, z, baseSurfaceHeight(x, z), graphCarveConfig));
  }
  return {
    hydrologyGraphArtifact,
    startupHeightfield,
    hydrologySystem,
    voxelOverlay,
  };
}

export function hydrologyTerrainPayload(
  hydrologySystem: HydrologySystem | null,
  unifiedHydrology: boolean,
): {
  res: number;
  worldCells: number;
  carvedBed: Float32Array;
} | null {
  return hydrologySystem && !unifiedHydrology
    ? {
        res: hydrologySystem.grid.res,
        worldCells: hydrologySystem.grid.worldCells,
        carvedBed: hydrologySystem.grid.carvedBed,
      }
    : null;
}

export function graphCarveConfigFromWater(waterConfig: WaterConfig, continentHydrologyRequested: boolean): HydrologyCarveConfig | null {
  return continentHydrologyRequested ? {
    depthM: waterConfig.hydrology.rivers.carveDepthM,
    power: waterConfig.hydrology.rivers.carvePower,
    lakeBedDepthM: waterConfig.hydrology.rivers.visibleDepthM,
  } : null;
}
