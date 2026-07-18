import type { IslandShapeConfig } from "../world_source/island_shape.js";
import type { TerrainFieldConfig, VoxelEditSnapshot } from "../terrain/terrain.js";
import { MAX_TERRAIN_TEXTURES } from "../terrain/terrain_textures.js";
import { decodeProjectArchive, encodeProjectArchive } from "./project_archive_codec.js";
import { validateProjectArchiveConfig } from "./project_archive_config.js";
import {
  validateProjectWaterArchiveState,
  validateProjectWeatherArchiveState,
} from "./project_archive_environment_state.js";
import {
  assertProjectArchivePath,
  PROJECT_ARCHIVE_LIMITS,
} from "./project_archive_limits.js";
import { validateProjectSessionState } from "./project_archive_session_state.js";
import { validateProjectGeneratorQuery } from "./project_world_identity.js";
import type { ProjectPropInstance } from "./project_props.js";
import type {
  CurrentVoxelProjectManifest,
  ProjectTextureSlot,
  ProjectWorldIdentity,
  VoxelProjectManifest,
  VoxelProjectArchiveContents,
} from "./voxel_project_archive_types.js";
export type {
  CurrentVoxelProjectManifest,
  ProjectWorldIdentity,
  TextureBlendMode,
  PostProcessDebugMode,
  ProjectSessionState,
  ProjectTextureSlot,
  ProjectWaterArchiveState,
  ProjectWeatherArchiveState,
  VoxelProjectManifest,
  VoxelProjectManifestV3,
  VoxelProjectManifestV4,
  VoxelProjectArchiveContents,
} from "./voxel_project_archive_types.js";
export {
  LEGACY_VOXEL_PROJECT_SCHEMA_VERSION,
  VOXEL_PROJECT_SCHEMA_VERSION,
} from "./voxel_project_archive_types.js";
export {
  DEFAULT_PROJECT_WATER_ARCHIVE_STATE,
  DEFAULT_PROJECT_WEATHER_ARCHIVE_STATE,
} from "./voxel_project_archive_defaults.js";

const PROJECT_FILE = "project.json";
const IMPORT_DB = "drusniel-clod-imports";
const IMPORT_STORE = "projects";
export const STAGED_PROJECT_IMPORT_MAX_AGE_MS = 30 * 60 * 1000;

interface StagedVoxelProjectImport {
  manifest: VoxelProjectManifest;
  customTextures: [string, Uint8Array][];
  createdAtMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isVec4(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber);
}

function assertNonEmptyString(value: unknown, label: string, maxLength = 256): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters`);
  }
}

function optionalSafeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

function finiteInRange(value: unknown, label: string, min: number, max: number): number {
  if (!isFiniteNumber(value) || value < min || value > max) throw new Error(`${label} is outside the supported range`);
  return value;
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

function consumeStoreValue<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const getRequest = store.get(key);
    getRequest.onerror = () => reject(getRequest.error ?? new Error("staged project lookup failed"));
    getRequest.onsuccess = () => {
      const value = getRequest.result as T | undefined;
      if (value === undefined) {
        resolve(undefined);
        return;
      }
      const deleteRequest = store.delete(key);
      deleteRequest.onerror = () => reject(deleteRequest.error ?? new Error("staged project deletion failed"));
      deleteRequest.onsuccess = () => resolve(value);
    };
  });
}

async function openImportDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(IMPORT_DB, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(IMPORT_STORE)) request.result.createObjectStore(IMPORT_STORE);
  };
  return requestResult(request);
}

function validateTextureSlots(value: unknown): ProjectTextureSlot[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TERRAIN_TEXTURES) {
    throw new Error("project.json has invalid textures");
  }
  const archivePaths = new Set<string>();
  return value.map((raw, index) => {
    const label = `project.json textures[${index}]`;
    if (!isRecord(raw) || raw.index !== index || !["empty", "builtin", "custom"].includes(String(raw.source))) {
      throw new Error(`${label} is invalid`);
    }
    if (typeof raw.name !== "string" || raw.name.length > 256 || typeof raw.selectedId !== "string" || raw.selectedId.length > 256) {
      throw new Error(`${label} contains invalid names`);
    }
    const scale = finiteInRange(raw.scale, `${label}.scale`, 0.000001, 1000);
    const heightMin = finiteInRange(raw.heightMin, `${label}.heightMin`, -1_000_000, 1_000_000);
    const heightMax = finiteInRange(raw.heightMax, `${label}.heightMax`, -1_000_000, 1_000_000);
    if (heightMax < heightMin) throw new Error(`${label} has an inverted height range`);

    let customPath: string | undefined;
    let normalPath: string | undefined;
    for (const [pathKey, pathValue] of [["customPath", raw.customPath], ["normalPath", raw.normalPath]] as const) {
      if (pathValue === undefined) continue;
      if (typeof pathValue !== "string") throw new Error(`${label}.${pathKey} is invalid`);
      assertProjectArchivePath(pathValue);
      if (pathValue === PROJECT_FILE || archivePaths.has(pathValue)) throw new Error(`${label}.${pathKey} duplicates an archive path`);
      archivePaths.add(pathValue);
      if (pathKey === "customPath") customPath = pathValue;
      else normalPath = pathValue;
    }
    if (raw.source === "custom" && customPath === undefined) throw new Error(`${label}.customPath is required`);
    if (raw.source !== "custom" && customPath !== undefined) throw new Error(`${label}.customPath requires custom source ownership`);
    if (raw.mimeType !== undefined && typeof raw.mimeType !== "string") throw new Error(`${label}.mimeType is invalid`);
    if (raw.normalMimeType !== undefined && typeof raw.normalMimeType !== "string") throw new Error(`${label}.normalMimeType is invalid`);

    const slot: ProjectTextureSlot = {
      index,
      source: raw.source as ProjectTextureSlot["source"],
      name: raw.name,
      selectedId: raw.selectedId,
      scale,
      heightMin,
      heightMax,
    };
    if (customPath !== undefined) slot.customPath = customPath;
    if (normalPath !== undefined) slot.normalPath = normalPath;
    if (typeof raw.mimeType === "string") slot.mimeType = raw.mimeType;
    if (typeof raw.normalMimeType === "string") slot.normalMimeType = raw.normalMimeType;
    return slot;
  });
}

function validateVoxelEditSnapshot(value: unknown): VoxelEditSnapshot {
  if (!isRecord(value) || !isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.deltas)) {
    throw new Error("project.json voxelTerrainEdits is invalid");
  }

  const snapshotRevision = value.revision;
  const coordinates = new Set<string>();
  const deltas = value.deltas.map((raw, index) => {
    const label = `project.json voxelTerrainEdits.deltas[${index}]`;
    if (!isRecord(raw)) throw new Error(`${label} must be an object`);
    if (!isSafeInteger(raw.x) || !isSafeInteger(raw.y) || !isSafeInteger(raw.z)) {
      throw new Error(`${label} coordinates must be safe integers`);
    }
    if (!isFiniteNumber(raw.density)) throw new Error(`${label}.density must be finite`);
    if (!isSafeInteger(raw.revision) || raw.revision < 0 || raw.revision > snapshotRevision) {
      throw new Error(`${label}.revision must be a non-negative safe integer within the snapshot revision`);
    }
    let materialSlot: number | undefined;
    if (raw.materialSlot !== undefined) {
      if (!isSafeInteger(raw.materialSlot) || raw.materialSlot < 0 || raw.materialSlot >= MAX_TERRAIN_TEXTURES) {
        throw new Error(`${label}.materialSlot is invalid`);
      }
      materialSlot = raw.materialSlot;
    }
    const coordinateKey = `${raw.x},${raw.y},${raw.z}`;
    if (coordinates.has(coordinateKey)) throw new Error(`${label} duplicates voxel ${coordinateKey}`);
    coordinates.add(coordinateKey);
    return {
      x: raw.x,
      y: raw.y,
      z: raw.z,
      density: raw.density,
      ...(materialSlot === undefined ? {} : { materialSlot }),
      revision: raw.revision,
    };
  });

  return { revision: snapshotRevision, deltas };
}

function validateProps(value: unknown): ProjectPropInstance[] {
  if (!Array.isArray(value)) throw new Error("project.json props must be an array");
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const label = `project.json props[${index}]`;
    if (!isRecord(raw) || !isVec3(raw.position) || !isVec4(raw.rotation) || !isVec3(raw.scale)) {
      throw new Error(`${label} is invalid`);
    }
    assertNonEmptyString(raw.id, `${label}.id`);
    assertNonEmptyString(raw.prefabId, `${label}.prefabId`);
    if (ids.has(raw.id)) throw new Error(`${label}.id is duplicated`);
    ids.add(raw.id);
    if (raw.scale.some((scale) => scale <= 0)) throw new Error(`${label}.scale must be positive`);
    if (raw.anchor !== undefined && raw.anchor !== "world" && raw.anchor !== "terrain" && raw.anchor !== "voxel") {
      throw new Error(`${label}.anchor is invalid`);
    }

    const prop: ProjectPropInstance = {
      id: raw.id,
      prefabId: raw.prefabId,
      position: [...raw.position],
      rotation: [...raw.rotation],
      scale: [...raw.scale],
      anchor: raw.anchor ?? "world",
    };
    const seed = optionalSafeInteger(raw.seed, `${label}.seed`);
    const variationId = optionalSafeInteger(raw.variationId, `${label}.variationId`);
    const flags = optionalSafeInteger(raw.flags, `${label}.flags`);
    const revision = optionalSafeInteger(raw.revision, `${label}.revision`);
    if (seed !== undefined) prop.seed = seed;
    if (variationId !== undefined) prop.variationId = variationId;
    if (flags !== undefined) prop.flags = flags;
    if (revision !== undefined) prop.revision = revision;
    return prop;
  });
}

function validateIslandShape(value: unknown): IslandShapeConfig {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || typeof value.oceanRim !== "boolean") {
    throw new Error("project.json world.terrainField.islandShape is invalid");
  }
  if (!isSafeInteger(value.seed)) throw new Error("project.json world island seed must be a safe integer");
  return {
    enabled: value.enabled,
    oceanRim: value.oceanRim,
    seed: value.seed,
    seaLevel: finiteInRange(value.seaLevel, "project.json world island sea level", -100_000, 100_000),
    spacingM: finiteInRange(value.spacingM, "project.json world island spacing", 64, 10_000_000),
    radiusM: finiteInRange(value.radiusM, "project.json world island radius", 16, 10_000_000),
    blendM: finiteInRange(value.blendM, "project.json world island blend", 1, 10_000_000),
    warpStrengthM: finiteInRange(value.warpStrengthM, "project.json world island warp", 0, 10_000_000),
    beachWidthM: finiteInRange(value.beachWidthM, "project.json world beach width", 1, 10_000_000),
    cliffWidthM: finiteInRange(value.cliffWidthM, "project.json world cliff width", 1, 10_000_000),
    worldRadiusM: finiteInRange(value.worldRadiusM, "project.json world radius", 1, 100_000_000),
    oceanRimDropM: finiteInRange(value.oceanRimDropM, "project.json world ocean rim drop", 1, 10_000_000),
  };
}

function validateWorldIdentity(value: unknown): ProjectWorldIdentity {
  if (!isRecord(value)) throw new Error("project.json schema v4 is missing world identity");
  assertNonEmptyString(value.scene, "project.json world.scene", 128);
  if (!/^[A-Za-z0-9_-]+$/.test(value.scene)) throw new Error("project.json world.scene contains unsupported characters");
  assertNonEmptyString(value.generatorVersion, "project.json world.generatorVersion", 128);
  if (!isRecord(value.terrainField) || !isSafeInteger(value.terrainField.seed)) {
    throw new Error("project.json world.terrainField is invalid");
  }
  const terrainField: TerrainFieldConfig = {
    seed: value.terrainField.seed,
    seaLevel: finiteInRange(value.terrainField.seaLevel, "project.json world sea level", -100_000, 100_000),
    islandShape: validateIslandShape(value.terrainField.islandShape),
  };
  return {
    scene: value.scene,
    generatorVersion: value.generatorVersion,
    terrainField,
    generatorQuery: validateProjectGeneratorQuery(value.generatorQuery),
  };
}

export function isCurrentVoxelProjectManifest(manifest: VoxelProjectManifest): manifest is CurrentVoxelProjectManifest {
  return manifest.schemaVersion === 4;
}

export function validateVoxelProjectManifest(value: unknown): VoxelProjectManifest {
  if (!isRecord(value) || (value.schemaVersion !== 3 && value.schemaVersion !== 4) || value.kind !== "drusniel-clod-project") {
    throw new Error("Unsupported voxel project format or schema version");
  }
  if (!isFiniteNumber(value.worldSize) || ![2, 4, 8, 16, 32].includes(value.worldSize)) throw new Error("project.json has an unsupported world size");
  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) throw new Error("project.json has an invalid export timestamp");
  if (!isRecord(value.camera) || !isVec3(value.camera.position) || !isVec3(value.camera.target)) throw new Error("project.json has invalid orbit camera data");

  const common = {
    kind: "drusniel-clod-project" as const,
    exportedAt: value.exportedAt,
    worldSize: value.worldSize,
    config: validateProjectArchiveConfig(value.config),
    state: validateProjectSessionState(value.state),
    water: validateProjectWaterArchiveState(value.water),
    weather: validateProjectWeatherArchiveState(value.weather),
    voxelTerrainEdits: validateVoxelEditSnapshot(value.voxelTerrainEdits),
    props: validateProps(value.props),
    textures: validateTextureSlots(value.textures),
    camera: { position: [...value.camera.position] as [number, number, number], target: [...value.camera.target] as [number, number, number] },
  };
  if (value.schemaVersion === 4) return { ...common, schemaVersion: 4, world: validateWorldIdentity(value.world) };
  return { ...common, schemaVersion: 3 };
}

function expectedArchiveAssetPaths(manifest: VoxelProjectManifest): Set<string> {
  const paths = new Set<string>();
  for (const slot of manifest.textures) {
    if (slot.source === "custom" && slot.customPath) paths.add(slot.customPath);
    if (slot.normalPath) paths.add(slot.normalPath);
  }
  return paths;
}

function validateArchiveContents(contents: VoxelProjectArchiveContents): VoxelProjectArchiveContents {
  const manifest = validateVoxelProjectManifest(contents.manifest);
  const expectedPaths = expectedArchiveAssetPaths(manifest);
  if (contents.customTextures.size !== expectedPaths.size) throw new Error("project archive texture payload does not match its manifest");
  let totalBytes = 0;
  for (const [path, bytes] of contents.customTextures) {
    if (!expectedPaths.has(path)) throw new Error(`project archive contains unreferenced texture ${path}`);
    if (!(bytes instanceof Uint8Array)) throw new Error(`project archive texture ${path} is invalid`);
    if (bytes.byteLength > PROJECT_ARCHIVE_LIMITS.maxEntryUncompressedBytes) throw new Error(`project archive texture ${path} exceeds its size limit`);
    totalBytes += bytes.byteLength;
  }
  if (totalBytes > PROJECT_ARCHIVE_LIMITS.maxTotalUncompressedBytes) throw new Error("project archive textures exceed the total size limit");
  return { manifest, customTextures: new Map([...contents.customTextures].map(([path, bytes]) => [path, bytes.slice()])) };
}

export async function createVoxelProjectArchive(
  manifest: CurrentVoxelProjectManifest,
  customTextures: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const { strToU8 } = await import("fflate");
  const normalized = validateArchiveContents({ manifest, customTextures: new Map(customTextures) });
  if (!isCurrentVoxelProjectManifest(normalized.manifest)) throw new Error("new project archives must use the current schema");
  const projectBytes = strToU8(JSON.stringify(normalized.manifest, null, 2));
  if (projectBytes.byteLength > PROJECT_ARCHIVE_LIMITS.maxProjectJsonBytes) throw new Error("project.json exceeds its size limit");
  const files: import("fflate").Zippable = {
    [PROJECT_FILE]: [projectBytes, { level: 6 }],
  };
  for (const [path, bytes] of normalized.customTextures) files[path] = [bytes, { level: 0 }];
  if (Object.keys(files).length > PROJECT_ARCHIVE_LIMITS.maxEntries) throw new Error("project archive contains too many entries");
  return encodeProjectArchive(files);
}

export async function parseVoxelProjectArchive(bytes: Uint8Array): Promise<VoxelProjectArchiveContents> {
  const { strFromU8 } = await import("fflate");
  const files = await decodeProjectArchive(bytes);

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(strFromU8(files[PROJECT_FILE]!));
  } catch {
    throw new Error("project.json is not valid JSON");
  }

  const manifest = validateVoxelProjectManifest(rawManifest);
  const expectedPaths = expectedArchiveAssetPaths(manifest);
  const actualPaths = new Set(Object.keys(files).filter((path) => path !== PROJECT_FILE));
  if (actualPaths.size !== expectedPaths.size || [...actualPaths].some((path) => !expectedPaths.has(path))) {
    throw new Error("project archive contains files not referenced by project.json");
  }
  const customTextures = new Map<string, Uint8Array>();
  for (const path of expectedPaths) customTextures.set(path, files[path]!);
  return validateArchiveContents({ manifest, customTextures });
}

function stagedImportExpired(staged: StagedVoxelProjectImport, nowMs: number): boolean {
  return typeof staged.createdAtMs === "number"
    && Number.isFinite(staged.createdAtMs)
    && nowMs - staged.createdAtMs > STAGED_PROJECT_IMPORT_MAX_AGE_MS;
}

function pruneExpiredStagedImports(store: IDBObjectStore, nowMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error("staged project cleanup failed"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const staged = cursor.value as StagedVoxelProjectImport;
      if (stagedImportExpired(staged, nowMs)) cursor.delete();
      cursor.continue();
    };
  });
}

export async function stageVoxelProjectImport(
  contents: VoxelProjectArchiveContents,
  nowMs = Date.now(),
): Promise<string> {
  if (!Number.isFinite(nowMs)) throw new Error("staged project timestamp is invalid");
  const normalized = validateArchiveContents(contents);
  const token = crypto.randomUUID();
  const staged: StagedVoxelProjectImport = {
    manifest: normalized.manifest,
    customTextures: [...normalized.customTextures],
    createdAtMs: nowMs,
  };
  const db = await openImportDb();
  try {
    const transaction = db.transaction(IMPORT_STORE, "readwrite");
    const store = transaction.objectStore(IMPORT_STORE);
    store.put(staged, token);
    await pruneExpiredStagedImports(store, nowMs);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
  return token;
}

export async function consumeStagedVoxelProjectImport(
  token: string,
  nowMs = Date.now(),
): Promise<VoxelProjectArchiveContents | null> {
  if (!Number.isFinite(nowMs)) throw new Error("staged project timestamp is invalid");
  const db = await openImportDb();
  try {
    const transaction = db.transaction(IMPORT_STORE, "readwrite");
    const store = transaction.objectStore(IMPORT_STORE);
    const staged = await consumeStoreValue<StagedVoxelProjectImport>(store, token);
    await transactionDone(transaction);
    if (!staged || stagedImportExpired(staged, nowMs)) return null;
    return validateArchiveContents({
      manifest: staged.manifest,
      customTextures: new Map(staged.customTextures),
    });
  } finally {
    db.close();
  }
}
