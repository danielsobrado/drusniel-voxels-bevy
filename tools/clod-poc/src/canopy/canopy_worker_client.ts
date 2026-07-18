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
  CANOPY_CELL_FLOATS,
  unpackCanopyTile,
  type CanopyWorkerBuiltTile,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && (value as number) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validBuiltTile(value: unknown): value is CanopyWorkerBuiltTile {
  if (!isRecord(value) || !isRecord(value.key)) return false;
  if (!isSafeInteger(value.key.tileX)
    || !isSafeInteger(value.key.tileZ)
    || !isNonNegativeSafeInteger(value.key.ring)) return false;
  if (!isFiniteNumber(value.originX)
    || !isFiniteNumber(value.originZ)
    || !isFiniteNumber(value.cellSizeM)
    || value.cellSizeM <= 0) return false;
  if (!isNonNegativeSafeInteger(value.revision)
    || !isNonNegativeSafeInteger(value.resolution)
    || value.resolution <= 0) return false;
  if (!(value.cells instanceof Float64Array)) return false;
  return value.cells.length === value.resolution * value.resolution * CANOPY_CELL_FLOATS;
}

function validWorkerResponse(value: unknown): value is CanopyWorkerResponse {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "error") {
    return (value.requestId === null || isNonNegativeSafeInteger(value.requestId))
      && typeof value.message === "string";
  }
  return value.type === "built"
    && isNonNegativeSafeInteger(value.requestId)
    && isNonNegativeSafeInteger(value.configId)
    && Array.isArray(value.tiles)
    && value.tiles.every(validBuiltTile)
    && isFiniteNumber(value.buildMs)
    && value.buildMs >= 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCanopyRemoteTileBuilder(): CanopyRemoteTileBuilder | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./canopy_build_worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  let failed = false;
  let terminated = false;
  let configId = 0;
  let nextRequestId = 1;
  const pending = new Map<number, PendingBuild>();

  const terminateOnce = (): void => {
    if (terminated) return;
    terminated = true;
    worker.terminate();
  };

  const failAll = (message: string): void => {
    if (!failed) {
      failed = true;
      const error = new Error(message);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    }
    terminateOnce();
  };

  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (failed) return;
    const response = event.data;
    if (!validWorkerResponse(response)) {
      failAll("canopy build worker returned an invalid protocol message");
      return;
    }
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
    try {
      request.resolve(response.tiles.map(unpackCanopyTile));
    } catch (error) {
      request.reject(new Error(`canopy build worker returned invalid tile data: ${errorMessage(error)}`));
      failAll(`canopy build worker returned invalid tile data: ${errorMessage(error)}`);
    }
  };
  worker.onerror = (event) => {
    failAll(`canopy build worker crashed: ${event.message ?? "unknown error"}`);
  };
  worker.onmessageerror = () => {
    failAll("canopy build worker response could not be deserialized");
  };

  const post = (message: CanopyWorkerRequest, transfer?: Transferable[]): boolean => {
    try {
      worker.postMessage(message, transfer ?? []);
      return true;
    } catch (error) {
      failAll(`canopy build worker postMessage failed: ${errorMessage(error)}`);
      return false;
    }
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
    },
  };
}
