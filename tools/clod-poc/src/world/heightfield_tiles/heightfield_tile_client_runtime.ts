import { ClodWorkerClient } from "../../clod_worker_client.js";
import {
  createHeightfieldTileRuntime,
  type HeightfieldTileRuntime,
  type HeightfieldTileRuntimeUpdate,
} from "./heightfield_tile_runtime.js";

interface ClientPrototype {
  buildWorld: ClodWorkerClient["buildWorld"];
  buildHeightfieldTiles: ClodWorkerClient["buildHeightfieldTiles"];
  dispose: ClodWorkerClient["dispose"];
}

const activeRuntimes = new WeakMap<ClodWorkerClient, HeightfieldTileRuntime>();
let installed = false;

function stopRuntime(client: ClodWorkerClient): void {
  const runtime = activeRuntimes.get(client);
  if (!runtime) return;
  runtime.dispose();
  activeRuntimes.delete(client);
}

function streamedRootWorkerIdle(): boolean {
  const counters = window.__drusnielClod?.stats?.counters;
  if (!counters) return true;
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
  runtime.update({
    ...input,
    buildAllowed: input.buildAllowed ?? streamedRootWorkerIdle(),
  });
}

export function installHeightfieldTileClientRuntime(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

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
    const runtime = await createHeightfieldTileRuntime({
      terrainSource,
      startupHeightfield,
      buildTiles: (keys, sourceRevision) => this.buildHeightfieldTiles(keys, sourceRevision),
    });
    if (runtime) activeRuntimes.set(this, runtime);
    return result;
  };

  prototype.dispose = function (this: ClodWorkerClient) {
    stopRuntime(this);
    originalDispose.call(this);
  };
}
