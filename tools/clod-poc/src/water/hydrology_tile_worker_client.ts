// Main-thread client for the hydrology tile build worker.
//
// Fail-safe by design: if the Worker cannot be constructed (test environments) or errors
// at runtime, the client reports unavailable and the tile cache falls back to its
// synchronous build path inside sample() — correct but a frame spike, so the worker
// path is an optimization, never a correctness dependency.

import type { TerrainFieldConfigInput } from "../terrain/terrain_surface.js";
import type { HydrologyGraph } from "../world/hydrology_graph/hydrology_graph.js";
import type { GraphTerrainCarveConfig } from "./graph_hydrology.js";
import type { WaterConfig } from "./waterConfig.js";
import type { HydrologyTile, HydrologyTileRemoteSource } from "./hydrologyTileSource.js";
import type {
  HydrologyTileWorkerRequest,
  HydrologyTileWorkerResponse,
} from "./hydrology_tile_worker_protocol.js";

export interface HydrologyTileRemoteBuilder extends HydrologyTileRemoteSource {
  configure(input: {
    terrainFieldConfig: TerrainFieldConfigInput | null;
    fakeBodies: WaterConfig["fakeBodies"];
    tileSizeM: number;
    tileRes: number;
    drySentinelDepthM: number;
    hydrologyGraph: HydrologyGraph | null;
    hydrologyCarve: GraphTerrainCarveConfig | null;
  }): void;
  dispose(): void;
}

interface PendingBuild {
  resolve: (tiles: HydrologyTile[]) => void;
  reject: (error: Error) => void;
}

export function createHydrologyTileRemoteBuilder(): HydrologyTileRemoteBuilder | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./hydrology_tile_build_worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  let failed = false;
  let configId = 0;
  let nextRequestId = 1;
  const pending = new Map<number, PendingBuild>();

  const failAll = (message: string): void => {
    failed = true;
    const error = new Error(message);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  worker.onmessage = (event: MessageEvent<HydrologyTileWorkerResponse>) => {
    const response = event.data;
    if (response.type === "error") {
      failAll(`hydrology tile build worker error: ${response.message}`);
      return;
    }
    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    // A batch answered under an older configId raced a reconfigure; its tiles would be
    // built from stale terrain/water config, so drop them and let prefetch re-queue.
    if (response.configId !== configId) {
      request.resolve([]);
      return;
    }
    request.resolve(response.tiles);
  };
  worker.onerror = (event) => {
    failAll(`hydrology tile build worker crashed: ${event.message ?? "unknown error"}`);
  };

  const post = (message: HydrologyTileWorkerRequest): void => {
    worker.postMessage(message);
  };

  return {
    available: () => !failed,
    configure(input) {
      if (failed) return;
      configId++;
      post({
        type: "configure",
        configId,
        terrainFieldConfig: input.terrainFieldConfig,
        fakeBodies: input.fakeBodies,
        tileSizeM: input.tileSizeM,
        tileRes: input.tileRes,
        drySentinelDepthM: input.drySentinelDepthM,
        hydrologyGraph: input.hydrologyGraph,
        hydrologyCarve: input.hydrologyCarve,
      });
    },
    build(tiles) {
      if (failed) return Promise.reject(new Error("hydrology tile build worker unavailable"));
      const requestId = nextRequestId++;
      return new Promise<HydrologyTile[]>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        post({ type: "build", requestId, configId, tiles });
      });
    },
    dispose() {
      failAll("hydrology tile build worker disposed");
      worker.terminate();
    },
  };
}
