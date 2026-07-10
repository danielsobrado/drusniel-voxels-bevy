// Main-thread client for the canopy tile build worker.
//
// Fail-safe by design: if the Worker cannot be constructed (test environments) or errors at
// runtime, the client reports unavailable and the clipmap falls back to its main-thread
// incremental build path. Canopy is decorative streaming content, so a silent fallback is the
// correct failure mode here (unlike gated WebGPU scenes, which must fail loud).

import type { CanopySummaryTile } from "./canopy_types.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import type { TerrainFieldConfig } from "../terrain/terrain.js";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import {
  unpackCanopyTile,
  type CanopyWorkerRequest,
  type CanopyWorkerResponse,
  type CanopyWorkerTileCoord,
} from "./canopy_worker_protocol.js";

export type { CanopyWorkerTileCoord } from "./canopy_worker_protocol.js";

export interface CanopyRemoteTileSource {
  available(): boolean;
  /** Resolves to the built tiles, or [] when the batch raced a reconfigure; rejects on worker failure. */
  build(tiles: CanopyWorkerTileCoord[]): Promise<CanopySummaryTile[]>;
}

export interface CanopyRemoteTileBuilder extends CanopyRemoteTileSource {
  configure(input: {
    terrainFieldConfig: TerrainFieldConfig | null;
    terrainSummary: TerrainSummaryField | null;
    farRadius: number;
    config: CanopyShellConfig;
  }): void;
  dispose(): void;
}

interface PendingBuild {
  resolve: (tiles: CanopySummaryTile[]) => void;
  reject: (error: Error) => void;
}

export function createCanopyRemoteTileBuilder(): CanopyRemoteTileBuilder | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./canopy_build_worker.ts", import.meta.url), { type: "module" });
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

  worker.onmessage = (event: MessageEvent<CanopyWorkerResponse>) => {
    const response = event.data;
    if (response.type === "error") {
      failAll(`canopy build worker error: ${response.message}`);
      return;
    }
    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    // A batch answered under an older configId raced a reconfigure; its tiles would be built
    // from stale inputs, so drop them and let the clipmap re-queue.
    if (response.configId !== configId) {
      request.resolve([]);
      return;
    }
    request.resolve(response.tiles.map(unpackCanopyTile));
  };
  worker.onerror = (event) => {
    failAll(`canopy build worker crashed: ${event.message ?? "unknown error"}`);
  };

  const post = (message: CanopyWorkerRequest, transfer?: Transferable[]): void => {
    worker.postMessage(message, transfer ?? []);
  };

  return {
    available: () => !failed,
    configure(input) {
      if (failed) return;
      configId++;
      const summary = input.terrainSummary
        ? {
          res: input.terrainSummary.res,
          worldSize: input.terrainSummary.worldSize,
          farReduceFactor: input.terrainSummary.farReduceFactor,
          heightMin: input.terrainSummary.heightMin.slice(),
          heightMax: input.terrainSummary.heightMax.slice(),
        }
        : null;
      post({
        type: "configure",
        configId,
        terrainFieldConfig: input.terrainFieldConfig,
        summary,
        farRadius: input.farRadius,
        config: input.config,
      }, summary ? [summary.heightMin.buffer, summary.heightMax.buffer] : []);
    },
    build(tiles) {
      if (failed) return Promise.reject(new Error("canopy build worker unavailable"));
      const requestId = nextRequestId++;
      return new Promise<CanopySummaryTile[]>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        post({ type: "build", requestId, configId, tiles });
      });
    },
    dispose() {
      failAll("canopy build worker disposed");
      worker.terminate();
    },
  };
}
