import type { ClodPagesConfig } from "../config.js";
import { isGrassShaderMode } from "../grass/grass_config.js";
import type { VoxelEditSnapshot } from "../terrain/terrain.js";
import { MAX_TERRAIN_TEXTURES } from "../terrain/terrain_textures.js";
import { WATER_DEBUG_MODES } from "../water/waterConfig.js";
import type { ProjectPropInstance } from "./project_props.js";
import type {
  ProjectSessionState,
  ProjectTextureSlot,
  ProjectWaterArchiveState,
  ProjectWeatherArchiveState,
  VoxelProjectManifest,
  VoxelProjectArchiveContents,
} from "./voxel_project_archive_types.js";
export type {
  TextureBlendMode,
  PostProcessDebugMode,
  ProjectSessionState,
  ProjectTextureSlot,
  ProjectWaterArchiveState,
  ProjectWeatherArchiveState,
  VoxelProjectManifest,
  VoxelProjectArchiveContents,
} from "./voxel_project_archive_types.js";
export { VOXEL_PROJECT_SCHEMA_VERSION } from "./voxel_project_archive_types.js";
export {
  DEFAULT_PROJECT_WATER_ARCHIVE_STATE,
  DEFAULT_PROJECT_WEATHER_ARCHIVE_STATE,
} from "./voxel_project_archive_defaults.js";

const PROJECT_FILE = "project.json";
const IMPORT_DB = "drusniel-clod-imports";
const IMPORT_STORE = "projects";

interface StagedVoxelProjectImport {
  manifest: VoxelProjectManifest;
  customTextures: [string, Uint8Array][];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isVec4(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber);
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
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
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted"));
  });
}

async function openImportDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(IMPORT_DB, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(IMPORT_STORE)) request.result.createObjectStore(IMPORT_STORE);
  };
  return requestResult(request);
}

function assertConfig(value: unknown): asserts value is ClodPagesConfig {
  if (!isRecord(value) || !isRecord(value.page) || !isRecord(value.simplify) || !isRecord(value.selection) || !isRecord(value.near_field)) {
    throw new Error("project.json has an invalid CLOD config snapshot");
  }
}

function assertSessionState(value: unknown): asserts value is ProjectSessionState {
  if (!isRecord(value)) throw new Error("project.json is missing session state");
  if (!isGrassShaderMode(value.grassShaderMode)) throw new Error("project.json has an invalid grassShaderMode");
  if (!["remove", "add"].includes(String(value.brushOp))) throw new Error("project.json has an invalid brushOp");
  if (!["sphere", "cube", "cylinder"].includes(String(value.brushShape))) throw new Error("project.json has an invalid brushShape");
  const numericKeys = ["thresholdPx", "digRadius", "brushMaterial", "brushHeight", "brushStrength", "brushFalloff", "grassMaxBlades"] as const;
  for (const key of numericKeys) {
    if (!isFiniteNumber(value[key]) || Math.abs(value[key]) > 1_000_000) throw new Error(`project.json state.${key} must be finite`);
  }
  const brushMaterial = value.brushMaterial as number;
  if (brushMaterial < 0 || brushMaterial >= MAX_TERRAIN_TEXTURES) throw new Error("project.json has unsafe brush material");
}

function assertTextureSlot(value: unknown, index: number): asserts value is ProjectTextureSlot {
  if (!isRecord(value) || value.index !== index || !["empty", "builtin", "custom"].includes(String(value.source)) || typeof value.name !== "string" || typeof value.selectedId !== "string") {
    throw new Error(`project.json textures[${index}] is invalid`);
  }
}

function validateVoxelEditSnapshot(value: unknown): VoxelEditSnapshot {
  if (!isRecord(value) || typeof value.revision !== "number" || !Array.isArray(value.deltas)) {
    throw new Error("project.json voxelTerrainEdits is invalid");
  }
  return {
    revision: value.revision,
    deltas: value.deltas.filter(isRecord).map((delta) => ({
      x: Number(delta.x),
      y: Number(delta.y),
      z: Number(delta.z),
      density: Number(delta.density),
      materialSlot: delta.materialSlot === undefined ? undefined : Number(delta.materialSlot),
      revision: Number(delta.revision),
    })).filter((delta) => Number.isSafeInteger(delta.x) && Number.isSafeInteger(delta.y) && Number.isSafeInteger(delta.z) && Number.isFinite(delta.density) && Number.isSafeInteger(delta.revision)),
  };
}

function validateProps(value: unknown): ProjectPropInstance[] {
  if (!Array.isArray(value)) throw new Error("project.json props must be an array");
  return value.map((raw, index) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.prefabId !== "string" || !isVec3(raw.position) || !isVec4(raw.rotation) || !isVec3(raw.scale)) {
      throw new Error(`project.json props[${index}] is invalid`);
    }
    const prop: ProjectPropInstance = {
      id: raw.id,
      prefabId: raw.prefabId,
      position: [...raw.position],
      rotation: [...raw.rotation],
      scale: [...raw.scale],
      anchor: raw.anchor === "terrain" || raw.anchor === "voxel" ? raw.anchor : "world",
    };
    const seed = optionalFiniteNumber(raw.seed);
    const variationId = optionalFiniteNumber(raw.variationId);
    const flags = optionalFiniteNumber(raw.flags);
    const revision = optionalFiniteNumber(raw.revision);
    if (seed !== undefined) prop.seed = seed;
    if (variationId !== undefined) prop.variationId = variationId;
    if (flags !== undefined) prop.flags = flags;
    if (revision !== undefined) prop.revision = revision;
    return prop;
  });
}

function assertWaterArchiveState(value: unknown): asserts value is ProjectWaterArchiveState {
  if (!isRecord(value)) throw new Error("project.json is missing water state");
  if (typeof value.waterEnabled !== "boolean") throw new Error("project.json water.waterEnabled must be a boolean");
  if (!Object.prototype.hasOwnProperty.call(WATER_DEBUG_MODES, String(value.waterDebugMode))) throw new Error("project.json water.waterDebugMode is invalid");
}

function assertWeatherArchiveState(value: unknown): asserts value is ProjectWeatherArchiveState {
  if (!isRecord(value)) throw new Error("project.json is missing weather state");
  if (!["off", "rain", "snow", "sandstorm"].includes(String(value.weatherMode))) throw new Error("project.json weather.weatherMode is invalid");
}

export function validateVoxelProjectManifest(value: unknown): VoxelProjectManifest {
  if (!isRecord(value) || value.schemaVersion !== 3 || value.kind !== "drusniel-clod-project") {
    throw new Error("Unsupported voxel project format or schema version");
  }
  if (!isFiniteNumber(value.worldSize) || ![2, 4, 8, 16, 32].includes(value.worldSize)) throw new Error("project.json has an unsupported world size");
  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) throw new Error("project.json has an invalid export timestamp");
  assertConfig(value.config);
  assertSessionState(value.state);
  assertWaterArchiveState(value.water);
  assertWeatherArchiveState(value.weather);
  if (!Array.isArray(value.textures) || value.textures.length < 1 || value.textures.length > MAX_TERRAIN_TEXTURES) throw new Error("project.json has invalid textures");
  value.textures.forEach((slot, index) => assertTextureSlot(slot, index));
  if (!isRecord(value.camera) || !isVec3(value.camera.position) || !isVec3(value.camera.target)) throw new Error("project.json has invalid orbit camera data");

  return {
    ...(value as unknown as VoxelProjectManifest),
    voxelTerrainEdits: validateVoxelEditSnapshot(value.voxelTerrainEdits),
    props: validateProps(value.props),
  };
}

export async function createVoxelProjectArchive(
  manifest: VoxelProjectManifest,
  customTextures: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const { strToU8, zipSync } = await import("fflate");
  const normalizedManifest = validateVoxelProjectManifest(manifest);
  const files: import("fflate").Zippable = {
    [PROJECT_FILE]: [strToU8(JSON.stringify(normalizedManifest, null, 2)), { level: 6 }],
  };

  for (const slot of normalizedManifest.textures) {
    if (slot.source === "custom" && slot.customPath) {
      const bytes = customTextures.get(slot.customPath);
      if (!bytes) throw new Error(`Missing custom texture bytes for ${slot.customPath}`);
      files[slot.customPath] = [bytes, { level: 0 }];
    }
    if (slot.normalPath) {
      const bytes = customTextures.get(slot.normalPath);
      if (!bytes) throw new Error(`Missing normal-map bytes for ${slot.normalPath}`);
      files[slot.normalPath] = [bytes, { level: 0 }];
    }
  }

  return zipSync(files);
}

export async function parseVoxelProjectArchive(bytes: Uint8Array): Promise<VoxelProjectArchiveContents> {
  const { strFromU8, unzipSync } = await import("fflate");
  const files = unzipSync(bytes);
  if (!files[PROJECT_FILE]) throw new Error("The archive is missing project.json");

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(strFromU8(files[PROJECT_FILE]));
  } catch {
    throw new Error("project.json is not valid JSON");
  }

  const manifest = validateVoxelProjectManifest(rawManifest);
  const customTextures = new Map<string, Uint8Array>();
  for (const slot of manifest.textures) {
    if (slot.source === "custom" && slot.customPath) {
      const texture = files[slot.customPath];
      if (!texture) throw new Error(`The archive is missing ${slot.customPath}`);
      customTextures.set(slot.customPath, texture);
    }
    if (slot.normalPath) {
      const normal = files[slot.normalPath];
      if (!normal) throw new Error(`The archive is missing ${slot.normalPath}`);
      customTextures.set(slot.normalPath, normal);
    }
  }

  return { manifest, customTextures };
}

export async function stageVoxelProjectImport(contents: VoxelProjectArchiveContents): Promise<string> {
  const token = crypto.randomUUID();
  const staged: StagedVoxelProjectImport = {
    manifest: contents.manifest,
    customTextures: [...contents.customTextures],
  };
  const db = await openImportDb();
  try {
    const transaction = db.transaction(IMPORT_STORE, "readwrite");
    transaction.objectStore(IMPORT_STORE).put(staged, token);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
  return token;
}

export async function consumeStagedVoxelProjectImport(token: string): Promise<VoxelProjectArchiveContents | null> {
  const db = await openImportDb();
  try {
    const transaction = db.transaction(IMPORT_STORE, "readwrite");
    const store = transaction.objectStore(IMPORT_STORE);
    const staged = await requestResult(store.get(token)) as StagedVoxelProjectImport | undefined;
    if (staged) store.delete(token);
    await transactionDone(transaction);
    if (!staged) return null;
    return {
      manifest: validateVoxelProjectManifest(staged.manifest),
      customTextures: new Map(staged.customTextures),
    };
  } finally {
    db.close();
  }
}
