import { ClodWorkerClient } from "../../clod_worker_client.js";
import {
  createHeightfieldTileRuntime,
  type HeightfieldTileRuntime,
  type HeightfieldTileRuntimeUpdate,
} from "./heightfield_tile_runtime.js";
import { WORLD_TILE_SIZE_M } from "../tile_key.js";
import { getSaveRuntimeFeatureStamps, subscribeSaveRuntimeFeatureStamps } from "../../save/save_runtime.js";
import { baseSurfaceHeight } from "../../terrain/terrain.js";
import { createGraphHydrologySampler } from "../../water/graph_hydrology.js";
import { featureStampFieldFromStamps, type FeatureTerrainStamp } from "../feature_stamps.js";
import type { HeightfieldSampler } from "../heightfield_sampler.js";

interface ClientPrototype {
  buildWorld: ClodWorkerClient["buildWorld"];
  buildHeightfieldTiles: ClodWorkerClient["buildHeightfieldTiles"];
  dispose: ClodWorkerClient["dispose"];
}

const activeRuntimes = new WeakMap<ClodWorkerClient, HeightfieldTileRuntime>();
const runtimeSet = new Set<HeightfieldTileRuntime>();
let installed = false;

function canonicalFallbackSampler(
  graph: Parameters<ClodWorkerClient["buildWorld"]>[11],
  carve: Parameters<ClodWorkerClient["buildWorld"]>[12],
  stamps: readonly FeatureTerrainStamp[] | undefined,
): HeightfieldSampler | undefined {
  if (!graph || !carve) return undefined;
  const hydrology = createGraphHydrologySampler(graph, { surfaceHeight: baseSurfaceHeight });
  const initialFeatures = stamps ? featureStampFieldFromStamps(stamps) : null;
  return Object.freeze({
    kind: "heightfield_tiles" as const,
    domain: null,
    sourceRevision: 0,
    sampleHeight(x: number, z: number): number {
      const carved = hydrology.carveHeight(x, z, baseSurfaceHeight(x, z), carve);
      const features = getSaveRuntimeFeatureStamps() ?? initialFeatures;
      return Math.fround(features?.sampleHeight(x, z, carved) ?? carved);
    },
  });
}

function stopRuntime(client: ClodWorkerClient): void {
  const runtime = activeRuntimes.get(client);
  if (!runtime) return;
  runtime.dispose();
  runtimeSet.delete(runtime);
  activeRuntimes.delete(client);
}

export function heightfieldTilesReadyForPage(
  client: ClodWorkerClient,
  coord: { px: number; pz: number; level?: number },
  basePageSizeM: number,
): boolean {
  const runtime = activeRuntimes.get(client);
  if (!runtime?.authoritative) return true;
  const level = Math.max(0, Math.floor(coord.level ?? 0));
  const span = basePageSizeM * (2 ** level);
  const minX = coord.px * span;
  const minZ = coord.pz * span;
  const firstTileX = Math.floor(minX / WORLD_TILE_SIZE_M);
  const firstTileZ = Math.floor(minZ / WORLD_TILE_SIZE_M);
  const lastTileX = Math.ceil((minX + span) / WORLD_TILE_SIZE_M) - 1;
  const lastTileZ = Math.ceil((minZ + span) / WORLD_TILE_SIZE_M) - 1;
  for (let tileZ = firstTileZ; tileZ <= lastTileZ; tileZ++) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX++) {
      if (!runtime.cache.get({ x: tileX, z: tileZ })) return false;
    }
  }
  return true;
}

export function heightfieldTileBuildAllowed(
  counters: Readonly<Record<string, number>> | null | undefined,
): boolean {
  if (!counters) return false;
  const requiredPages = counters["live_clod_stream_required_pages"];
  const readyPages = counters["live_clod_stream_ready_pages"];
  if (!Number.isFinite(requiredPages) || !Number.isFinite(readyPages)) return false;
  if (requiredPages! > 0 && readyPages! <= 0) return false;
  return (counters["live_clod_stream_pending_pages"] ?? 0) === 0
    && (counters["live_clod_stream_inflight_batches"] ?? 0) === 0
    && (counters["live_clod_stream_apply_queue_pages"] ?? 0) === 0
    && (counters["live_clod_stream_safety_pending_pages"] ?? 0) === 0
    && (counters["live_clod_stream_safety_inflight_pages"] ?? 0) === 0;
}

export function updateHeightfieldTileClientRuntime(
  client: ClodWorkerClient,
  input: HeightfieldTileRuntimeUpdate,
): void {
  const runtime = activeRuntimes.get(client);
  if (!runtime) return;
  if (runtime.authoritative) {
    runtime.update({ ...input, buildAllowed: true });
    return;
  }
  if (input.buildAllowed !== undefined) {
    runtime.update(input);
    return;
  }

  runtime.update({ ...input, buildAllowed: false });
  queueMicrotask(() => {
    if (activeRuntimes.get(client) !== runtime) return;
    runtime.cache.setBuildAllowed(heightfieldTileBuildAllowed(window.__drusnielClod?.stats?.counters));
  });
}

export function installHeightfieldTileClientRuntime(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  subscribeSaveRuntimeFeatureStamps((bounds) => {
    for (const runtime of runtimeSet) runtime.invalidateBounds(bounds);
  });

  const prototype = ClodWorkerClient.prototype as ClientPrototype;
  const originalBuildWorld = prototype.buildWorld;
  const originalDispose = prototype.dispose;

  prototype.buildWorld = async function (
    this: ClodWorkerClient,
    ...args: Parameters<ClodWorkerClient["buildWorld"]>
  ) {
    stopRuntime(this);
    const result = await originalBuildWorld.apply(this, args);
    const terrainSource = args[9];
    const startupHeightfield = args[10] ?? null;
    const featureStamps = args[13];
    const runtime = await createHeightfieldTileRuntime({
      terrainSource,
      startupHeightfield,
      fallbackSampler: canonicalFallbackSampler(args[11], args[12], featureStamps),
      buildTiles: (keys, sourceRevision) => this.buildHeightfieldTiles(
        keys,
        sourceRevision,
        getSaveRuntimeFeatureStamps()?.stamps ?? featureStamps,
      ),
    });
    if (runtime) {
      activeRuntimes.set(this, runtime);
      runtimeSet.add(runtime);
    }
    return result;
  };

  prototype.dispose = function (this: ClodWorkerClient) {
    stopRuntime(this);
    originalDispose.call(this);
  };
}
