// Main-thread client for the sun-light tile build worker.
//
// Fail-safe by design: if the Worker cannot be constructed (test environments) or errors
// at runtime, the client reports unavailable and the cache runtime falls back to its
// main-thread budgeted build path. Sun-light tiles are a soft lighting cache, so silent
// fallback is the correct failure mode (unlike gated WebGPU scenes, which fail loud).

import type { TerrainFieldConfig } from "../terrain.js";
import type { SunLightOptions } from "./sun_light_options.js";
import type {
  SunLightWorkerBuiltTile,
  SunLightWorkerRequest,
  SunLightWorkerResponse,
  SunLightWorkerSummaryPayload,
  SunLightWorkerTileRequest,
} from "./sun_light_worker_protocol.js";

export interface SunLightRemoteTileSource {
  available(): boolean;
  /** Resolves to the built tiles, or [] when the batch raced a reconfigure; rejects on worker failure. */
  build(tiles: SunLightWorkerTileRequest[]): Promise<SunLightWorkerBuiltTile[]>;
}

export interface SunLightRemoteTileBuilder extends SunLightRemoteTileSource {
  configure(input: {
    terrainFieldConfig: TerrainFieldConfig | null;
    summary: SunLightWorkerSummaryPayload | null;
    options: SunLightOptions;
  }): void;
  dispose(): void;
}

interface PendingBuild {
  resolve: (tiles: SunLightWorkerBuiltTile[]) => void;
  reject: (error: Error) => void;
}

export function createSunLightRemoteTileBuilder(): SunLightRemoteTileBuilder | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./sun_light_build_worker.ts", import.meta.url), { type: "module" });
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

  worker.onmessage = (event: MessageEvent<SunLightWorkerResponse>) => {
    const response = event.data;
    if (response.type === "error") {
      failAll(`sun-light build worker error: ${response.message}`);
      return;
    }
    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    // A batch answered under an older configId raced a reconfigure; its tiles would be
    // built from stale heights, so drop them and let the runtime re-queue.
    if (response.configId !== configId) {
      request.resolve([]);
      return;
    }
    request.resolve(response.tiles);
  };
  worker.onerror = (event) => {
    failAll(`sun-light build worker crashed: ${event.message ?? "unknown error"}`);
  };

  const post = (message: SunLightWorkerRequest, transfer?: Transferable[]): void => {
    worker.postMessage(message, transfer ?? []);
  };

  return {
    available: () => !failed,
    configure(input) {
      if (failed) return;
      configId++;
      const summary = input.summary
        ? {
          res: input.summary.res,
          worldSize: input.summary.worldSize,
          heightMax: input.summary.heightMax.slice(),
        }
        : null;
      post({
        type: "configure",
        configId,
        terrainFieldConfig: input.terrainFieldConfig,
        summary,
        options: input.options,
      }, summary ? [summary.heightMax.buffer] : []);
    },
    build(tiles) {
      if (failed) return Promise.reject(new Error("sun-light build worker unavailable"));
      const requestId = nextRequestId++;
      return new Promise<SunLightWorkerBuiltTile[]>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        post({ type: "build", requestId, configId, tiles });
      });
    },
    dispose() {
      failAll("sun-light build worker disposed");
      worker.terminate();
    },
  };
}
