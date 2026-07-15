import { baseSurfaceHeight, setTerrainFieldConfig } from "../../terrain/terrain_surface.js";
import { IndexedDbErosionArtifactStore, openErosionArtifactDb } from "./artifact_store.js";
import { buildErosionCpu } from "./cpu_builder.js";
import { collectErosionGpuCheckpointTransferables } from "./checkpoint.js";
import { summarizeErosionField } from "./diagnostics.js";
import { packErosionGpuInitialState } from "./gpu/buffers.js";
import { finalizeErosionGpuRawOutput } from "./gpu/finalize.js";
import { serializeErodedMacroField } from "./integration.js";
import { sampleErosionSourceField } from "./state.js";
import type { ErosionArtifact } from "./types.js";
import type {
  ErosionWorkerArtifactRecord,
  ErosionWorkerRequest,
  ErosionWorkerResponse,
  ErosionWorkerStoreKey,
} from "./worker_protocol.js";

const ctx = self as unknown as {
  postMessage(message: ErosionWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ErosionWorkerRequest>) => void) | null;
};
const controllers = new Map<number, AbortController>();

function recordForTransfer(artifact: ErosionArtifact, cacheHit: boolean): ErosionWorkerArtifactRecord {
  return {
    ref: artifact.ref,
    field: serializeErodedMacroField(artifact.field),
    summary: summarizeErosionField(artifact.field),
    canonicalBytes: artifact.canonicalBytes,
    compressedBytes: artifact.compressedBytes,
    buildMs: artifact.buildMs,
    gpuMs: artifact.gpuMs,
    readbackMs: artifact.readbackMs,
    checkpointCount: artifact.checkpointCount,
    massErrorRatio: artifact.massErrorRatio,
    gpuPassTimingsMs: artifact.gpuPassTimingsMs,
    timestampQueriesSupported: artifact.timestampQueriesSupported,
    cacheHit,
  };
}

function artifactTransferables(record: ErosionWorkerArtifactRecord): Transferable[] {
  return [
    record.field.heightFixed.buffer,
    record.field.hardness.buffer,
    record.field.sediment.buffer,
    record.field.deposition.buffer,
    record.canonicalBytes,
    record.compressedBytes,
  ];
}

async function withStore<T>(key: ErosionWorkerStoreKey, run: (store: IndexedDbErosionArtifactStore) => Promise<T>): Promise<T> {
  const db = await openErosionArtifactDb();
  const store = new IndexedDbErosionArtifactStore(db, key.sourceTerrainHash, key.configHash);
  try {
    return await run(store);
  } finally {
    store.close();
  }
}

function postError(requestId: number, error: unknown): void {
  ctx.postMessage({
    type: "erosionError",
    requestId,
    message: error instanceof Error ? error.message : String(error),
  });
}

async function loadArtifact(request: Extract<ErosionWorkerRequest, { type: "loadErosionArtifact" }>): Promise<void> {
  const artifact = await withStore(request, (store) => store.load());
  if (!artifact) {
    ctx.postMessage({ type: "erosionArtifactLoaded", requestId: request.requestId, artifact: null });
    return;
  }
  const record = recordForTransfer(artifact, true);
  ctx.postMessage({ type: "erosionArtifactLoaded", requestId: request.requestId, artifact: record }, artifactTransferables(record));
}

async function loadGpuCheckpoint(request: Extract<ErosionWorkerRequest, { type: "loadErosionGpuCheckpoint" }>): Promise<void> {
  const checkpoint = await withStore(request, (store) => store.loadGpuCheckpoint());
  if (!checkpoint) {
    ctx.postMessage({ type: "erosionGpuCheckpointLoaded", requestId: request.requestId, checkpoint: null });
    return;
  }
  ctx.postMessage(
    { type: "erosionGpuCheckpointLoaded", requestId: request.requestId, checkpoint },
    collectErosionGpuCheckpointTransferables(checkpoint),
  );
}

async function saveGpuCheckpoint(request: Extract<ErosionWorkerRequest, { type: "saveErosionGpuCheckpoint" }>): Promise<void> {
  await withStore(request, (store) => store.saveCheckpoint(request.checkpoint));
  ctx.postMessage({ type: "erosionGpuCheckpointSaved", requestId: request.requestId });
}

async function clearCheckpoint(request: Extract<ErosionWorkerRequest, { type: "clearErosionCheckpoint" }>): Promise<void> {
  await withStore(request, (store) => store.clearCheckpoint());
  ctx.postMessage({ type: "erosionCheckpointCleared", requestId: request.requestId });
}

async function finalizeGpu(request: Extract<ErosionWorkerRequest, { type: "finalizeErosionGpu" }>): Promise<void> {
  const artifact = await finalizeErosionGpuRawOutput({
    raw: request.raw,
    sourceTerrainHash: request.sourceTerrainHash,
    configHash: request.configHash,
  });
  await withStore(request, async (store) => {
    await store.save(artifact);
    await store.clearCheckpoint();
  });
  const record = recordForTransfer(artifact, false);
  ctx.postMessage({ type: "erosionBuilt", requestId: request.requestId, artifact: record }, artifactTransferables(record));
}

async function buildCpu(request: Extract<ErosionWorkerRequest, { type: "buildErosion" }>, controller: AbortController): Promise<void> {
  setTerrainFieldConfig(request.terrainFieldConfig);
  const result = await withStore(request, async (store) => {
    const cached = await store.load();
    if (cached) return { artifact: cached, cacheHit: true };
    const loadedCheckpoint = await store.loadCheckpoint();
    let checkpoint = loadedCheckpoint && loadedCheckpoint.kind !== "gpu" ? loadedCheckpoint : null;
    if (loadedCheckpoint?.kind === "gpu") await store.clearCheckpoint();
    try {
      const artifact = await buildErosionCpu({
        ...request,
        sampleHeightMeters: baseSurfaceHeight,
        ...(checkpoint ? { checkpoint } : {}),
        signal: controller.signal,
      }, {
        seaLevelM: request.seaLevelM,
        onProgress: (progress) => ctx.postMessage({ type: "erosionProgress", requestId: request.requestId, progress }),
        onCheckpoint: (next) => store.saveCheckpoint(next),
        yieldBetweenCheckpoints: () => new Promise((resolve) => setTimeout(resolve, 0)),
      });
      await store.save(artifact);
      await store.clearCheckpoint();
      return { artifact, cacheHit: false };
    } catch (error) {
      if (checkpoint && error instanceof Error && error.message.includes("checkpoint")) {
        await store.clearCheckpoint();
        checkpoint = null;
        const artifact = await buildErosionCpu({
          ...request,
          sampleHeightMeters: baseSurfaceHeight,
          signal: controller.signal,
        }, {
          seaLevelM: request.seaLevelM,
          onProgress: (progress) => ctx.postMessage({ type: "erosionProgress", requestId: request.requestId, progress }),
          onCheckpoint: (next) => store.saveCheckpoint(next),
          yieldBetweenCheckpoints: () => new Promise((resolve) => setTimeout(resolve, 0)),
        });
        await store.save(artifact);
        await store.clearCheckpoint();
        return { artifact, cacheHit: false };
      }
      throw error;
    }
  });
  const record = recordForTransfer(result.artifact, result.cacheHit);
  ctx.postMessage({ type: "erosionBuilt", requestId: request.requestId, artifact: record }, artifactTransferables(record));
}

ctx.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancelErosion") {
    controllers.get(request.requestId)?.abort(new DOMException("Erosion build cancelled", "AbortError"));
    return;
  }
  if (request.type === "loadErosionArtifact") {
    void loadArtifact(request).catch((error) => postError(request.requestId, error));
    return;
  }
  if (request.type === "loadErosionGpuCheckpoint") {
    void loadGpuCheckpoint(request).catch((error) => postError(request.requestId, error));
    return;
  }
  if (request.type === "saveErosionGpuCheckpoint") {
    void saveGpuCheckpoint(request).catch((error) => postError(request.requestId, error));
    return;
  }
  if (request.type === "clearErosionCheckpoint") {
    void clearCheckpoint(request).catch((error) => postError(request.requestId, error));
    return;
  }
  if (request.type === "finalizeErosionGpu") {
    void finalizeGpu(request).catch((error) => postError(request.requestId, error));
    return;
  }
  const controller = new AbortController();
  controllers.set(request.requestId, controller);
  if (request.type === "sampleErosionSource") {
    const startedAt = performance.now();
    try {
      setTerrainFieldConfig(request.terrainFieldConfig);
      const source = sampleErosionSourceField({
        sizeM: request.sizeM,
        originM: request.originM,
        config: request.config,
        sampleHeightMeters: baseSurfaceHeight,
        seed: request.seed,
        seaLevelM: request.seaLevelM,
        signal: controller.signal,
      });
      const initial = packErosionGpuInitialState(source, request.config.erosion.borderCells);
      ctx.postMessage(
        { type: "erosionSourceSampled", requestId: request.requestId, initial, sampleMs: performance.now() - startedAt },
        [initial.stateAData],
      );
    } catch (error) {
      postError(request.requestId, error);
    } finally {
      controllers.delete(request.requestId);
    }
    return;
  }
  void buildCpu(request, controller)
    .catch((error) => postError(request.requestId, error))
    .finally(() => controllers.delete(request.requestId));
};
