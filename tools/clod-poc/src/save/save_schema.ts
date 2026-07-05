import type { ProjectPropInstance } from "../project/project_props.js";
import type { VoxelDelta } from "../terrain/voxel_edits/voxel_edit_types.js";
import { SAVE_CHUNK_SIZE_M, SAVE_PROCEDURAL_PROFILE, SAVE_REGION_SIZE_M, SAVE_SCHEMA_VERSION } from "./save_config.js";
import { parseRegionKey, regionKeyForWorld } from "./region_key.js";
import { decodeVoxelDeltasBin1, type VoxelDeltaBinaryPayload } from "./voxel_delta_binary.js";

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

export interface JsonRegionVoxelDeltas {
  schemaVersion: SaveSchemaVersion;
  regionKey: string;
  format: "json";
  deltas: VoxelDelta[];
}

export interface BinaryRegionVoxelDeltas {
  schemaVersion: SaveSchemaVersion;
  regionKey: string;
  format: "bin1";
  payload: VoxelDeltaBinaryPayload;
}

export type RegionVoxelDeltas = JsonRegionVoxelDeltas | BinaryRegionVoxelDeltas;

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

const OPTIONAL_SAVED_PROP_SAFE_INTEGER_FIELDS = ["seed", "variationId", "flags", "revision"] as const;
const OPTIONAL_SAVED_PROP_STRING_FIELDS = ["cityId", "roadId", "criticalPathId", "ownerFactionId"] as const;

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
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (!isFiniteNumber(value)) throw new Error(`${label} must be finite`);
}

function assertNonNegativeFinite(value: unknown, label: string): asserts value is number {
  assertFinite(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative`);
}

function assertStringList(value: unknown, label: string): asserts value is string[] {
  if (!isStringArray(value)) throw new Error(`${label} must be a string array`);
}

function assertOptionalSafeIntegerFields(value: RecordValue, fields: readonly string[], label: string): void {
  for (const field of fields) {
    if (value[field] !== undefined && !isSafeInteger(value[field])) throw new Error(`${label} ${field} must be a safe integer`);
  }
}

function assertOptionalNonEmptyStringFields(value: RecordValue, fields: readonly string[], label: string): void {
  for (const field of fields) {
    if (value[field] !== undefined) assertString(value[field], `${label} ${field}`);
  }
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

function assertNonEmptyVec3List(value: unknown, label: string): void {
  const items = requireArray(value, label);
  if (items.length === 0) throw new Error(`${label} must not be empty`);
  items.forEach((item, index) => assertVec3(item, `${label}[${index}]`));
}

function assertBounds2D(value: unknown, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  for (const key of ["minX", "minZ", "maxX", "maxZ"] as const) assertFinite(value[key], `${label}.${key}`);
  const { minX, minZ, maxX, maxZ } = value as Record<string, number>;
  if (minX > maxX || minZ > maxZ) throw new Error(`${label} min must be <= max`);
}

function assertUniqueIds(items: readonly { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`duplicate ${label} id: ${item.id}`);
    seen.add(item.id);
  }
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
  if (value.format === "json") {
    requireArray(value.deltas, "region voxel deltas deltas").forEach((delta, index) => assertVoxelDelta(delta, `region voxel deltas[${index}]`));
    return;
  }
  if (value.format === "bin1") {
    decodeVoxelDeltasBin1(value.payload as VoxelDeltaBinaryPayload).forEach((delta, index) => assertVoxelDelta(delta, `region voxel deltas bin1[${index}]`));
    return;
  }
  throw new Error("region voxel deltas format is unsupported");
}

export function assertSavedPropInstance(value: unknown): asserts value is SavedPropInstance {
  if (!isRecord(value)) throw new Error("saved prop must be an object");
  assertString(value.id, "saved prop id");
  assertString(value.prefabId, "saved prop prefabId");
  assertVec3(value.position, "saved prop position");
  if (!isVec4(value.rotation)) throw new Error("saved prop rotation must be a vec4");
  assertVec3(value.scale, "saved prop scale");
  if (value.scale.some((scale) => scale <= 0)) throw new Error("saved prop scale must be positive");
  if (value.anchor !== undefined && value.anchor !== "world" && value.anchor !== "terrain" && value.anchor !== "voxel") throw new Error("saved prop anchor is invalid");
  assertOptionalSafeIntegerFields(value, OPTIONAL_SAVED_PROP_SAFE_INTEGER_FIELDS, "saved prop");
  assertOptionalNonEmptyStringFields(value, OPTIONAL_SAVED_PROP_STRING_FIELDS, "saved prop");
  assertString(value.regionKey, "saved prop regionKey");
  parseRegionKey(value.regionKey);
  if (value.state !== "active" && value.state !== "hidden" && value.state !== "destroyed") throw new Error("saved prop state is invalid");
  assertStringList(value.tags, "saved prop tags");
}

export function assertRegionRecordSet(manifest: RegionManifest, voxelDeltas: RegionVoxelDeltas, props: readonly SavedPropInstance[]): void {
  if (voxelDeltas.regionKey !== manifest.regionKey) throw new Error("region voxel record key mismatch");
  if (regionVoxelDeltasToDeltas(voxelDeltas).length !== manifest.voxelDeltaCount) throw new Error("region voxel delta count mismatch");
  if (props.length !== manifest.propCount) throw new Error("region prop count mismatch");
  props.forEach((prop) => {
    assertSavedPropInstance(prop);
    if (prop.regionKey !== manifest.regionKey) throw new Error("saved prop regionKey mismatch");
    const positionRegionKey = regionKeyForWorld(prop.position[0], prop.position[2]);
    if (positionRegionKey !== manifest.regionKey) {
      throw new Error(`saved prop position region mismatch: ${prop.id} belongs to ${positionRegionKey}, not ${manifest.regionKey}`);
    }
  });
  assertUniqueIds(props, `region ${manifest.regionKey} prop`);
}

export function regionVoxelDeltasToDeltas(voxelDeltas: RegionVoxelDeltas): VoxelDelta[] {
  if (voxelDeltas.format === "json") return voxelDeltas.deltas.map((delta) => ({ ...delta }));
  return decodeVoxelDeltasBin1(voxelDeltas.payload).map((delta) => ({ ...delta }));
}

function requireLinked(id: string, ids: ReadonlySet<string>, label: string): void {
  if (!ids.has(id)) throw new Error(`dangling ${label} link: ${id}`);
}

function assertCity(value: unknown): asserts value is SavedCity {
  if (!isRecord(value)) throw new Error("city must be an object");
  assertString(value.id, "city id");
  assertString(value.name, "city name");
  assertVec3(value.center, "city center");
  assertNonNegativeFinite(value.radiusM, "city radiusM");
  assertStringList(value.districtIds, "city districtIds");
  assertStringList(value.roadIds, "city roadIds");
  assertStringList(value.criticalPathIds, "city criticalPathIds");
  if (!isSafeInteger(value.revision)) throw new Error("city revision must be a safe integer");
}

function assertDistrict(value: unknown): asserts value is SavedCityDistrict {
  if (!isRecord(value)) throw new Error("district must be an object");
  assertString(value.id, "district id");
  assertString(value.cityId, "district cityId");
  assertString(value.name, "district name");
  assertBounds2D(value.bounds, "district bounds");
  assertStringList(value.tags, "district tags");
}

function assertRoad(value: unknown): asserts value is SavedRoad {
  if (!isRecord(value)) throw new Error("road must be an object");
  assertString(value.id, "road id");
  assertNonEmptyVec3List(value.points, "road points");
  assertNonNegativeFinite(value.widthM, "road widthM");
  if (!isSafeInteger(value.materialId)) throw new Error("road materialId must be a safe integer");
  if (!["dirt", "stone", "bridge", "city", "trail"].includes(String(value.roadType))) throw new Error("road roadType is invalid");
  assertStringList(value.connectedCityIds, "road connectedCityIds");
  if (!isSafeInteger(value.revision)) throw new Error("road revision must be a safe integer");
}

function assertCaveEntrance(value: unknown): asserts value is SavedCaveEntrance {
  if (!isRecord(value)) throw new Error("cave entrance must be an object");
  assertString(value.id, "cave entrance id");
  assertVec3(value.position, "cave entrance position");
  assertVec3(value.facing, "cave entrance facing");
  assertString(value.caveSystemId, "cave entrance caveSystemId");
  assertNonNegativeFinite(value.farMaskRadiusM, "cave entrance farMaskRadiusM");
  if (!isSafeInteger(value.revision)) throw new Error("cave entrance revision must be a safe integer");
}

function assertCaveSystem(value: unknown): asserts value is SavedCaveSystem {
  if (!isRecord(value)) throw new Error("cave system must be an object");
  assertString(value.id, "cave system id");
  assertStringList(value.entranceIds, "cave system entranceIds");
  if (!isSafeInteger(value.proceduralSeed)) throw new Error("cave system proceduralSeed must be a safe integer");
  if (typeof value.authored !== "boolean") throw new Error("cave system authored must be boolean");
  assertStringList(value.criticalPathIds, "cave system criticalPathIds");
  if (!isSafeInteger(value.revision)) throw new Error("cave system revision must be a safe integer");
}

function assertCriticalPath(value: unknown): asserts value is SavedCriticalPath {
  if (!isRecord(value)) throw new Error("critical path must be an object");
  assertString(value.id, "critical path id");
  assertString(value.name, "critical path name");
  if (!["mainQuest", "cityAccess", "dungeonAccess", "bossRoute", "tutorial"].includes(String(value.purpose))) throw new Error("critical path purpose is invalid");
  assertNonEmptyVec3List(value.points, "critical path points");
  assertStringList(value.linkedRoadIds, "critical path linkedRoadIds");
  assertStringList(value.linkedPropIds, "critical path linkedPropIds");
  if (typeof value.mustRemainPassable !== "boolean") throw new Error("critical path mustRemainPassable must be boolean");
  if (!["valid", "warning", "blocked", "dirty"].includes(String(value.status))) throw new Error("critical path status is invalid");
  if (!isSafeInteger(value.revision)) throw new Error("critical path revision must be a safe integer");
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
  metadata.criticalPaths.forEach((path) => path.linkedRoadIds.forEach((id) => requireLinked(id, roadIds, "road")));
}

export function assertWorldMetadataPropLinks(metadata: WorldMetadataRecord, propIds: ReadonlySet<string>): void {
  metadata.criticalPaths.forEach((path) => path.linkedPropIds.forEach((id) => requireLinked(id, propIds, "prop")));
}

export function assertWorldMetadataRecord(value: unknown): asserts value is WorldMetadataRecord {
  if (!isRecord(value)) throw new Error("world metadata must be an object");
  assertSchemaVersion(value.schemaVersion, "world metadata");
  const cities = requireArray(value.cities, "world metadata cities");
  const districts = requireArray(value.districts, "world metadata districts");
  const roads = requireArray(value.roads, "world metadata roads");
  const caveEntrances = requireArray(value.caveEntrances, "world metadata caveEntrances");
  const caveSystems = requireArray(value.caveSystems, "world metadata caveSystems");
  const criticalPaths = requireArray(value.criticalPaths, "world metadata criticalPaths");
  cities.forEach(assertCity);
  districts.forEach(assertDistrict);
  roads.forEach(assertRoad);
  caveEntrances.forEach(assertCaveEntrance);
  caveSystems.forEach(assertCaveSystem);
  criticalPaths.forEach(assertCriticalPath);
  if (!isSafeInteger(value.revision)) throw new Error("world metadata revision must be a safe integer");
  assertUniqueIds(cities as SavedCity[], "city");
  assertUniqueIds(districts as SavedCityDistrict[], "district");
  assertUniqueIds(roads as SavedRoad[], "road");
  assertUniqueIds(caveEntrances as SavedCaveEntrance[], "cave entrance");
  assertUniqueIds(caveSystems as SavedCaveSystem[], "cave system");
  assertUniqueIds(criticalPaths as SavedCriticalPath[], "critical path");
  assertWorldMetadataLinks(value as unknown as WorldMetadataRecord);
}
