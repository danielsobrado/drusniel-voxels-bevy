import { decodeErosionArtifact } from "./artifact_codec.js";
import { EROSION_SCHEMA_VERSION } from "./constants.js";
import type {
  ErosionArtifactRef,
  ErosionCheckpoint,
  ErosionGpuCheckpoint,
  PersistedErosionArtifact,
} from "./types.js";

export const EROSION_DB_NAME = "drusniel-erosion-artifacts";
export const EROSION_DB_VERSION = 2;
export const EROSION_ARTIFACT_STORE_NAME = "artifacts";
export const EROSION_CHECKPOINT_STORE_NAME = "checkpoints";

interface ErosionArtifactRecord {
  readonly schemaVersion: typeof EROSION_SCHEMA_VERSION;
  readonly ref: ErosionArtifactRef;
  readonly compressedBytes: ArrayBuffer;
  readonly buildMs: number;
  readonly samplingMs: number;
  readonly gpuMs: number;
  readonly readbackMs: number;
  readonly finalizeMs: number;
  readonly persistenceMs: number;
  readonly checkpointCount: number;
  readonly massErrorRatio: number;
  readonly gpuPassTimingsMs: Readonly<Record<string, number>>;
  readonly timestampQueriesSupported: boolean;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function artifactKey(sourceTerrainHash: string, configHash: string): string {
  if (!sourceTerrainHash || !configHash) throw new Error("erosion artifact store hashes are required");
  return `${sourceTerrainHash}/${configHash}`;
}

function isGpuCheckpoint(value: unknown): value is ErosionGpuCheckpoint {
  if (!value || typeof value !== "object") return false;
  const checkpoint = value as Partial<ErosionGpuCheckpoint>;
  return checkpoint.kind === "gpu"
    && checkpoint.schemaVersion === EROSION_SCHEMA_VERSION
    && typeof checkpoint.sourceTerrainHash === "string"
    && typeof checkpoint.configHash === "string"
    && Number.isSafeInteger(checkpoint.hydraulicIteration)
    && Number.isSafeInteger(checkpoint.thermalIteration)
    && !!checkpoint.initial
    && Number.isSafeInteger(checkpoint.packedByteLength)
    && Array.isArray(checkpoint.packedChunks)
    && checkpoint.packedChunks.every((chunk) => chunk instanceof ArrayBuffer);
}

export async function openErosionArtifactDb(
  factory: Pick<IDBFactory, "open"> = indexedDB,
  name = EROSION_DB_NAME,
): Promise<IDBDatabase> {
  const request = factory.open(name, EROSION_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(EROSION_ARTIFACT_STORE_NAME)) {
      db.createObjectStore(EROSION_ARTIFACT_STORE_NAME);
    } else {
      request.transaction?.objectStore(EROSION_ARTIFACT_STORE_NAME).clear();
    }
    if (!db.objectStoreNames.contains(EROSION_CHECKPOINT_STORE_NAME)) {
      db.createObjectStore(EROSION_CHECKPOINT_STORE_NAME);
    } else {
      request.transaction?.objectStore(EROSION_CHECKPOINT_STORE_NAME).clear();
    }
  };
  return requestResult(request);
}

export class IndexedDbErosionArtifactStore {
  private readonly key: string;

  constructor(
    private readonly db: IDBDatabase,
    sourceTerrainHash: string,
    configHash: string,
  ) {
    this.key = artifactKey(sourceTerrainHash, configHash);
  }

  async load(): Promise<PersistedErosionArtifact | null> {
    const transaction = this.db.transaction(EROSION_ARTIFACT_STORE_NAME, "readonly");
    const value = await requestResult(transaction.objectStore(EROSION_ARTIFACT_STORE_NAME).get(this.key));
    await transactionDone(transaction);
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<ErosionArtifactRecord>;
    if (!record.ref
      || record.schemaVersion !== EROSION_SCHEMA_VERSION
      || record.ref.schemaVersion !== EROSION_SCHEMA_VERSION
      || !(record.compressedBytes instanceof ArrayBuffer)
      || typeof record.buildMs !== "number" || typeof record.gpuMs !== "number"
      || typeof record.readbackMs !== "number" || typeof record.checkpointCount !== "number"
      || typeof record.massErrorRatio !== "number") {
      await this.clearArtifact();
      return null;
    }
    try {
      return await decodeErosionArtifact({
        ref: record.ref,
        compressedBytes: record.compressedBytes,
        buildMs: record.buildMs,
        samplingMs: record.samplingMs ?? 0,
        gpuMs: record.gpuMs,
        readbackMs: record.readbackMs,
        finalizeMs: record.finalizeMs ?? 0,
        persistenceMs: record.persistenceMs ?? 0,
        checkpointCount: record.checkpointCount,
        massErrorRatio: record.massErrorRatio,
        gpuPassTimingsMs: record.gpuPassTimingsMs ?? {},
        timestampQueriesSupported: record.timestampQueriesSupported ?? false,
      });
    } catch {
      await this.clearArtifact();
      return null;
    }
  }

  async save(artifact: PersistedErosionArtifact): Promise<void> {
    const record: ErosionArtifactRecord = {
      schemaVersion: EROSION_SCHEMA_VERSION,
      ref: artifact.ref,
      compressedBytes: artifact.compressedBytes,
      buildMs: artifact.buildMs,
      samplingMs: artifact.samplingMs,
      gpuMs: artifact.gpuMs,
      readbackMs: artifact.readbackMs,
      finalizeMs: artifact.finalizeMs,
      persistenceMs: artifact.persistenceMs,
      checkpointCount: artifact.checkpointCount,
      massErrorRatio: artifact.massErrorRatio,
      gpuPassTimingsMs: { ...artifact.gpuPassTimingsMs },
      timestampQueriesSupported: artifact.timestampQueriesSupported,
    };
    const transaction = this.db.transaction(EROSION_ARTIFACT_STORE_NAME, "readwrite");
    transaction.objectStore(EROSION_ARTIFACT_STORE_NAME).put(record, this.key);
    await transactionDone(transaction);
  }

  async loadCheckpoint(): Promise<ErosionCheckpoint | null> {
    const transaction = this.db.transaction(EROSION_CHECKPOINT_STORE_NAME, "readonly");
    const checkpoint = await requestResult(transaction.objectStore(EROSION_CHECKPOINT_STORE_NAME).get(this.key));
    await transactionDone(transaction);
    if (!checkpoint || typeof checkpoint !== "object") return null;
    const schemaVersion = (checkpoint as { schemaVersion?: unknown }).schemaVersion;
    if (schemaVersion !== EROSION_SCHEMA_VERSION) {
      await this.clearCheckpoint();
      return null;
    }
    if ((checkpoint as { kind?: unknown }).kind === "gpu" && !isGpuCheckpoint(checkpoint)) {
      await this.clearCheckpoint();
      return null;
    }
    return checkpoint as ErosionCheckpoint;
  }

  async loadGpuCheckpoint(): Promise<ErosionGpuCheckpoint | null> {
    const checkpoint = await this.loadCheckpoint();
    return checkpoint && checkpoint.kind === "gpu" ? checkpoint : null;
  }

  async saveCheckpoint(checkpoint: ErosionCheckpoint): Promise<void> {
    const transaction = this.db.transaction(EROSION_CHECKPOINT_STORE_NAME, "readwrite");
    transaction.objectStore(EROSION_CHECKPOINT_STORE_NAME).put(checkpoint, this.key);
    await transactionDone(transaction);
  }

  async clearCheckpoint(): Promise<void> {
    const transaction = this.db.transaction(EROSION_CHECKPOINT_STORE_NAME, "readwrite");
    transaction.objectStore(EROSION_CHECKPOINT_STORE_NAME).delete(this.key);
    await transactionDone(transaction);
  }

  async clearArtifact(): Promise<void> {
    const transaction = this.db.transaction(EROSION_ARTIFACT_STORE_NAME, "readwrite");
    transaction.objectStore(EROSION_ARTIFACT_STORE_NAME).delete(this.key);
    await transactionDone(transaction);
  }

  close(): void { this.db.close(); }
}

export function downloadErosionArtifact(artifact: PersistedErosionArtifact, worldId: string): void {
  if (typeof document === "undefined") throw new Error("erosion artifact download requires a browser document");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([artifact.compressedBytes], { type: "application/zstd" }));
  link.download = `${worldId.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}-erosion-v${EROSION_SCHEMA_VERSION}.bin.zst`;
  link.click();
  URL.revokeObjectURL(link.href);
}
