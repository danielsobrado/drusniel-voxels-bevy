import { compactHydrologyGraph, type HydrologyGraphArtifact } from "./hydrology_graph_artifact.js";
import { HYDROLOGY_GRAPH_VERSION, type HydrologyGraph } from "./hydrology_graph.js";

export const HYDROLOGY_GRAPH_DB_NAME = "drusniel-hydrology-graphs";
export const HYDROLOGY_GRAPH_DB_VERSION = 2;
export const HYDROLOGY_GRAPH_STORE_NAME = "hydrology_graphs";

interface HydrologyGraphRecord {
  readonly schemaVersion: 2;
  readonly terrainSourceHash: string;
  readonly graphParamsHash: string;
  readonly ref: HydrologyGraphArtifact["ref"];
  readonly buildMs: number;
  readonly graphJson: string;
  readonly lakeIndex: ArrayBuffer;
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

function storeKey(terrainSourceHash: string, graphParamsHash: string): string {
  return `${terrainSourceHash}/${graphParamsHash}`;
}

function graphShapeValid(graph: unknown): graph is HydrologyGraph {
  if (!graph || typeof graph !== "object") return false;
  const value = graph as Partial<HydrologyGraph>;
  const macro = value.macro;
  if (value.version !== HYDROLOGY_GRAPH_VERSION || !macro) return false;
  const count = macro.resX * macro.resZ;
  return Number.isSafeInteger(macro.resX) && macro.resX > 1
    && Number.isSafeInteger(macro.resZ) && macro.resZ > 1
    && macro.lakeIndex instanceof Int32Array && macro.lakeIndex.length === count
    && Array.isArray(value.rivers) && Array.isArray(value.lakes);
}

export async function openHydrologyGraphDb(
  factory: Pick<IDBFactory, "open"> = indexedDB,
  name = HYDROLOGY_GRAPH_DB_NAME,
): Promise<IDBDatabase> {
  const request = factory.open(name, HYDROLOGY_GRAPH_DB_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(HYDROLOGY_GRAPH_STORE_NAME)) {
      request.result.createObjectStore(HYDROLOGY_GRAPH_STORE_NAME);
    }
  };
  return requestResult(request);
}

export class IndexedDbHydrologyGraphStore {
  constructor(
    private readonly db: IDBDatabase,
    private readonly terrainSourceHash: string,
    private readonly graphParamsHash: string,
  ) {
    if (!terrainSourceHash || !graphParamsHash) throw new Error("hydrology graph store hashes are required");
  }

  async load(): Promise<HydrologyGraphArtifact | null> {
    const transaction = this.db.transaction(HYDROLOGY_GRAPH_STORE_NAME, "readonly");
    const value = await requestResult(transaction.objectStore(HYDROLOGY_GRAPH_STORE_NAME).get(
      storeKey(this.terrainSourceHash, this.graphParamsHash),
    ));
    await transactionDone(transaction);
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<HydrologyGraphRecord>;
    if (record.schemaVersion !== 2
      || record.terrainSourceHash !== this.terrainSourceHash
      || record.graphParamsHash !== this.graphParamsHash
      || !record.ref?.hash
      || typeof record.buildMs !== "number" || !Number.isFinite(record.buildMs)
      || typeof record.graphJson !== "string"
      || !(record.lakeIndex instanceof ArrayBuffer)) return null;
    try {
      const parsed = JSON.parse(record.graphJson) as HydrologyGraph;
      const count = parsed.macro.resX * parsed.macro.resZ;
      if (record.lakeIndex.byteLength !== count * Int32Array.BYTES_PER_ELEMENT) return null;
      const graph: HydrologyGraph = {
        ...parsed,
        macro: { ...parsed.macro, lakeIndex: new Int32Array(record.lakeIndex) },
      };
      if (!graphShapeValid(graph)) return null;
      return { ref: record.ref, buildMs: record.buildMs, graph };
    } catch {
      return null;
    }
  }

  async save(artifact: HydrologyGraphArtifact): Promise<void> {
    const transaction = this.db.transaction(HYDROLOGY_GRAPH_STORE_NAME, "readwrite");
    const graph = compactHydrologyGraph(artifact.graph);
    const { lakeIndex: _lakeIndex, ...macroJson } = graph.macro;
    const record: HydrologyGraphRecord = {
      schemaVersion: 2,
      terrainSourceHash: this.terrainSourceHash,
      graphParamsHash: this.graphParamsHash,
      ref: artifact.ref,
      buildMs: artifact.buildMs,
      graphJson: JSON.stringify({ ...graph, macro: macroJson }),
      lakeIndex: graph.macro.lakeIndex.buffer.slice(
        graph.macro.lakeIndex.byteOffset,
        graph.macro.lakeIndex.byteOffset + graph.macro.lakeIndex.byteLength,
      ) as ArrayBuffer,
    };
    transaction.objectStore(HYDROLOGY_GRAPH_STORE_NAME).put(
      record,
      storeKey(this.terrainSourceHash, this.graphParamsHash),
    );
    await transactionDone(transaction);
  }

  close(): void { this.db.close(); }
}
