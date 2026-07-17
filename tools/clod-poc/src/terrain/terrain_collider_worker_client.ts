// Main-thread client for the terrain collider BVH worker.

import type { SerializedBVH } from "three-mesh-bvh";
import type {
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

export function createTerrainColliderRemoteBuilder(): TerrainColliderRemoteBuilder | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./terrain_collider_build_worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  let failed = false;
  let nextRequestId = 1;
  const pending = new Map<number, PendingBuild>();

  const failAll = (message: string): void => {
    if (failed) return;
    failed = true;
    const error = new Error(message);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  worker.onmessage = (event: MessageEvent<TerrainColliderWorkerResponse>) => {
    const response = event.data;
    if (response.type === "error") {
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

    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    const index = response.indexKind === "uint16"
      ? new Uint16Array(response.indexBuffer)
      : new Uint32Array(response.indexBuffer);
    request.resolve({
      serialized: { roots: response.roots, index },
      buildMs: response.buildMs,
    });
  };

  worker.onerror = (event) => {
    failAll(`terrain collider worker crashed: ${event.message || "unknown error"}`);
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
          pending.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    dispose() {
      failAll("terrain collider worker disposed");
      worker.terminate();
    },
  };
}
