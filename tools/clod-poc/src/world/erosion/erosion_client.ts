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
type PendingKind = PendingRequest["kind"];

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
    artifactBytes: record.artifactBytes,
    buildMs: record.buildMs,
    samplingMs: record.samplingMs,
    gpuMs: record.gpuMs,
    readbackMs: record.readbackMs,
    finalizeMs: record.finalizeMs,
    persistenceMs: record.persistenceMs,
    checkpointCount: record.checkpointCount,
    massErrorRatio: record.massErrorRatio,
    gpuPassTimingsMs: Object.freeze({ ...record.gpuPassTimingsMs }),
    timestampQueriesSupported: record.timestampQueriesSupported,
  });
}

function activateRecord(record: ErosionWorkerArtifactRecord, worldId: string): ErosionArtifact {
  const artifact = artifactFromRecord(record);
  setActiveErodedMacroField(artifact.field, worldId);
  setLatestErosionArtifactRef(artifact.ref, worldId);
  recordErosionArtifact(artifact, record.cacheHit, record.summary);
  return artifact;
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
    const pendingRequest = pending.get(response.requestId);
    if (!pendingRequest) return;
    if (response.type === "erosionProgress") {
      if (pendingRequest.kind === "build") {
        updateErosionProgress(response.progress.percent);
        pendingRequest.onProgress?.(response.progress);
      }
      return;
    }
    pending.delete(response.requestId);
    if (activeRequestId === response.requestId) activeRequestId = null;
    if (response.type === "erosionError") {
      const error = new Error(response.message);
      error.name = response.name;
      pendingRequest.reject(error);
      return;
    }
    if (response.type === "erosionSourceSampled") {
      if (pendingRequest.kind !== "sample") {
        pendingRequest.reject(new Error("erosion worker returned source data for a different request"));
        return;
      }
      pendingRequest.resolve(response.initial);
      return;
    }
    if (response.type === "erosionArtifactLoaded") {
      if (pendingRequest.kind !== "artifact") {
        pendingRequest.reject(new Error("erosion worker returned a cached artifact for a different request"));
        return;
      }
      pendingRequest.resolve(response.artifact ? activateRecord(response.artifact, pendingRequest.worldId) : null);
      return;
    }
    if (response.type === "erosionGpuCheckpointLoaded") {
      if (pendingRequest.kind !== "checkpoint") {
        pendingRequest.reject(new Error("erosion worker returned a checkpoint for a different request"));
        return;
      }
      pendingRequest.resolve(response.checkpoint);
      return;
    }
    if (response.type === "erosionGpuCheckpointSaved" || response.type === "erosionCheckpointCleared") {
      if (pendingRequest.kind !== "ack") {
        pendingRequest.reject(new Error("erosion worker returned a persistence acknowledgement for a different request"));
        return;
      }
      pendingRequest.resolve();
      return;
    }
    if (pendingRequest.kind !== "build") {
      pendingRequest.reject(new Error("erosion worker returned an artifact for a non-build request"));
      return;
    }
    pendingRequest.resolve(activateRecord(response.artifact, pendingRequest.worldId));
  };

  worker.onerror = (event) => {
    const error = new Error(`erosion worker crashed: ${event.message ?? "unknown error"}`);
    for (const pendingRequest of pending.values()) pendingRequest.reject(error);
    pending.clear();
    activeRequestId = null;
  };

  function send<T>(input: {
    readonly kind: PendingKind;
    readonly worldId: string;
    readonly onProgress?: (progress: ErosionBuildProgress) => void;
    readonly message: (requestId: number) => object;
    readonly transfer?: Transferable[];
  }): Promise<T> {
    if (disposed) return Promise.reject(new Error("erosion worker disposed"));
    if (activeRequestId !== null) return Promise.reject(new Error("erosion worker already has an active request"));
    return new Promise<T>((resolve, reject) => {
      const requestId = nextRequestId++;
      activeRequestId = requestId;
      const entry = {
        kind: input.kind,
        worldId: input.worldId,
        resolve,
        reject,
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      } as unknown as PendingRequest;
      pending.set(requestId, entry);
      worker.postMessage(input.message(requestId), input.transfer ?? []);
    });
  }

  const cancel = (): void => {
    if (activeRequestId !== null) worker.postMessage({ type: "cancelErosion", requestId: activeRequestId });
  };

  return {
    build(input, onProgress) {
      resetErosionDiagnostics(input.config.erosion.enabled);
      return send<ErosionArtifact>({
        kind: "build",
        worldId: input.worldId,
        ...(onProgress ? { onProgress } : {}),
        message: (requestId) => ({ type: "buildErosion", requestId, ...input }),
      });
    },
    sampleInitial(input) {
      return send<ErosionGpuInitialState>({
        kind: "sample",
        worldId: input.worldId,
        message: (requestId) => ({ type: "sampleErosionSource", requestId, ...input }),
      });
    },
    loadArtifact(input, worldId) {
      return send<ErosionArtifact | null>({
        kind: "artifact",
        worldId,
        message: (requestId) => ({ type: "loadErosionArtifact", requestId, ...input }),
      });
    },
    loadGpuCheckpoint(input) {
      return send<ErosionGpuCheckpoint | null>({
        kind: "checkpoint",
        worldId: "",
        message: (requestId) => ({ type: "loadErosionGpuCheckpoint", requestId, ...input }),
      });
    },
    saveGpuCheckpoint(checkpoint) {
      return send<void>({
        kind: "ack",
        worldId: "",
        message: (requestId) => ({
          type: "saveErosionGpuCheckpoint",
          requestId,
          sourceTerrainHash: checkpoint.sourceTerrainHash,
          configHash: checkpoint.configHash,
          checkpoint,
        }),
        transfer: [...checkpoint.packedChunks],
      });
    },
    clearCheckpoint(input) {
      return send<void>({
        kind: "ack",
        worldId: "",
        message: (requestId) => ({ type: "clearErosionCheckpoint", requestId, ...input }),
      });
    },
    finalizeGpu(input) {
      return send<ErosionArtifact>({
        kind: "build",
        worldId: input.worldId,
        message: (requestId) => ({ type: "finalizeErosionGpu", requestId, ...input }),
        transfer: [...input.raw.chunks],
      });
    },
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      for (const pendingRequest of pending.values()) pendingRequest.reject(new Error("erosion worker disposed"));
      pending.clear();
      activeRequestId = null;
      worker.terminate();
    },
  };
}
