import type { HydrologyGraphArtifact } from "./hydrology_graph_artifact.js";
import type { HydrologyGraphWorkerBuildRequest, HydrologyGraphWorkerResponse } from "./hydrology_graph_worker_protocol.js";

interface PendingBuild {
  readonly resolve: (artifact: HydrologyGraphArtifact) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress?: (buildPct: number) => void;
}

export interface HydrologyGraphWorkerClient {
  build(input: Omit<HydrologyGraphWorkerBuildRequest, "type" | "requestId">, onProgress?: (buildPct: number) => void): Promise<HydrologyGraphArtifact>;
  dispose(): void;
}

export function createHydrologyGraphWorkerClient(): HydrologyGraphWorkerClient | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./hydrology_graph_worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  let nextRequestId = 1;
  let disposed = false;
  const pending = new Map<number, PendingBuild>();
  worker.onmessage = (event: MessageEvent<HydrologyGraphWorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.requestId);
    if (!request) return;
    if (response.type === "hydrologyGraphProgress") {
      request.onProgress?.(response.buildPct);
      return;
    }
    pending.delete(response.requestId);
    if (response.type === "hydrologyGraphError") request.reject(new Error(response.message));
    else request.resolve(response.artifact);
  };
  worker.onerror = (event) => {
    const error = new Error(`hydrology graph worker crashed: ${event.message ?? "unknown error"}`);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  return {
    build(input, onProgress) {
      if (disposed) return Promise.reject(new Error("hydrology graph worker disposed"));
      const requestId = nextRequestId++;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, ...(onProgress ? { onProgress } : {}) });
        worker.postMessage({ type: "buildHydrologyGraph", requestId, ...input });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const request of pending.values()) request.reject(new Error("hydrology graph worker disposed"));
      pending.clear();
      worker.terminate();
    },
  };
}

