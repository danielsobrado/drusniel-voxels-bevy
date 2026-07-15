import { recordErosionArtifact, resetErosionDiagnostics, updateErosionProgress } from "./diagnostics.js";
import { setActiveErodedMacroField, setLatestErosionArtifactRef, toErodedMacroField } from "./integration.js";
import type {
  ErosionArtifact,
  ErosionBuildProgress,
  ErosionGpuCheckpoint,
  ErosionGpuInitialState,
  ErosionGpuRawOutput,
} from "./types.js";
import type {
  ErosionWorkerArtifactRecord,
  ErosionWorkerBuildRequest,
  ErosionWorkerResponse,
  ErosionWorkerSampleRequest,
  ErosionWorkerStoreKey,
} from "./worker_protocol.js";

interface PendingBase<T> {
  readonly reject: (error: Error) => void;
  readonly resolve: (value: T) => void;
  readonly worldId: string;
}

interface PendingArtifact extends PendingBase<ErosionArtifact | null> {
  readonly kind: "artifact";
}

interface PendingBuild extends PendingBase<ErosionArtifact> {
  readonly kind: "build";
  readonly onProgress?: (progress: ErosionBuildProgress) => void;
}

interface PendingSample extends PendingBase<ErosionGpuInitialState> {
  readonly kind: "sample";
}

interface PendingCheckpoint extends PendingBase<ErosionGpuCheckpoint | null> {
  readonly kind: "checkpoint";
}

interface PendingAck extends PendingBase<void> {
  readonly kind: "ack";
}

type PendingRequest = PendingArtifact | PendingBuild | PendingSample | PendingCheckpoint | PendingAck;

export interface ErosionWorkerClient {
  build(
    input: Omit<ErosionWorkerBuildRequest, "type" | "requestId">,
    onProgress?: (progress: ErosionBuildProgress) => void,
  ): Promise<ErosionArtifact>;
  sampleInitial(input: Omit<ErosionWorkerSampleRequest, "type" | "requestId">): Promise<ErosionGpuInitialState>;
  loadArtifact(input: ErosionWorkerStoreKey, worldId: string): Promise<ErosionArtifact | null>;
  loadGpuCheckpoint(input: ErosionWorkerStoreKey): Promise<ErosionGpuCheckpoint | null>;
  saveGpuCheckpoint(checkpoint: ErosionGpuCheckpoint): Promise<void>;
  clearCheckpoint(input: ErosionWorkerStoreKey): Promise<void>;
  finalizeGpu(input: ErosionWorkerStoreKey & { readonly worldId: string; readonly raw: ErosionGpuRawOutput }): Promise<ErosionArtifact>;
  cancel(): void;
  dispose(): void;
}

function artifactFromRecord(record: ErosionWorkerArtifactRecord): ErosionArtifact {
  const field = toErodedMacroField(record.field);
  return Object.freeze({
    ref: record.ref,
    field,
    canonicalBytes: record.canonicalBytes,
    compressedBytes: record.compressedBytes,
    buildMs: record.buildMs,
    gpuMs: record.gpuMs,
    readbackMs: record.readbackMs,
    checkpointCount: record.checkpointCount,
    massErrorRatio: record.massErrorRatio,
    gpuPassTimingsMs: Object.freeze({ ...record.gpuPassTimingsMs }),
    timestampQueriesSupported: record.timestampQueriesSupported,
  });
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
        request.reject(new Error("erosion worker returned source data for a different request"));
        return;
      }
      request.resolve(response.initial);
      return;
    }
    if (response.type === "erosionArtifactLoaded") {
      if (request.kind !== "artifact") {
        request.reject(new Error("erosion worker returned a cached artifact for a different request"));
        return;
      }
      if (!response.artifact) {
        request.resolve(null);
        return;
      }
      const artifact = artifactFromRecord(response.artifact);
      setActiveErodedMacroField(artifact.field);
      setLatestErosionArtifactRef(artifact.ref, request.worldId);
      recordErosionArtifact(artifact, true);
      request.resolve(artifact);
      return;
    }
    if (response.type === "erosionGpuCheckpointLoaded") {
      if (request.kind !== "checkpoint") {
        request.reject(new Error("erosion worker returned a checkpoint for a different request"));
        return;
      }
      request.resolve(response.checkpoint);
      return;
    }
    if (response.type === "erosionGpuCheckpointSaved" || response.type === "erosionCheckpointCleared") {
      if (request.kind !== "ack") {
        request.reject(new Error("erosion worker returned a persistence acknowledgement for a different request"));
        return;
      }
      request.resolve();
      return;
    }
    if (request.kind !== "build") {
      request.reject(new Error("erosion worker returned an artifact for a non-build request"));
      return;
    }
    const artifact = artifactFromRecord(response.artifact);
    setActiveErodedMacroField(artifact.field);
    setLatestErosionArtifactRef(artifact.ref, request.worldId);
    recordErosionArtifact(artifact, response.artifact.cacheHit);
    request.resolve(artifact);
  };

  worker.onerror = (event) => {
    const error = new Error(`erosion worker crashed: ${event.message ?? "unknown error"}`);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    activeRequestId = null;
  };

  const reserve = <T>(request: PendingBase<T> & { readonly kind: PendingRequest["kind"] }): number => {
    if (disposed) throw new Error("erosion worker disposed");
    if (activeRequestId !== null) throw new Error("erosion worker already has an active request");
    const requestId = nextRequestId++;
    activeRequestId = requestId;
    pending.set(requestId, request as PendingRequest);
    return requestId;
  };

  const request = <T>(
    pendingRequest: PendingBase<T> & { readonly kind: PendingRequest["kind"] },
    message: (requestId: number) => object,
    transfer: Transferable[] = [],
  ): Promise<T> => new Promise((resolve, reject) => {
    let requestId: number;
    try {
      requestId = reserve({ ...pendingRequest, resolve, reject });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    worker.postMessage(message(requestId), transfer);
  });

  return {
    build(input, onProgress) {
      resetErosionDiagnostics(input.config.erosion.enabled);
      return request(
        { kind: "build", worldId: input.worldId, resolve: () => undefined, reject: () => undefined, ...(onProgress ? { onProgress } : {}) },
        (requestId) => ({ type: "buildErosion", requestId, ...input }),
      );
    },
    sampleInitial(input) {
      return request(
        { kind: "sample", worldId: input.worldId, resolve: () => undefined, reject: () => undefined },
        (requestId) => ({ type: "sampleErosionSource", requestId, ...input }),
      );
    },
    loadArtifact(input, worldId) {
      return request(
        { kind: "artifact", worldId, resolve: () => undefined, reject: () => undefined },
        (requestId) => ({ type: "loadErosionArtifact", requestId, ...input }),
      );
    },
    loadGpuCheckpoint(input) {
      return request(
        { kind: "checkpoint", worldId: "", resolve: () => undefined, reject: () => undefined },
        (requestId) => ({ type: "loadErosionGpuCheckpoint", requestId, ...input }),
      );
    },
    saveGpuCheckpoint(checkpoint) {
      return request(
        { kind: "ack", worldId: "", resolve: () => undefined, reject: () => undefined },
        (requestId) => ({
          type: "saveErosionGpuCheckpoint",
          requestId,
          sourceTerrainHash: checkpoint.sourceTerrainHash,
          configHash: checkpoint.configHash,
          checkpoint,
        }),
        [...checkpoint.stateAChunks, ...checkpoint.stateBChunks],
      );
    },
    clearCheckpoint(input) {
      return request(
        { kind: "ack", worldId: "", resolve: () => undefined, reject: () => undefined },
        (requestId) => ({ type: "clearErosionCheckpoint", requestId, ...input }),
      );
    },
    finalizeGpu(input) {
      return request(
        { kind: "build", worldId: input.worldId, resolve: () => undefined, reject: () => undefined },
        (requestId) => ({ type: "finalizeErosionGpu", requestId, ...input }),
        [...input.raw.chunks],
      );
    },
    cancel() {
      if (activeRequestId !== null) worker.postMessage({ type: "cancelErosion", requestId: activeRequestId });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      this.cancel();
      for (const pendingRequest of pending.values()) pendingRequest.reject(new Error("erosion worker disposed"));
      pending.clear();
      worker.terminate();
    },
  };
}
