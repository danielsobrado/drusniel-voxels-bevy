// Main-thread client for the terrain collider BVH worker.

import type { SerializedBVH } from "three-mesh-bvh";
import type {
  TerrainColliderWorkerBuiltResponse,
  TerrainColliderWorkerRequest,
  TerrainColliderWorkerResponse,
} from "./terrain_collider_worker_protocol.js";

export interface TerrainColliderBuildInput {
  /** Ownership transfers to the worker; callers must not reuse these arrays. */
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export interface TerrainColliderBuildResult {
  serialized: SerializedBVH;
  buildMs: number;
}

export interface TerrainColliderRemoteBuilder {
  available(): boolean;
  build(input: TerrainColliderBuildInput): Promise<TerrainColliderBuildResult>;
  dispose(): void;
}

interface PendingBuild {
  resolve: (result: TerrainColliderBuildResult) => void;
  reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBuiltResponse(value: unknown): value is TerrainColliderWorkerBuiltResponse {
  if (!isRecord(value) || value.type !== "built") return false;
  if (!isNonNegativeSafeInteger(value.requestId)) return false;
  if (!Array.isArray(value.roots) || value.roots.length === 0) return false;
  if (!value.roots.every((root) => root instanceof ArrayBuffer && root.byteLength > 0)) return false;
  if (!(value.indexBuffer instanceof ArrayBuffer)) return false;
  if (value.indexKind !== "uint16" && value.indexKind !== "uint32") return false;
  const bytesPerIndex = value.indexKind === "uint16" ? Uint16Array.BYTES_PER_ELEMENT : Uint32Array.BYTES_PER_ELEMENT;
  if (value.indexBuffer.byteLength === 0 || value.indexBuffer.byteLength % bytesPerIndex !== 0) return false;
  return typeof value.buildMs === "number" && Number.isFinite(value.buildMs) && value.buildMs >= 0;
}

function isErrorResponse(value: unknown): value is Extract<TerrainColliderWorkerResponse, { type: "error" }> {
  return isRecord(value)
    && value.type === "error"
    && (value.requestId === null || isNonNegativeSafeInteger(value.requestId))
    && typeof value.message === "string";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createTerrainColliderRemoteBuilder(): TerrainColliderRemoteBuilder | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./terrain_collider_build_worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  let failed = false;
  let terminated = false;
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
    if (isErrorResponse(response)) {
      if (response.requestId === null) {
        failAll(`terrain collider worker error: ${response.message}`);
        return;
      }
      const request = pending.get(response.requestId);
      if (!request) return;
      pending.delete(response.requestId);
      request.reject(new Error(`terrain collider worker error: ${response.message}`));
      return;
    }
    if (!isBuiltResponse(response)) {
      failAll("terrain collider worker returned an invalid protocol message");
      return;
    }

    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    const index = response.indexKind === "uint16"
      ? new Uint16Array(response.indexBuffer)
      : new Uint32Array(response.indexBuffer);
    request.resolve({
      serialized: { version: 1, roots: response.roots, index, indirectBuffer: null },
      buildMs: response.buildMs,
    });
  };

  worker.onerror = (event) => {
    failAll(`terrain collider worker crashed: ${event.message || "unknown error"}`);
  };
  worker.onmessageerror = () => {
    failAll("terrain collider worker response could not be deserialized");
  };

  return {
    available: () => !failed,
    build(input) {
      if (failed) return Promise.reject(new Error("terrain collider worker unavailable"));
      const requestId = nextRequestId++;
      return new Promise<TerrainColliderBuildResult>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        const request: TerrainColliderWorkerRequest = {
          type: "build",
          requestId,
          positions: input.positions,
          indices: input.indices,
        };
        try {
          worker.postMessage(request, [input.positions.buffer, input.indices.buffer]);
        } catch (error) {
          failAll(`terrain collider worker postMessage failed: ${errorMessage(error)}`);
        }
      });
    },
    dispose() {
      failAll("terrain collider worker disposed");
    },
  };
}
