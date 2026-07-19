// Main-thread client for the hydrology tile build worker.
//
// Fail-safe by design: if the Worker cannot be constructed (test environments) or errors
// at runtime, the client reports unavailable and the tile cache falls back to its
// synchronous build path inside sample() — correct but a frame spike, so the worker
// path is an optimization, never a correctness dependency.

import type { TerrainFieldConfigInput } from "../terrain/terrain_surface.js";
import type { HydrologyGraph } from "../world/hydrology_graph/hydrology_graph.js";
import type { GraphTerrainCarveConfig } from "./graph_hydrology.js";
import {
  readGravelBarSettings,
  readGravelBedSettings,
} from "./gravel_bar_runtime.js";
import type {
  HydrologyGravelBarsConfig,
  HydrologyGravelBedConfig,
} from "./hydrologyConfig.js";
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
    gravelBars?: HydrologyGravelBarsConfig;
    gravelBed?: HydrologyGravelBedConfig;
  }): void;
  dispose(): void;
}

interface PendingBuild {
  resolve: (tiles: HydrologyTile[]) => void;
  reject: (error: Error) => void;
}

function asError(error: unknown, prefix: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${prefix}: ${message}`);
}

export function createHydrologyTileRemoteBuilder(): HydrologyTileRemoteBuilder | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./hydrology_tile_build_worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  let terminalError: Error | null = null;
  let workerTerminated = false;
  let configId = 0;
  let nextRequestId = 1;
  const pending = new Map<number, PendingBuild>();

  const terminateWorker = (): void => {
    if (workerTerminated) return;
    workerTerminated = true;
    worker.terminate();
  };

  const failTerminally = (error: Error): Error => {
    if (!terminalError) {
      terminalError = error;
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    }
    terminateWorker();
    return terminalError;
  };

  const post = (message: HydrologyTileWorkerRequest): void => {
    if (terminalError) throw terminalError;
    try {
      worker.postMessage(message);
    } catch (error) {
      throw failTerminally(asError(error, "hydrology tile build worker post failed"));
    }
  };

  worker.onmessage = (event: MessageEvent<HydrologyTileWorkerResponse>) => {
    if (terminalError) return;
    const response = event.data;
    if (response.type === "error") {
      failTerminally(new Error(`hydrology tile build worker error: ${response.message}`));
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
    failTerminally(new Error(`hydrology tile build worker crashed: ${event.message ?? "unknown error"}`));
  };
  worker.onmessageerror = () => {
    failTerminally(new Error("hydrology tile build worker produced an unreadable message"));
  };

  return {
    available: () => terminalError === null,
    configure(input) {
      if (terminalError) return;
      const nextConfigId = configId + 1;
      post({
        type: "configure",
        configId: nextConfigId,
        terrainFieldConfig: input.terrainFieldConfig,
        fakeBodies: input.fakeBodies,
        tileSizeM: input.tileSizeM,
        tileRes: input.tileRes,
        drySentinelDepthM: input.drySentinelDepthM,
        hydrologyGraph: input.hydrologyGraph,
        hydrologyCarve: input.hydrologyCarve,
        gravelBars: { ...(input.gravelBars ?? readGravelBarSettings()) },
        gravelBed: { ...(input.gravelBed ?? readGravelBedSettings()) },
      });
      configId = nextConfigId;
    },
    build(tiles) {
      if (terminalError) return Promise.reject(terminalError);
      const requestId = nextRequestId++;
      return new Promise<HydrologyTile[]>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        try {
          post({ type: "build", requestId, configId, tiles });
        } catch (error) {
          if (pending.delete(requestId)) reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    dispose() {
      failTerminally(new Error("hydrology tile build worker disposed"));
    },
  };
}
