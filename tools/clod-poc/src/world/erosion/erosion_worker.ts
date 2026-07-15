import { baseSurfaceHeight, setTerrainFieldConfig } from "../../terrain/terrain_surface.js";
import { assertErosionNotAborted } from "./abort.js";
import { IndexedDbErosionArtifactStore, openErosionArtifactDb } from "./artifact_store.js";
import { buildErosionCpu } from "./cpu_builder.js";
import { collectErosionGpuCheckpointTransferables } from "./checkpoint.js";
import { summarizeErosionField, summarizeErosionFieldAsync } from "./diagnostics.js";
import { packErosionGpuInitialStateAsync } from "./gpu/buffers.js";
import { finalizeErosionGpuRawOutput } from "./gpu/finalize.js";
import { serializeErodedMacroField } from "./integration.js";
import { sampleErosionSourceFieldAsync } from "./state.js";
import type { ErosionArtifact, ErosionArtifactSummary, PersistedErosionArtifact } from "./types.js";
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

function recordForTransfer(
  artifact: ErosionArtifact,
  cacheHit: boolean,
  summary: ErosionArtifactSummary,
  persistenceMs = artifact.persistenceMs,
): ErosionWorkerArtifactRecord {
  return {
    ref: artifact.ref,
    field: serializeErodedMacroField(artifact.field),
    summary,
    artifactBytes: artifact.artifactBytes,
    buildMs: artifact.buildMs + Math.max(0, persistenceMs - artifact.persistenceMs),
    samplingMs: artifact.samplingMs,
    gpuMs: artifact.gpuMs,
    readbackMs: artifact.readbackMs,
    finalizeMs: artifact.finalizeMs,
    persistenceMs,
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
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  });
}

async function loadArtifact(request: Extract<ErosionWorkerRequest, { type: "loadErosionArtifact" }>): Promise<void> {
  const artifact = await withStore(request, (store) => store.load());
  if (!artifact) {
    ctx.postMessage({ type: "erosionArtifactLoaded", requestId: request.requestId, artifact: null });
    return;
  }
  const record = recordForTransfer(artifact, true, summarizeErosionField(artifact.field));
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

async function finalizeGpu(
  request: Extract<ErosionWorkerRequest, { type: "finalizeErosionGpu" }>,
  controller: AbortController,
): Promise<void> {
  const artifact = await finalizeErosionGpuRawOutput({
    raw: request.raw,
    sourceTerrainHash: request.sourceTerrainHash,
    configHash: request.configHash,
    signal: controller.signal,
  });
  assertErosionNotAborted(controller.signal);
  const persistenceStartedAt = performance.now();
  await withStore(request, async (store) => {
    await store.save(artifact);
    await store.clearCheckpoint();
  });
  const persistenceMs = performance.now() - persistenceStartedAt;
  assertErosionNotAborted(controller.signal);
  const summary = await summarizeErosionFieldAsync(artifact.field, controller.signal);
  const record = recordForTransfer(artifact, false, summary, persistenceMs);
  ctx.postMessage({ type: "erosionBuilt", requestId: request.requestId, artifact: record }, artifactTransferables(record));
}

async function buildCpu(
  request: Extract<ErosionWorkerRequest, { type: "buildErosion" }>,
  controller: AbortController,
): Promise<void> {
  setTerrainFieldConfig(request.terrainFieldConfig);
  const result = await withStore(request, async (store) => {
    const cached = await store.load();
    if (cached) return { artifact: cached, cacheHit: true, persistenceMs: cached.persistenceMs };
    const loadedCheckpoint = await store.loadCheckpoint();
    let checkpoint = loadedCheckpoint && loadedCheckpoint.kind !== "gpu" ? loadedCheckpoint : null;
    if (loadedCheckpoint?.kind === "gpu") await store.clearCheckpoint();
    let checkpointPersistenceEnabled = true;
    const saveCheckpoint = async (next: Parameters<typeof store.saveCheckpoint>[0]): Promise<void> => {
      if (!checkpointPersistenceEnabled) return;
      try {
        await store.saveCheckpoint(next);
      } catch (error) {
        checkpointPersistenceEnabled = false;
        console.warn("[erosion] CPU checkpoint persistence disabled after a storage failure", error);
      }
    };
    const build = (resume: typeof checkpoint): Promise<PersistedErosionArtifact> => buildErosionCpu({
      ...request,
      sampleHeightMeters: baseSurfaceHeight,
      ...(resume ? { checkpoint: resume } : {}),
      signal: controller.signal,
    }, {
      seaLevelM: request.seaLevelM,
      onProgress: (progress) => ctx.postMessage({ type: "erosionProgress", requestId: request.requestId, progress }),
      onCheckpoint: saveCheckpoint,
    });
    let artifact: PersistedErosionArtifact;
    try {
      artifact = await build(checkpoint);
    } catch (error) {
      if (!checkpoint || !(error instanceof Error) || !error.message.includes("checkpoint")) throw error;
      await store.clearCheckpoint();
      checkpoint = null;
      artifact = await build(null);
    }
    assertErosionNotAborted(controller.signal);
    const persistenceStartedAt = performance.now();
    await store.save(artifact);
    await store.clearCheckpoint();
    return {
      artifact,
      cacheHit: false,
      persistenceMs: performance.now() - persistenceStartedAt,
    };
  });
  assertErosionNotAborted(controller.signal);
  const summary = await summarizeErosionFieldAsync(result.artifact.field, controller.signal);
  const record = recordForTransfer(result.artifact, result.cacheHit, summary, result.persistenceMs);
  ctx.postMessage({ type: "erosionBuilt", requestId: request.requestId, artifact: record }, artifactTransferables(record));
}

async function sampleSource(
  request: Extract<ErosionWorkerRequest, { type: "sampleErosionSource" }>,
  controller: AbortController,
): Promise<void> {
  const startedAt = performance.now();
  setTerrainFieldConfig(request.terrainFieldConfig);
  const source = await sampleErosionSourceFieldAsync({
    sizeM: request.sizeM,
    ...(request.originM ? { originM: request.originM } : {}),
    config: request.config,
    sampleHeightMeters: baseSurfaceHeight,
    seed: request.seed,
    seaLevelM: request.seaLevelM,
    signal: controller.signal,
  });
  const initial = await packErosionGpuInitialStateAsync(
    source,
    request.config.erosion.borderCells,
    0,
    controller.signal,
  );
  const result = Object.freeze({ ...initial, samplingMs: performance.now() - startedAt });
  ctx.postMessage(
    { type: "erosionSourceSampled", requestId: request.requestId, initial: result },
    [result.stateAData],
  );
}

function runControlled(requestId: number, run: (controller: AbortController) => Promise<void>): void {
  const controller = new AbortController();
  controllers.set(requestId, controller);
  void run(controller)
    .catch((error) => postError(requestId, error))
    .finally(() => controllers.delete(requestId));
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
    runControlled(request.requestId, (controller) => finalizeGpu(request, controller));
    return;
  }
  if (request.type === "sampleErosionSource") {
    runControlled(request.requestId, (controller) => sampleSource(request, controller));
    return;
  }
  runControlled(request.requestId, (controller) => buildCpu(request, controller));
};
