import { baseSurfaceHeight, setTerrainFieldConfig } from "../../terrain/terrain_surface.js";
import { IndexedDbErosionArtifactStore, openErosionArtifactDb } from "./artifact_store.js";
import { buildErosionCpu } from "./cpu_builder.js";
import { packErosionGpuInitialState } from "./gpu/buffers.js";
import { sampleErosionSourceField } from "./state.js";
import type { ErosionWorkerArtifactRecord, ErosionWorkerRequest, ErosionWorkerResponse } from "./worker_protocol.js";

const ctx = self as unknown as {
  postMessage(message: ErosionWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ErosionWorkerRequest>) => void) | null;
};
const controllers = new Map<number, AbortController>();

function recordForTransfer(artifact: Awaited<ReturnType<typeof buildErosionCpu>>, cacheHit: boolean): ErosionWorkerArtifactRecord {
  return {
    ref: artifact.ref,
    compressedBytes: artifact.compressedBytes,
    buildMs: artifact.buildMs,
    gpuMs: artifact.gpuMs,
    readbackMs: artifact.readbackMs,
    checkpointCount: artifact.checkpointCount,
    massErrorRatio: artifact.massErrorRatio,
    cacheHit,
  };
}

ctx.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancelErosion") {
    controllers.get(request.requestId)?.abort(new DOMException("Erosion build cancelled", "AbortError"));
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
      });
      const initial = packErosionGpuInitialState(source, request.config.erosion.borderCells);
      ctx.postMessage(
        { type: "erosionSourceSampled", requestId: request.requestId, initial, sampleMs: performance.now() - startedAt },
        [initial.stateAData],
      );
    } catch (error) {
      ctx.postMessage({
        type: "erosionError",
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      controllers.delete(request.requestId);
    }
    return;
  }
  void (async () => {
    setTerrainFieldConfig(request.terrainFieldConfig);
    const db = await openErosionArtifactDb();
    const store = new IndexedDbErosionArtifactStore(db, request.sourceTerrainHash, request.configHash);
    try {
      const cached = await store.load();
      if (cached) return { artifact: cached, cacheHit: true };
      let checkpoint = await store.loadCheckpoint();
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
    } finally {
      store.close();
    }
  })().then(({ artifact, cacheHit }) => {
    const record = recordForTransfer(artifact, cacheHit);
    ctx.postMessage({ type: "erosionBuilt", requestId: request.requestId, artifact: record }, [record.compressedBytes]);
  }).catch((error) => {
    ctx.postMessage({
      type: "erosionError",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }).finally(() => controllers.delete(request.requestId));
};
