import { setActiveErodedMacroField, setLatestErosionArtifactRef, toErodedMacroField } from "../erosion/integration.js";
import type { ErosionArtifactRef } from "../erosion/types.js";
import { compactHydrologyGraph, type HydrologyGraphArtifact } from "./hydrology_graph_artifact.js";
import { HYDROLOGY_GRAPH_VERSION, type HydrologyErosionAuthority, type HydrologyGraph } from "./hydrology_graph.js";

export const HYDROLOGY_GRAPH_DB_NAME = "drusniel-hydrology-graphs";
export const HYDROLOGY_GRAPH_DB_VERSION = 3;
export const HYDROLOGY_GRAPH_STORE_NAME = "hydrology_graphs";

interface ErosionRecordMeta {
  readonly artifactRef: ErosionArtifactRef;
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
}

interface HydrologyGraphRecord {
  readonly schemaVersion: 3;
  readonly terrainSourceHash: string;
  readonly graphParamsHash: string;
  readonly ref: HydrologyGraphArtifact["ref"];
  readonly buildMs: number;
  readonly graphJson: string;
  readonly lakeIndex: ArrayBuffer;
  readonly erosion: ErosionRecordMeta;
  readonly erosionHeightFixed: ArrayBuffer;
  readonly erosionHardness: ArrayBuffer;
  readonly erosionSediment: ArrayBuffer;
  readonly erosionDeposition: ArrayBuffer;
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
  if (value.version !== HYDROLOGY_GRAPH_VERSION || !macro?.erosion) return false;
  const count = macro.resX * macro.resZ;
  const erosionCount = macro.erosion.width * macro.erosion.height;
  return Number.isSafeInteger(macro.resX) && macro.resX > 1
    && Number.isSafeInteger(macro.resZ) && macro.resZ > 1
    && macro.lakeIndex instanceof Int32Array && macro.lakeIndex.length === count
    && macro.erosion.heightFixed.length === erosionCount
    && macro.erosion.hardness.length === erosionCount
    && macro.erosion.sediment.length === erosionCount
    && macro.erosion.deposition.length === erosionCount
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
    if (record.schemaVersion !== 3
      || record.terrainSourceHash !== this.terrainSourceHash
      || record.graphParamsHash !== this.graphParamsHash
      || !record.ref?.hash || !record.erosion?.artifactRef
      || typeof record.buildMs !== "number" || !Number.isFinite(record.buildMs)
      || typeof record.graphJson !== "string"
      || !(record.lakeIndex instanceof ArrayBuffer)
      || !(record.erosionHeightFixed instanceof ArrayBuffer)
      || !(record.erosionHardness instanceof ArrayBuffer)
      || !(record.erosionSediment instanceof ArrayBuffer)
      || !(record.erosionDeposition instanceof ArrayBuffer)) return null;
    try {
      const parsed = JSON.parse(record.graphJson) as HydrologyGraph;
      const erosionCount = record.erosion.width * record.erosion.height;
      if (record.lakeIndex.byteLength !== parsed.macro.resX * parsed.macro.resZ * Int32Array.BYTES_PER_ELEMENT
        || record.erosionHeightFixed.byteLength !== erosionCount * Int32Array.BYTES_PER_ELEMENT
        || record.erosionHardness.byteLength !== erosionCount * Uint16Array.BYTES_PER_ELEMENT
        || record.erosionSediment.byteLength !== erosionCount * Uint32Array.BYTES_PER_ELEMENT
        || record.erosionDeposition.byteLength !== erosionCount * Int32Array.BYTES_PER_ELEMENT) return null;
      const erosion: HydrologyErosionAuthority = {
        ...record.erosion,
        heightFixed: new Int32Array(record.erosionHeightFixed),
        hardness: new Uint16Array(record.erosionHardness),
        sediment: new Uint32Array(record.erosionSediment),
        deposition: new Int32Array(record.erosionDeposition),
      };
      const graph: HydrologyGraph = {
        ...parsed,
        macro: { ...parsed.macro, lakeIndex: new Int32Array(record.lakeIndex), erosion },
      };
      if (!graphShapeValid(graph)) return null;
      setActiveErodedMacroField(toErodedMacroField(erosion));
      setLatestErosionArtifactRef(erosion.artifactRef, graph.worldId);
      return { ref: record.ref, buildMs: record.buildMs, graph };
    } catch {
      return null;
    }
  }

  async save(artifact: HydrologyGraphArtifact): Promise<void> {
    const transaction = this.db.transaction(HYDROLOGY_GRAPH_STORE_NAME, "readwrite");
    const graph = compactHydrologyGraph(artifact.graph);
    const erosion = graph.macro.erosion;
    if (!erosion) throw new Error("continent hydrology graph cannot be persisted without erosion authority");
    const macroJson = {
      resX: graph.macro.resX,
      resZ: graph.macro.resZ,
      sizeM: graph.macro.sizeM,
      originM: graph.macro.originM,
      spacingM: graph.macro.spacingM,
    };
    const erosionMeta: ErosionRecordMeta = {
      artifactRef: erosion.artifactRef,
      width: erosion.width,
      height: erosion.height,
      cellSizeM: erosion.cellSizeM,
      originX: erosion.originX,
      originZ: erosion.originZ,
    };
    const record: HydrologyGraphRecord = {
      schemaVersion: 3,
      terrainSourceHash: this.terrainSourceHash,
      graphParamsHash: this.graphParamsHash,
      ref: artifact.ref,
      buildMs: artifact.buildMs,
      graphJson: JSON.stringify({ ...graph, macro: macroJson }),
      lakeIndex: graph.macro.lakeIndex.buffer.slice(graph.macro.lakeIndex.byteOffset, graph.macro.lakeIndex.byteOffset + graph.macro.lakeIndex.byteLength) as ArrayBuffer,
      erosion: erosionMeta,
      erosionHeightFixed: erosion.heightFixed.buffer.slice(erosion.heightFixed.byteOffset, erosion.heightFixed.byteOffset + erosion.heightFixed.byteLength) as ArrayBuffer,
      erosionHardness: erosion.hardness.buffer.slice(erosion.hardness.byteOffset, erosion.hardness.byteOffset + erosion.hardness.byteLength) as ArrayBuffer,
      erosionSediment: erosion.sediment.buffer.slice(erosion.sediment.byteOffset, erosion.sediment.byteOffset + erosion.sediment.byteLength) as ArrayBuffer,
      erosionDeposition: erosion.deposition.buffer.slice(erosion.deposition.byteOffset, erosion.deposition.byteOffset + erosion.deposition.byteLength) as ArrayBuffer,
    };
    transaction.objectStore(HYDROLOGY_GRAPH_STORE_NAME).put(record, storeKey(this.terrainSourceHash, this.graphParamsHash));
    await transactionDone(transaction);
  }

  close(): void { this.db.close(); }
}
