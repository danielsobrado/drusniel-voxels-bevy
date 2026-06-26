import type { ClodPagesConfig } from "../config.js";
import { isGrassShaderMode, type GrassShaderMode } from "../grass.js";
import type { BrushOp, BrushShape, VoxelEditSnapshot } from "../terrain/terrain.js";
import { MAX_TERRAIN_TEXTURES } from "../terrain/terrain_textures.js";
import type { WeatherMode } from "../app/clod_constants.js";
import { DEFAULT_RAIN_WEATHER_SETTINGS } from "../weather/rain.js";
import { DEFAULT_WATER_VISUAL, WATER_DEBUG_MODES, type WaterDebugMode } from "../water/waterConfig.js";
import type { ProjectPropInstance } from "./project_props.js";

export const VOXEL_PROJECT_SCHEMA_VERSION = 3 as const;
const PROJECT_FILE = "project.json";
const IMPORT_DB = "drusniel-clod-imports";
const IMPORT_STORE = "projects";

export type TextureBlendMode = "hard bands" | "blend bands";
export type PostProcessDebugMode = "output" | "copy" | "off";

export interface ProjectSessionState {
  thresholdPx: number;
  enforce21: boolean;
  freeze: boolean;
  wireframe: boolean;
  showBounds: boolean;
  showSeamPoints: boolean;
  showCrossLodBorders: boolean;
  colorByLod: boolean;
  normalColor: boolean;
  normalDivergence: boolean;
  divergenceGain: number;
  frontSideOnly: boolean;
  recomputedNormals: boolean;
  forceMaxLevel: "auto" | "0" | "1" | "2" | "3";
  textureScale: number;
  triplanar: boolean;
  albedo: boolean;
  normalMap: boolean;
  normalIntensity: number;
  roughness: number;
  metalness: number;
  textureBlendMode: TextureBlendMode;
  textureBlendWidth: number;
  terrainBrightness: number;
  terrainContrast: number;
  terrainSaturation: number;
  terrainWarmth: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunIntensity: number;
  skyIntensity: number;
  groundIntensity: number;
  exposure: number;
  horizonSoftness: number;
  sunDiskIntensity: number;
  sunGlowIntensity: number;
  hazeIntensity: number;
  postProcessEnabled: boolean;
  postProcessOpacity: number;
  postProcessExposure: number;
  postProcessContrast: number;
  postProcessSaturation: number;
  postProcessVignette: number;
  postProcessDebugMode: PostProcessDebugMode;
  bubble: boolean;
  bubbleRadius: number;
  tintBubble: boolean;
  digEnabled: boolean;
  digRadius: number;
  brushOp: BrushOp;
  brushShape: BrushShape;
  brushMaterial: number;
  brushHeight: number;
  brushStrength: number;
  brushFalloff: number;
  brushFlowMs: number;
  grassEnabled: boolean;
  grassShaderMode: GrassShaderMode;
  grassAlphaToCoverage: boolean;
  grassDistance: number;
  grassBladeSpacing: number;
  grassBladeHeight: number;
  grassBladeHeightVariation: number;
  grassBladeWidth: number;
  grassWindStrength: number;
  grassWindSpeed: number;
  grassSlopeMinY: number;
  grassMinHeight: number;
  grassMaxHeight: number;
  grassMaxBlades: number;
  grassSeed: number;
  treesEnabled?: boolean;
  treeDistance?: number;
  treeMaxInstances?: number;
  treeDebugColorByLod?: boolean;
  treeWindEnabled?: boolean;
  treeWindStrength?: number;
  treeWindSpeed?: number;
  treeGustStrength?: number;
  treeTrunkSwayStrength?: number;
  treeLeafFlutterStrength?: number;
}

export interface ProjectTextureSlot {
  index: number;
  source: "empty" | "builtin" | "custom";
  name: string;
  selectedId: string;
  scale: number;
  heightMin: number;
  heightMax: number;
  customPath?: string;
  mimeType?: string;
  normalPath?: string;
  normalMimeType?: string;
}

export interface ProjectWaterArchiveState {
  waterEnabled: boolean;
  waterDebugMode: WaterDebugMode;
  waterClipmapTint: boolean;
  waterWireframe: boolean;
  waterDepthWrite: boolean;
}

export interface ProjectWeatherArchiveState {
  weatherMode: WeatherMode;
  weatherIntensity: number;
  weatherWindX: number;
  weatherWindZ: number;
}

export const DEFAULT_PROJECT_WATER_ARCHIVE_STATE: ProjectWaterArchiveState = {
  waterEnabled: true,
  waterDebugMode: "final",
  waterClipmapTint: false,
  waterWireframe: false,
  waterDepthWrite: DEFAULT_WATER_VISUAL.depthWrite,
};

export const DEFAULT_PROJECT_WEATHER_ARCHIVE_STATE: ProjectWeatherArchiveState = {
  weatherMode: "off",
  weatherIntensity: DEFAULT_RAIN_WEATHER_SETTINGS.intensity,
  weatherWindX: DEFAULT_RAIN_WEATHER_SETTINGS.windX,
  weatherWindZ: DEFAULT_RAIN_WEATHER_SETTINGS.windZ,
};

export interface VoxelProjectManifest {
  schemaVersion: typeof VOXEL_PROJECT_SCHEMA_VERSION;
  kind: "drusniel-clod-project";
  exportedAt: string;
  worldSize: number;
  config: ClodPagesConfig;
  state: ProjectSessionState;
  water: ProjectWaterArchiveState;
  weather: ProjectWeatherArchiveState;
  voxelTerrainEdits: VoxelEditSnapshot;
  props: readonly ProjectPropInstance[];
  textures: ProjectTextureSlot[];
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
}

export interface VoxelProjectArchiveContents {
  manifest: VoxelProjectManifest;
  customTextures: Map<string, Uint8Array>;
}

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
  if (value.brushMaterial < 0 || value.brushMaterial >= MAX_TERRAIN_TEXTURES) throw new Error("project.json has unsafe brush material");
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
  if (!isRecord(value) || value.schemaVersion !== VOXEL_PROJECT_SCHEMA_VERSION || value.kind !== "drusniel-clod-project") {
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
