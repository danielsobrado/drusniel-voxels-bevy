// Main-thread client for the sun-light tile build worker.
//
// Fail-safe by design: if the Worker cannot be constructed (test environments) or errors
// at runtime, the client reports unavailable and the cache runtime falls back to its
// main-thread budgeted build path. Sun-light tiles are a soft lighting cache, so silent
// fallback is the correct failure mode (unlike gated WebGPU scenes, which fail loud).

import {
  cloneLargePropOcclusionHeightPayload,
  type LargePropOcclusionHeightPayload,
} from "../../props/large_prop_occlusion_height.js";
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
    propOcclusion: LargePropOcclusionHeightPayload | null;
    options: SunLightOptions;
  }): void;
  dispose(): void;
}

interface PendingBuild {
  resolve: (tiles: SunLightWorkerBuiltTile[]) => void;
  reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBuiltTile(value: unknown): value is SunLightWorkerBuiltTile {
  if (!isRecord(value) || typeof value.key !== "string" || value.key.length === 0) return false;
  if (!isNonNegativeSafeInteger(value.resolution) || value.resolution <= 0) return false;
  if (!(value.values instanceof Uint8Array)) return false;
  return value.values.length === value.resolution * value.resolution;
}

function isWorkerResponse(value: unknown): value is SunLightWorkerResponse {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "error") {
    return (value.requestId === null || isNonNegativeSafeInteger(value.requestId))
      && typeof value.message === "string";
  }
  return value.type === "built"
    && isNonNegativeSafeInteger(value.requestId)
    && isNonNegativeSafeInteger(value.configId)
    && Array.isArray(value.tiles)
    && value.tiles.every(isBuiltTile)
    && typeof value.buildMs === "number"
    && Number.isFinite(value.buildMs)
    && value.buildMs >= 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSunLightRemoteTileBuilder(): SunLightRemoteTileBuilder | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./sun_light_build_worker.ts", import.meta.url), { type: "module" });
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
    if (!isWorkerResponse(response)) {
      failAll("sun-light build worker returned an invalid protocol message");
      return;
    }
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
  worker.onmessageerror = () => {
    failAll("sun-light build worker response could not be deserialized");
  };

  const post = (message: SunLightWorkerRequest, transfer?: Transferable[]): boolean => {
    try {
      worker.postMessage(message, transfer ?? []);
      return true;
    } catch (error) {
      failAll(`sun-light build worker postMessage failed: ${errorMessage(error)}`);
      return false;
    }
  };

  return {
    available: () => !failed,
    configure(input) {
      if (failed) return;
      const nextConfigId = configId + 1;
      const summary = input.summary
        ? {
          res: input.summary.res,
          worldSize: input.summary.worldSize,
          heightMax: input.summary.heightMax.slice(),
        }
        : null;
      const propOcclusion = input.propOcclusion
        ? cloneLargePropOcclusionHeightPayload(input.propOcclusion)
        : null;
      const transfer: Transferable[] = [];
      if (summary) transfer.push(summary.heightMax.buffer);
      if (propOcclusion) {
        transfer.push(
          propOcclusion.cellX.buffer,
          propOcclusion.cellZ.buffer,
          propOcclusion.topY.buffer,
        );
      }
      if (post({
        type: "configure",
        configId: nextConfigId,
        terrainFieldConfig: input.terrainFieldConfig,
        summary,
        propOcclusion,
        options: input.options,
      }, transfer)) {
        configId = nextConfigId;
      }
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
    },
  };
}
