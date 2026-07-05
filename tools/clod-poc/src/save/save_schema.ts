import type { ProjectPropInstance } from "../project/project_props.js";
import type { VoxelDelta } from "../terrain/voxel_edits/voxel_edit_types.js";
import { SAVE_CHUNK_SIZE_M, SAVE_PROCEDURAL_PROFILE, SAVE_REGION_SIZE_M, SAVE_SCHEMA_VERSION } from "./save_config.js";
import { parseRegionKey } from "./region_key.js";

export type SaveSchemaVersion = 1;
export type SaveProceduralProfile = "infinite-islands-v1";
export type SavedPropState = "active" | "hidden" | "destroyed";
export type CriticalPathPurpose = "mainQuest" | "cityAccess" | "dungeonAccess" | "bossRoute" | "tutorial";
export type CriticalPathStatus = "valid" | "warning" | "blocked" | "dirty";
export type SavedRoadType = "dirt" | "stone" | "bridge" | "city" | "trail";

export interface SaveWorldManifest {
  schemaVersion: SaveSchemaVersion;
  saveId: string;
  worldId: string;
  seed: number;
  proceduralProfile: SaveProceduralProfile;
  regionSizeM: 512;
  chunkSizeM: 16;
  regionKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RegionManifest {
  schemaVersion: SaveSchemaVersion;
  regionKey: string;
  rx: number;
  rz: number;
  revision: number;
  authorityRevision: number;
  voxelDeltaCount: number;
  propCount: number;
  updatedAt: string;
}

export interface RegionVoxelDeltas {
  schemaVersion: SaveSchemaVersion;
  regionKey: string;
  format: "json" | "bin1";
  deltas: VoxelDelta[];
}

export interface SavedPropInstance extends ProjectPropInstance {
  regionKey: string;
  state: SavedPropState;
  tags: string[];
  cityId?: string;
  roadId?: string;
  criticalPathId?: string;
  ownerFactionId?: string;
}

export interface SavedBounds2D { minX: number; minZ: number; maxX: number; maxZ: number }
export interface SavedBounds3D extends SavedBounds2D { minY: number; maxY: number }
export interface SavedCity { id: string; name: string; center: [number, number, number]; radiusM: number; districtIds: string[]; roadIds: string[]; criticalPathIds: string[]; factionId?: string; revision: number }
export interface SavedCityDistrict { id: string; cityId: string; name: string; bounds: SavedBounds2D; tags: string[] }
export interface SavedRoad { id: string; name?: string; points: Array<[number, number, number]>; widthM: number; materialId: number; roadType: SavedRoadType; connectedCityIds: string[]; criticalPathId?: string; revision: number }
export interface SavedCaveEntrance { id: string; position: [number, number, number]; facing: [number, number, number]; caveSystemId: string; linkedCriticalPathId?: string; farMaskRadiusM: number; revision: number }
export interface SavedCaveSystem { id: string; entranceIds: string[]; proceduralSeed: number; authored: boolean; criticalPathIds: string[]; revision: number }
export interface SavedCriticalPath { id: string; name: string; purpose: CriticalPathPurpose; points: Array<[number, number, number]>; linkedRoadIds: string[]; linkedPropIds: string[]; mustRemainPassable: boolean; status: CriticalPathStatus; revision: number }
export interface WorldMetadataRecord { schemaVersion: SaveSchemaVersion; cities: SavedCity[]; districts: SavedCityDistrict[]; roads: SavedRoad[]; caveEntrances: SavedCaveEntrance[]; caveSystems: SavedCaveSystem[]; criticalPaths: SavedCriticalPath[]; revision: number }

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isVec4(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber);
}

function assertSchemaVersion(value: unknown, label: string): void {
  if (value !== SAVE_SCHEMA_VERSION) throw new Error(`${label} has unsupported schemaVersion`);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (!isFiniteNumber(value)) throw new Error(`${label} must be finite`);
}

function assertStringList(value: unknown, label: string): asserts value is string[] {
  if (!isStringArray(value)) throw new Error(`${label} must be a string array`);
}

function assertIso(value: unknown, label: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be ISO-8601`);
}

function assertVec3(value: unknown, label: string): asserts value is [number, number, number] {
  if (!isVec3(value)) throw new Error(`${label} must be a vec3`);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export function assertSaveWorldManifest(value: unknown): asserts value is SaveWorldManifest {
  if (!isRecord(value)) throw new Error("save manifest must be an object");
  assertSchemaVersion(value.schemaVersion, "save manifest");
  assertString(value.saveId, "save manifest saveId");
  assertString(value.worldId, "save manifest worldId");
  assertFinite(value.seed, "save manifest seed");
  if (value.proceduralProfile !== SAVE_PROCEDURAL_PROFILE) throw new Error("save manifest proceduralProfile is unsupported");
  if (value.regionSizeM !== SAVE_REGION_SIZE_M) throw new Error("save manifest regionSizeM mismatch");
  if (value.chunkSizeM !== SAVE_CHUNK_SIZE_M) throw new Error("save manifest chunkSizeM mismatch");
  assertStringList(value.regionKeys, "save manifest regionKeys");
  value.regionKeys.forEach(parseRegionKey);
  assertIso(value.createdAt, "save manifest createdAt");
  assertIso(value.updatedAt, "save manifest updatedAt");
}

export function assertRegionManifest(value: unknown): asserts value is RegionManifest {
  if (!isRecord(value)) throw new Error("region manifest must be an object");
  assertSchemaVersion(value.schemaVersion, "region manifest");
  assertString(value.regionKey, "region manifest regionKey");
  const parsed = parseRegionKey(value.regionKey);
  if (value.rx !== parsed.rx || value.rz !== parsed.rz) throw new Error("region manifest key coordinate mismatch");
  for (const key of ["revision", "authorityRevision", "voxelDeltaCount", "propCount"] as const) {
    if (!isSafeInteger(value[key]) || value[key] < 0) throw new Error(`region manifest ${key} must be a non-negative integer`);
  }
  assertIso(value.updatedAt, "region manifest updatedAt");
}

export function assertVoxelDelta(value: unknown, label = "voxel delta"): asserts value is VoxelDelta {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  for (const key of ["x", "y", "z", "revision"] as const) if (!isSafeInteger(value[key])) throw new Error(`${label}.${key} must be a safe integer`);
  assertFinite(value.density, `${label}.density`);
  if (value.materialSlot !== undefined && !isSafeInteger(value.materialSlot)) throw new Error(`${label}.materialSlot must be a safe integer`);
}

export function assertRegionVoxelDeltas(value: unknown): asserts value is RegionVoxelDeltas {
  if (!isRecord(value)) throw new Error("region voxel deltas must be an object");
  assertSchemaVersion(value.schemaVersion, "region voxel deltas");
  assertString(value.regionKey, "region voxel deltas regionKey");
  parseRegionKey(value.regionKey);
  if (value.format !== "json" && value.format !== "bin1") throw new Error("region voxel deltas format is unsupported");
  requireArray(value.deltas, "region voxel deltas deltas").forEach((delta, index) => assertVoxelDelta(delta, `region voxel deltas[${index}]`));
}

export function assertSavedPropInstance(value: unknown): asserts value is SavedPropInstance {
  if (!isRecord(value)) throw new Error("saved prop must be an object");
  assertString(value.id, "saved prop id");
  assertString(value.prefabId, "saved prop prefabId");
  assertVec3(value.position, "saved prop position");
  if (!isVec4(value.rotation)) throw new Error("saved prop rotation must be a vec4");
  assertVec3(value.scale, "saved prop scale");
  if (value.anchor !== undefined && value.anchor !== "world" && value.anchor !== "terrain" && value.anchor !== "voxel") throw new Error("saved prop anchor is invalid");
  assertString(value.regionKey, "saved prop regionKey");
  parseRegionKey(value.regionKey);
  if (value.state !== "active" && value.state !== "hidden" && value.state !== "destroyed") throw new Error("saved prop state is invalid");
  assertStringList(value.tags, "saved prop tags");
}

export function assertRegionRecordSet(manifest: RegionManifest, voxelDeltas: RegionVoxelDeltas, props: readonly SavedPropInstance[]): void {
  if (voxelDeltas.regionKey !== manifest.regionKey) throw new Error("region voxel record key mismatch");
  if (voxelDeltas.deltas.length !== manifest.voxelDeltaCount) throw new Error("region voxel delta count mismatch");
  if (props.length !== manifest.propCount) throw new Error("region prop count mismatch");
  props.forEach((prop) => {
    assertSavedPropInstance(prop);
    if (prop.regionKey !== manifest.regionKey) throw new Error("saved prop regionKey mismatch");
  });
}

function requireLinked(id: string, ids: ReadonlySet<string>, label: string): void {
  if (!ids.has(id)) throw new Error(`dangling ${label} link: ${id}`);
}

export function assertWorldMetadataLinks(metadata: WorldMetadataRecord): void {
  const cityIds = new Set(metadata.cities.map((city) => city.id));
  const districtIds = new Set(metadata.districts.map((district) => district.id));
  const roadIds = new Set(metadata.roads.map((road) => road.id));
  const caveEntranceIds = new Set(metadata.caveEntrances.map((entrance) => entrance.id));
  const caveSystemIds = new Set(metadata.caveSystems.map((system) => system.id));
  const criticalPathIds = new Set(metadata.criticalPaths.map((path) => path.id));

  metadata.districts.forEach((district) => requireLinked(district.cityId, cityIds, "city"));
  metadata.cities.forEach((city) => {
    city.districtIds.forEach((id) => requireLinked(id, districtIds, "district"));
    city.roadIds.forEach((id) => requireLinked(id, roadIds, "road"));
    city.criticalPathIds.forEach((id) => requireLinked(id, criticalPathIds, "critical path"));
  });
  metadata.roads.forEach((road) => {
    road.connectedCityIds.forEach((id) => requireLinked(id, cityIds, "city"));
    if (road.criticalPathId) requireLinked(road.criticalPathId, criticalPathIds, "critical path");
  });
  metadata.caveSystems.forEach((system) => {
    system.entranceIds.forEach((id) => requireLinked(id, caveEntranceIds, "cave entrance"));
    system.criticalPathIds.forEach((id) => requireLinked(id, criticalPathIds, "critical path"));
  });
  metadata.caveEntrances.forEach((entrance) => {
    requireLinked(entrance.caveSystemId, caveSystemIds, "cave system");
    if (entrance.linkedCriticalPathId) requireLinked(entrance.linkedCriticalPathId, criticalPathIds, "critical path");
  });
}

export function assertWorldMetadataRecord(value: unknown): asserts value is WorldMetadataRecord {
  if (!isRecord(value)) throw new Error("world metadata must be an object");
  assertSchemaVersion(value.schemaVersion, "world metadata");
  for (const key of ["cities", "districts", "roads", "caveEntrances", "caveSystems", "criticalPaths"] as const) requireArray(value[key], `world metadata ${key}`);
  if (!isSafeInteger(value.revision)) throw new Error("world metadata revision must be a safe integer");
  assertWorldMetadataLinks(value as unknown as WorldMetadataRecord);
}
