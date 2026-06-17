import type { ClodPagesConfig } from "./config.js";
import { isGrassShaderMode, type GrassShaderMode } from "./grass.js";
import type { BrushOp, BrushShape, DigEdit } from "./terrain.js";
import { MAX_TERRAIN_TEXTURES } from "./terrain_textures.js";

export const PROJECT_SCHEMA_VERSION = 1 as const;
const PROJECT_FILE = "project.json";
const TERRAIN_FILE = "terrain.glb";
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

export interface ClodProjectManifestV1 {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  kind: "drusniel-clod-project";
  exportedAt: string;
  worldSize: number;
  config: ClodPagesConfig;
  state: ProjectSessionState;
  terrainEdits: DigEdit[];
  textures: ProjectTextureSlot[];
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
}

export interface ProjectArchiveContents {
  manifest: ClodProjectManifestV1;
  terrainGlb: Uint8Array;
  customTextures: Map<string, Uint8Array>;
}

interface StagedProjectImport {
  manifest: ClodProjectManifestV1;
  terrainGlb: Uint8Array;
  customTextures: [string, Uint8Array][];
}

const NUMBER_STATE_KEYS: (keyof ProjectSessionState)[] = [
  "thresholdPx", "divergenceGain", "textureScale", "normalIntensity", "roughness", "metalness", "textureBlendWidth",
  "terrainBrightness", "terrainContrast", "terrainSaturation", "terrainWarmth",
  "sunAzimuthDeg", "sunElevationDeg", "sunIntensity", "skyIntensity", "groundIntensity",
  "exposure", "horizonSoftness", "sunDiskIntensity", "sunGlowIntensity", "hazeIntensity",
  "postProcessOpacity", "postProcessExposure", "postProcessContrast", "postProcessSaturation",
  "postProcessVignette", "bubbleRadius", "digRadius", "brushMaterial", "brushHeight",
  "brushStrength", "brushFalloff", "brushFlowMs", "grassDistance",
  "grassBladeSpacing", "grassBladeHeight", "grassBladeHeightVariation", "grassBladeWidth",
  "grassWindStrength", "grassWindSpeed", "grassSlopeMinY", "grassMinHeight", "grassMaxHeight",
  "grassMaxBlades", "grassSeed",
];

const BOOLEAN_STATE_KEYS: (keyof ProjectSessionState)[] = [
  "enforce21", "freeze", "wireframe", "showBounds", "showSeamPoints", "showCrossLodBorders",
  "colorByLod", "normalColor", "normalDivergence", "frontSideOnly", "recomputedNormals",
  "triplanar", "albedo", "normalMap",
  "postProcessEnabled", "bubble", "tintBubble", "digEnabled", "grassEnabled",
  "grassAlphaToCoverage",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function assertConfig(value: unknown): asserts value is ClodPagesConfig {
  if (!isRecord(value) || !isRecord(value.page) || !isRecord(value.simplify) ||
      !isRecord(value.selection) || !isRecord(value.near_field) ||
      !isRecord(value.simplify.attribute_weights)) {
    throw new Error("project.json has an invalid CLOD config snapshot");
  }
  const numbers = [
    value.page.chunks_per_page, value.page.chunk_size, value.page.halo_chunks, value.page.quadtree_levels,
    value.simplify.target_ratio_per_level, value.simplify.abandon_ratio, value.simplify.target_error,
    value.simplify.weld_epsilon_cells, value.simplify.attribute_weights.normal,
    value.simplify.attribute_weights.material, value.selection.error_threshold_px,
    value.selection.hysteresis_merge_factor, value.selection.neighbor_level_delta_max,
    value.selection.crossfade_frames, value.near_field.radius_chunks,
  ];
  const chunksPerPage = value.page.chunks_per_page;
  const chunkSize = value.page.chunk_size;
  const quadtreeLevels = value.page.quadtree_levels;
  if (!numbers.every(isFiniteNumber) || typeof value.meshopt_package_version !== "string" ||
      !["instant", "dither"].includes(String(value.selection.transition_mode)) ||
      !isFiniteNumber(chunksPerPage) || chunksPerPage < 1 || chunksPerPage > 16 ||
      !isFiniteNumber(chunkSize) || chunkSize < 4 || chunkSize > 128 ||
      !isFiniteNumber(quadtreeLevels) || quadtreeLevels < 1 || quadtreeLevels > 8) {
    throw new Error("project.json has unsafe or invalid CLOD config values");
  }
}

function assertSessionState(value: unknown): asserts value is ProjectSessionState {
  if (!isRecord(value)) throw new Error("project.json is missing session state");
  // Backward compat: alpha-to-coverage was added after some projects were saved. Fill it in
  // (default off) before the boolean-key check so older project.json files still load.
  if (value.grassAlphaToCoverage === undefined) {
    value.grassAlphaToCoverage = false;
  }
  for (const key of NUMBER_STATE_KEYS) {
    if (!isFiniteNumber(value[key]) || Math.abs(value[key]) > 1_000_000) {
      throw new Error(`project.json state.${key} must be a safe finite number`);
    }
  }
  for (const key of BOOLEAN_STATE_KEYS) {
    if (typeof value[key] !== "boolean") throw new Error(`project.json state.${key} must be a boolean`);
  }
  if (!["auto", "0", "1", "2", "3"].includes(String(value.forceMaxLevel))) {
    throw new Error("project.json has an invalid forceMaxLevel");
  }
  if (!["hard bands", "blend bands"].includes(String(value.textureBlendMode))) {
    throw new Error("project.json has an invalid textureBlendMode");
  }
  if (!["output", "copy", "off"].includes(String(value.postProcessDebugMode))) {
    throw new Error("project.json has an invalid postProcessDebugMode");
  }
  if (value.grassShaderMode === undefined) {
    value.grassShaderMode = "classic";
  }
  if (!isGrassShaderMode(value.grassShaderMode)) {
    throw new Error("project.json has an invalid grassShaderMode");
  }
  if (!["remove", "add"].includes(String(value.brushOp))) {
    throw new Error("project.json has an invalid brushOp");
  }
  if (!["sphere", "cube", "cylinder"].includes(String(value.brushShape))) {
    throw new Error("project.json has an invalid brushShape");
  }
  const brushMaterial = value.brushMaterial;
  const digRadius = value.digRadius;
  const brushHeight = value.brushHeight;
  const brushStrength = value.brushStrength;
  const brushFalloff = value.brushFalloff;
  const brushFlowMs = value.brushFlowMs;
  const grassMaxBlades = value.grassMaxBlades;
  if (!isFiniteNumber(brushMaterial) || !Number.isInteger(brushMaterial) || brushMaterial < 0 || brushMaterial >= MAX_TERRAIN_TEXTURES ||
      !isFiniteNumber(digRadius) || digRadius < 1 || digRadius > 8 ||
      !isFiniteNumber(brushHeight) || brushHeight < 1 || brushHeight > 16 ||
      !isFiniteNumber(brushStrength) || brushStrength < 0 || brushStrength > 1 ||
      !isFiniteNumber(brushFalloff) || brushFalloff < 0 || brushFalloff > 1 ||
      !isFiniteNumber(brushFlowMs) || brushFlowMs < 80 || brushFlowMs > 600 ||
      !isFiniteNumber(grassMaxBlades) || grassMaxBlades < 0 || grassMaxBlades > 100_000) {
    throw new Error("project.json has unsafe brush or grass settings");
  }
}

function assertDigEdit(value: unknown, index: number): asserts value is DigEdit {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y) ||
      !isFiniteNumber(value.z) || !isFiniteNumber(value.r) || value.r <= 0) {
    throw new Error(`project.json terrainEdits[${index}] is invalid`);
  }
  if (value.shape !== undefined && !["sphere", "cube", "cylinder"].includes(String(value.shape))) {
    throw new Error(`project.json terrainEdits[${index}] has an invalid shape`);
  }
  if (value.op !== undefined && !["remove", "add"].includes(String(value.op))) {
    throw new Error(`project.json terrainEdits[${index}] has an invalid operation`);
  }
  if (value.material !== undefined &&
      (!isFiniteNumber(value.material) || !Number.isInteger(value.material) || value.material < 0 || value.material >= MAX_TERRAIN_TEXTURES)) {
    throw new Error(`project.json terrainEdits[${index}] has an invalid material`);
  }
  if (value.height !== undefined && (!isFiniteNumber(value.height) || value.height <= 0 || value.height > 16)) {
    throw new Error(`project.json terrainEdits[${index}] has an invalid height`);
  }
  if (value.strength !== undefined && (!isFiniteNumber(value.strength) || value.strength < 0 || value.strength > 1)) {
    throw new Error(`project.json terrainEdits[${index}] has an invalid strength`);
  }
  if (value.falloff !== undefined && (!isFiniteNumber(value.falloff) || value.falloff < 0 || value.falloff > 1)) {
    throw new Error(`project.json terrainEdits[${index}] has an invalid falloff`);
  }
}

function assertTextureSlot(value: unknown, index: number): asserts value is ProjectTextureSlot {
  if (!isRecord(value) || value.index !== index || !["empty", "builtin", "custom"].includes(String(value.source)) ||
      typeof value.name !== "string" || typeof value.selectedId !== "string" ||
      !isFiniteNumber(value.scale) || !isFiniteNumber(value.heightMin) || !isFiniteNumber(value.heightMax)) {
    throw new Error(`project.json textures[${index}] is invalid`);
  }
  if (value.source === "custom" &&
      (typeof value.customPath !== "string" ||
       !new RegExp(`^textures/slot-${index}\\.[a-z0-9]{1,8}$`, "i").test(value.customPath) ||
       typeof value.mimeType !== "string")) {
    throw new Error(`project.json textures[${index}] is missing custom texture metadata`);
  }
  if (value.normalPath !== undefined &&
      (typeof value.normalPath !== "string" ||
       !new RegExp(`^textures/slot-${index}-normal\\.[a-z0-9]{1,8}$`, "i").test(value.normalPath) ||
       typeof value.normalMimeType !== "string")) {
    throw new Error(`project.json textures[${index}] has invalid normal-map metadata`);
  }
}

export function validateProjectManifest(value: unknown): ClodProjectManifestV1 {
  if (!isRecord(value) || value.schemaVersion !== PROJECT_SCHEMA_VERSION || value.kind !== "drusniel-clod-project") {
    throw new Error("Unsupported CLOD project format or schema version");
  }
  if (!isFiniteNumber(value.worldSize) || ![2, 4, 8, 16, 32].includes(value.worldSize)) {
    throw new Error("project.json has an unsupported world size");
  }
  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new Error("project.json has an invalid export timestamp");
  }
  assertConfig(value.config);
  assertSessionState(value.state);
  if (!Array.isArray(value.terrainEdits)) throw new Error("project.json terrainEdits must be an array");
  value.terrainEdits.forEach(assertDigEdit);
  if (!Array.isArray(value.textures) || value.textures.length < 1 || value.textures.length > MAX_TERRAIN_TEXTURES) {
    throw new Error(`project.json must contain between 1 and ${MAX_TERRAIN_TEXTURES} texture slots`);
  }
  value.textures.forEach((slot, index) => assertTextureSlot(slot, index));
  if (!isRecord(value.camera) || !isVec3(value.camera.position) || !isVec3(value.camera.target)) {
    throw new Error("project.json has invalid orbit camera data");
  }
  return value as unknown as ClodProjectManifestV1;
}

export async function createProjectArchive(
  manifest: ClodProjectManifestV1,
  terrainGlb: Uint8Array,
  customTextures: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const { strToU8, zipSync } = await import("fflate");
  validateProjectManifest(manifest);
  const files: import("fflate").Zippable = {
    [PROJECT_FILE]: [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }],
    [TERRAIN_FILE]: [terrainGlb, { level: 0 }],
  };
  for (const slot of manifest.textures) {
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

export async function parseProjectArchive(bytes: Uint8Array): Promise<ProjectArchiveContents> {
  const { strFromU8, unzipSync } = await import("fflate");
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("The selected file is not a readable ZIP archive");
  }
  if (!files[PROJECT_FILE]) throw new Error("The archive is missing project.json");
  if (!files[TERRAIN_FILE]) throw new Error("The archive is missing terrain.glb");
  const terrainGlb = files[TERRAIN_FILE];
  if (terrainGlb.byteLength < 12 || new DataView(terrainGlb.buffer, terrainGlb.byteOffset, terrainGlb.byteLength).getUint32(0, true) !== 0x46546c67) {
    throw new Error("terrain.glb is not a valid binary glTF file");
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(strFromU8(files[PROJECT_FILE]));
  } catch {
    throw new Error("project.json is not valid JSON");
  }
  const manifest = validateProjectManifest(rawManifest);
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
  return { manifest, terrainGlb, customTextures };
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

export async function stageProjectImport(contents: ProjectArchiveContents): Promise<string> {
  const token = crypto.randomUUID();
  const staged: StagedProjectImport = {
    manifest: contents.manifest,
    terrainGlb: contents.terrainGlb,
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

export async function consumeStagedProjectImport(token: string): Promise<ProjectArchiveContents | null> {
  const db = await openImportDb();
  try {
    const transaction = db.transaction(IMPORT_STORE, "readwrite");
    const store = transaction.objectStore(IMPORT_STORE);
    const staged = await requestResult(store.get(token)) as StagedProjectImport | undefined;
    if (staged) store.delete(token);
    await transactionDone(transaction);
    if (!staged) return null;
    return {
      manifest: validateProjectManifest(staged.manifest),
      terrainGlb: staged.terrainGlb,
      customTextures: new Map(staged.customTextures),
    };
  } finally {
    db.close();
  }
}
