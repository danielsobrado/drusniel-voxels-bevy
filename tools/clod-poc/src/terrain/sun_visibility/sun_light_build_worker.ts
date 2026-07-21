// Sun-light tile build worker: runs buildLightTile off the main thread.
//
// Exactness contract: heights are sampled through the same composed terrain-summary,
// analytic-fallback, and committed large-prop height path as the main-thread provider.
// Worker-built tiles therefore match main-thread tiles bit for bit; parity tests pin both
// terrain-only and sparse-prop configurations.

import {
  buildSunLightWorkerTiles,
  sunLightWorkerStateFromConfigure,
  type SunLightWorkerState,
} from "./sun_light_worker_build.js";
import type { SunLightWorkerRequest, SunLightWorkerResponse } from "./sun_light_worker_protocol.js";

const ctx = self as unknown as {
  postMessage: (message: SunLightWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<SunLightWorkerRequest>) => void) | null;
};

let state: SunLightWorkerState | null = null;

function handleBuild(request: Extract<SunLightWorkerRequest, { type: "build" }>): void {
  if (!state || state.configId !== request.configId) {
    // Stale batch from before a reconfigure; report empty so the client re-queues the tiles.
    ctx.postMessage({ type: "built", requestId: request.requestId, configId: request.configId, tiles: [], buildMs: 0 });
    return;
  }
  const t0 = performance.now();
  const tiles = buildSunLightWorkerTiles(state, request.tiles);
  ctx.postMessage({
    type: "built",
    requestId: request.requestId,
    configId: request.configId,
    tiles,
    buildMs: performance.now() - t0,
  }, tiles.map((tile) => tile.values.buffer));
}

ctx.onmessage = (event: MessageEvent<SunLightWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "configure") state = sunLightWorkerStateFromConfigure(request);
    else handleBuild(request);
  } catch (error) {
    ctx.postMessage({
      type: "error",
      requestId: request.type === "build" ? request.requestId : null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
