// Hydrology tile build worker: runs buildHydrologyTileData off the main thread.
//
// One tile is (tileRes+1)² × sampleInfiniteHydrology — each sample does many terrain
// lookups, so a tile costs 100–250 ms of CPU. Built synchronously inside a clipmap
// refill this is a frame spike; here it runs off-thread and the cache adopts results.
//
// Exactness contract: the sampler is the identical construction the main thread uses
// (makeFakeBodyCarvedSampler over baseSurfaceHeight with the same terrain field config
// installed via setTerrainFieldConfig), so tiles match the synchronous path bit for bit.

import { baseSurfaceHeight, setTerrainFieldConfig } from "../terrain/terrain.js";
import { makeFakeBodyCarvedSampler } from "./fakeBodyCarve.js";
import { createCarvedGraphHydrologySampler } from "./graph_hydrology.js";
import { sampleInfiniteHydrology } from "./infinite_hydrology.js";
import {
  buildHydrologyTileData,
  type HydrologyTileBuildOptions,
  type HydrologyWorldSampler,
} from "./hydrologyTileSource.js";
import type { TerrainHeightSampler } from "./water_field_types.js";
import type { WaterConfig } from "./waterConfig.js";
import {
  hydrologyTileTransferables,
  type HydrologyTileWorkerConfigureRequest,
  type HydrologyTileWorkerRequest,
  type HydrologyTileWorkerResponse,
} from "./hydrology_tile_worker_protocol.js";

const ctx = self as unknown as {
  postMessage: (message: HydrologyTileWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<HydrologyTileWorkerRequest>) => void) | null;
};

interface WorkerState {
  configId: number;
  sampler: TerrainHeightSampler;
  sampleHydrology?: HydrologyWorldSampler;
  options: HydrologyTileBuildOptions;
}

let state: WorkerState | null = null;

function handleConfigure(request: HydrologyTileWorkerConfigureRequest): void {
  setTerrainFieldConfig(request.terrainFieldConfig);
  // makeFakeBodyCarvedSampler only reads config.fakeBodies; the cast keeps the
  // configure payload minimal instead of shipping the whole water config.
  const carveConfig = { fakeBodies: request.fakeBodies } as WaterConfig;
  const graphSampler = request.hydrologyGraph && request.hydrologyCarve
    ? createCarvedGraphHydrologySampler(
        request.hydrologyGraph,
        { surfaceHeight: baseSurfaceHeight },
        request.hydrologyCarve,
        request.drySentinelDepthM,
      )
    : null;
  // Traced carve (streamed worlds): carve config without a graph. The traced field
  // itself applies the carve, so tiles report the carved bed as terrainY — identical
  // to the synchronous main-thread path, which passes the same carve option.
  const tracedCarve = !request.hydrologyGraph ? request.hydrologyCarve : null;
  state = {
    configId: request.configId,
    sampler: graphSampler
      ? { surfaceHeight: baseSurfaceHeight }
      : makeFakeBodyCarvedSampler(carveConfig, { surfaceHeight: baseSurfaceHeight }),
    sampleHydrology: graphSampler
      ? (x, z) => graphSampler.sample(x, z)
      : tracedCarve
        ? (x, z, sampler, options) => sampleInfiniteHydrology(x, z, sampler, { ...options, carve: tracedCarve })
        : undefined,
    options: {
      tileSizeM: request.tileSizeM,
      tileRes: request.tileRes,
      drySentinelDepthM: request.drySentinelDepthM,
    },
  };
}

function handleBuild(request: Extract<HydrologyTileWorkerRequest, { type: "build" }>): void {
  if (!state || state.configId !== request.configId) {
    // Stale batch from before a reconfigure; report empty so the client re-queues.
    ctx.postMessage({ type: "built", requestId: request.requestId, configId: request.configId, tiles: [], buildMs: 0 });
    return;
  }
  const t0 = performance.now();
  const tiles = request.tiles.map((coord) =>
    buildHydrologyTileData(
      coord.tileX,
      coord.tileZ,
      state!.sampler,
      state!.options,
      state!.sampleHydrology,
    ));
  ctx.postMessage({
    type: "built",
    requestId: request.requestId,
    configId: request.configId,
    tiles,
    buildMs: performance.now() - t0,
  }, hydrologyTileTransferables(tiles));
}

ctx.onmessage = (event: MessageEvent<HydrologyTileWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "configure") handleConfigure(request);
    else handleBuild(request);
  } catch (error) {
    ctx.postMessage({
      type: "error",
      requestId: request.type === "build" ? request.requestId : null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
