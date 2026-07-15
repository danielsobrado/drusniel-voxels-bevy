import { decodeErosionArtifact } from "./artifact_codec.js";
import { recordErosionArtifact, resetErosionDiagnostics, updateErosionProgress } from "./diagnostics.js";
import { setActiveErodedMacroField, setLatestErosionArtifactRef } from "./integration.js";
import type { ErosionArtifact, ErosionBuildProgress, ErosionGpuInitialState } from "./types.js";
import type {
  ErosionWorkerBuildRequest,
  ErosionWorkerResponse,
  ErosionWorkerSampleRequest,
} from "./worker_protocol.js";

interface PendingBase {
  readonly reject: (error: Error) => void;
  readonly worldId: string;
}

interface PendingBuild extends PendingBase {
  readonly kind: "build";
  readonly resolve: (artifact: ErosionArtifact) => void;
  readonly onProgress?: (progress: ErosionBuildProgress) => void;
}

interface PendingSample extends PendingBase {
  readonly kind: "sample";
  readonly resolve: (initial: ErosionGpuInitialState) => void;
}

type PendingRequest = PendingBuild | PendingSample;

export interface ErosionWorkerClient {
  build(
    input: Omit<ErosionWorkerBuildRequest, "type" | "requestId">,
    onProgress?: (progress: ErosionBuildProgress) => void,
  ): Promise<ErosionArtifact>;
  sampleInitial(input: Omit<ErosionWorkerSampleRequest, "type" | "requestId">): Promise<ErosionGpuInitialState>;
  cancel(): void;
  dispose(): void;
}

export function createErosionWorkerClient(): ErosionWorkerClient | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./erosion_worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  let nextRequestId = 1;
  let activeRequestId: number | null = null;
  let disposed = false;
  const pending = new Map<number, PendingRequest>();

  worker.onmessage = (event: MessageEvent<ErosionWorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.requestId);
    if (!request) return;
    if (response.type === "erosionProgress") {
      if (request.kind === "build") {
        updateErosionProgress(response.progress.percent);
        request.onProgress?.(response.progress);
      }
      return;
    }
    pending.delete(response.requestId);
    if (activeRequestId === response.requestId) activeRequestId = null;
    if (response.type === "erosionError") {
      request.reject(new Error(response.message));
      return;
    }
    if (response.type === "erosionSourceSampled") {
      if (request.kind !== "sample") {
        request.reject(new Error("erosion worker returned source data for an artifact build"));
        return;
      }
      request.resolve(response.initial);
      return;
    }
    if (request.kind !== "build") {
      request.reject(new Error("erosion worker returned an artifact for a source request"));
      return;
    }
    void decodeErosionArtifact(response.artifact).then((artifact) => {
      setActiveErodedMacroField(artifact.field);
      setLatestErosionArtifactRef(artifact.ref, request.worldId);
      recordErosionArtifact(artifact, response.artifact.cacheHit);
      request.resolve(artifact);
    }, request.reject);
  };

  worker.onerror = (event) => {
    const error = new Error(`erosion worker crashed: ${event.message ?? "unknown error"}`);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    activeRequestId = null;
  };

  const reserve = (request: PendingRequest): number => {
    if (disposed) throw new Error("erosion worker disposed");
    if (activeRequestId !== null) throw new Error("erosion worker already has an active request");
    const requestId = nextRequestId++;
    activeRequestId = requestId;
    pending.set(requestId, request);
    return requestId;
  };

  return {
    build(input, onProgress) {
      if (disposed) return Promise.reject(new Error("erosion worker disposed"));
      resetErosionDiagnostics(input.config.erosion.enabled);
      return new Promise((resolve, reject) => {
        let requestId: number;
        try {
          requestId = reserve({ kind: "build", resolve, reject, worldId: input.worldId, ...(onProgress ? { onProgress } : {}) });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        worker.postMessage({ type: "buildErosion", requestId, ...input });
      });
    },
    sampleInitial(input) {
      if (disposed) return Promise.reject(new Error("erosion worker disposed"));
      return new Promise((resolve, reject) => {
        let requestId: number;
        try {
          requestId = reserve({ kind: "sample", resolve, reject, worldId: input.worldId });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        worker.postMessage({ type: "sampleErosionSource", requestId, ...input });
      });
    },
    cancel() {
      if (activeRequestId !== null) worker.postMessage({ type: "cancelErosion", requestId: activeRequestId });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      this.cancel();
      for (const request of pending.values()) request.reject(new Error("erosion worker disposed"));
      pending.clear();
      worker.terminate();
    },
  };
}
