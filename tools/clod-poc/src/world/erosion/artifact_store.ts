import { decodeErosionArtifact } from "./artifact_codec.js";
import type { ErosionArtifact, ErosionArtifactRef, ErosionCheckpoint } from "./types.js";

export const EROSION_DB_NAME = "drusniel-erosion-artifacts";
export const EROSION_DB_VERSION = 1;
export const EROSION_ARTIFACT_STORE_NAME = "artifacts";
export const EROSION_CHECKPOINT_STORE_NAME = "checkpoints";

interface ErosionArtifactRecord {
  readonly schemaVersion: 1;
  readonly ref: ErosionArtifactRef;
  readonly compressedBytes: ArrayBuffer;
  readonly buildMs: number;
  readonly gpuMs: number;
  readonly readbackMs: number;
  readonly checkpointCount: number;
  readonly massErrorRatio: number;
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

export async function openErosionArtifactDb(
  factory: Pick<IDBFactory, "open"> = indexedDB,
  name = EROSION_DB_NAME,
): Promise<IDBDatabase> {
  const request = factory.open(name, EROSION_DB_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(EROSION_ARTIFACT_STORE_NAME)) {
      request.result.createObjectStore(EROSION_ARTIFACT_STORE_NAME);
    }
    if (!request.result.objectStoreNames.contains(EROSION_CHECKPOINT_STORE_NAME)) {
      request.result.createObjectStore(EROSION_CHECKPOINT_STORE_NAME);
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

  async load(): Promise<ErosionArtifact | null> {
    const transaction = this.db.transaction(EROSION_ARTIFACT_STORE_NAME, "readonly");
    const value = await requestResult(transaction.objectStore(EROSION_ARTIFACT_STORE_NAME).get(this.key));
    await transactionDone(transaction);
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<ErosionArtifactRecord>;
    if (record.schemaVersion !== 1 || !record.ref || !(record.compressedBytes instanceof ArrayBuffer)
      || typeof record.buildMs !== "number" || typeof record.gpuMs !== "number"
      || typeof record.readbackMs !== "number" || typeof record.checkpointCount !== "number"
      || typeof record.massErrorRatio !== "number") return null;
    try {
      return await decodeErosionArtifact({
        ref: record.ref,
        compressedBytes: record.compressedBytes,
        buildMs: record.buildMs,
        gpuMs: record.gpuMs,
        readbackMs: record.readbackMs,
        checkpointCount: record.checkpointCount,
        massErrorRatio: record.massErrorRatio,
      });
    } catch {
      await this.clearArtifact();
      return null;
    }
  }

  async save(artifact: ErosionArtifact): Promise<void> {
    const record: ErosionArtifactRecord = {
      schemaVersion: 1,
      ref: artifact.ref,
      compressedBytes: artifact.compressedBytes.slice(0),
      buildMs: artifact.buildMs,
      gpuMs: artifact.gpuMs,
      readbackMs: artifact.readbackMs,
      checkpointCount: artifact.checkpointCount,
      massErrorRatio: artifact.massErrorRatio,
    };
    const transaction = this.db.transaction(EROSION_ARTIFACT_STORE_NAME, "readwrite");
    transaction.objectStore(EROSION_ARTIFACT_STORE_NAME).put(record, this.key);
    await transactionDone(transaction);
  }

  async loadCheckpoint(): Promise<ErosionCheckpoint | null> {
    const transaction = this.db.transaction(EROSION_CHECKPOINT_STORE_NAME, "readonly");
    const checkpoint = await requestResult(transaction.objectStore(EROSION_CHECKPOINT_STORE_NAME).get(this.key));
    await transactionDone(transaction);
    return checkpoint && typeof checkpoint === "object" ? checkpoint as ErosionCheckpoint : null;
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

export function downloadErosionArtifact(artifact: ErosionArtifact, worldId: string): void {
  if (typeof document === "undefined") throw new Error("erosion artifact download requires a browser document");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([artifact.compressedBytes], { type: "application/zstd" }));
  link.download = `${worldId.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}-erosion-v1.bin.zst`;
  link.click();
  URL.revokeObjectURL(link.href);
}
