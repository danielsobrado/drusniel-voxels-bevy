import { parseRegionKey, regionCoord, regionKeyOf } from "../region_key.js";
import { SAVE_REGION_SIZE_M } from "../save_config.js";
import type {
  SavedBounds2D,
  SavedCaveEntrance,
  SavedCaveSystem,
  SavedCity,
  SavedCityDistrict,
  SavedCriticalPath,
  SavedRoad,
  WorldMetadataRecord,
} from "./metadata_schema.js";
import { assertWorldMetadataRecord, createEmptyWorldMetadataRecord, worldMetadataCounts, type WorldMetadataCounts } from "./metadata_schema.js";

export interface WorldMetadataRegionQueryResult {
  cities: SavedCity[];
  districts: SavedCityDistrict[];
  roads: SavedRoad[];
  caveEntrances: SavedCaveEntrance[];
  caveSystems: SavedCaveSystem[];
  criticalPaths: SavedCriticalPath[];
}

export interface WorldMetadataEntityRegionKeys {
  kind: keyof WorldMetadataRegionQueryResult;
  id: string;
  regionKeys: string[];
}

function cloneMetadata(metadata: WorldMetadataRecord): WorldMetadataRecord {
  return structuredClone(metadata) as WorldMetadataRecord;
}

function cloneBounds(bounds: SavedBounds2D): SavedBounds2D {
  return { minX: bounds.minX, minZ: bounds.minZ, maxX: bounds.maxX, maxZ: bounds.maxZ };
}

function pointBounds(point: readonly [number, number, number], radiusM = 0): SavedBounds2D {
  return {
    minX: point[0] - radiusM,
    minZ: point[2] - radiusM,
    maxX: point[0] + radiusM,
    maxZ: point[2] + radiusM,
  };
}

function pointsBounds(points: readonly [number, number, number][], radiusM = 0): SavedBounds2D {
  if (points.length === 0) throw new Error("metadata path points must not be empty");
  let bounds = pointBounds(points[0]!, radiusM);
  for (const point of points.slice(1)) bounds = mergeBounds(bounds, pointBounds(point, radiusM));
  return bounds;
}

function mergeBounds(a: SavedBounds2D, b: SavedBounds2D): SavedBounds2D {
  return {
    minX: Math.min(a.minX, b.minX),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function axisOverlapsHalfOpenRegion(min: number, max: number, regionMin: number, regionMax: number): boolean {
  return min === max ? min >= regionMin && min < regionMax : min < regionMax && max > regionMin;
}

function boundsOverlapHalfOpenRegion(bounds: SavedBounds2D, regionBounds: SavedBounds2D): boolean {
  return axisOverlapsHalfOpenRegion(bounds.minX, bounds.maxX, regionBounds.minX, regionBounds.maxX)
    && axisOverlapsHalfOpenRegion(bounds.minZ, bounds.maxZ, regionBounds.minZ, regionBounds.maxZ);
}

function assertFiniteBoundsCoordinate(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`metadata bounds ${label} must be finite`);
}

function isExactRegionBoundary(value: number): boolean {
  return Number.isInteger(value / SAVE_REGION_SIZE_M);
}

function maxRegionCoordForHalfOpenBounds(min: number, max: number): number {
  if (min === max) return regionCoord(max);
  return isExactRegionBoundary(max) ? regionCoord(max) - 1 : regionCoord(max);
}

export function boundsForRegion(regionKey: string): SavedBounds2D {
  const { rx, rz } = parseRegionKey(regionKey);
  return {
    minX: rx * SAVE_REGION_SIZE_M,
    minZ: rz * SAVE_REGION_SIZE_M,
    maxX: (rx + 1) * SAVE_REGION_SIZE_M,
    maxZ: (rz + 1) * SAVE_REGION_SIZE_M,
  };
}

export function regionKeysForBounds(bounds: SavedBounds2D): string[] {
  for (const key of ["minX", "minZ", "maxX", "maxZ"] as const) assertFiniteBoundsCoordinate(bounds[key], key);
  if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) throw new Error("metadata bounds min must be <= max");
  const minRx = regionCoord(bounds.minX);
  const maxRx = maxRegionCoordForHalfOpenBounds(bounds.minX, bounds.maxX);
  const minRz = regionCoord(bounds.minZ);
  const maxRz = maxRegionCoordForHalfOpenBounds(bounds.minZ, bounds.maxZ);
  const keys: string[] = [];
  for (let rx = minRx; rx <= maxRx; rx++) {
    for (let rz = minRz; rz <= maxRz; rz++) keys.push(regionKeyOf(rx, rz));
  }
  return keys.sort();
}

export function cityBounds(city: SavedCity): SavedBounds2D {
  return pointBounds(city.center, city.radiusM);
}

export function districtBounds(district: SavedCityDistrict): SavedBounds2D {
  return cloneBounds(district.bounds);
}

export function roadBounds(road: SavedRoad): SavedBounds2D {
  return pointsBounds(road.points, road.widthM * 0.5);
}

export function caveEntranceBounds(entrance: SavedCaveEntrance): SavedBounds2D {
  return pointBounds(entrance.position, entrance.farMaskRadiusM);
}

export function criticalPathBounds(path: SavedCriticalPath): SavedBounds2D {
  return pointsBounds(path.points);
}

function emptyQueryResult(): WorldMetadataRegionQueryResult {
  return { cities: [], districts: [], roads: [], caveEntrances: [], caveSystems: [], criticalPaths: [] };
}

function ids<T extends { id: string }>(items: readonly T[]): Set<string> {
  return new Set(items.map((item) => item.id));
}

export class WorldMetadataStore {
  private metadataValue: WorldMetadataRecord;
  private dirtyValue = false;

  constructor(metadata: WorldMetadataRecord = createEmptyWorldMetadataRecord()) {
    assertWorldMetadataRecord(metadata);
    this.metadataValue = cloneMetadata(metadata);
  }

  set(metadata: WorldMetadataRecord, dirty = true): void {
    assertWorldMetadataRecord(metadata);
    this.metadataValue = cloneMetadata(metadata);
    this.dirtyValue = dirty;
  }

  get(): WorldMetadataRecord {
    return cloneMetadata(this.metadataValue);
  }

  isDirty(): boolean {
    return this.dirtyValue;
  }

  markDirty(): void {
    this.dirtyValue = true;
  }

  clearDirty(): void {
    this.dirtyValue = false;
  }

  counts(): WorldMetadataCounts {
    return worldMetadataCounts(this.metadataValue);
  }

  cityById(id: string): SavedCity | null {
    return structuredClone(this.metadataValue.cities.find((city) => city.id === id) ?? null) as SavedCity | null;
  }

  roadById(id: string): SavedRoad | null {
    return structuredClone(this.metadataValue.roads.find((road) => road.id === id) ?? null) as SavedRoad | null;
  }

  caveSystemById(id: string): SavedCaveSystem | null {
    return structuredClone(this.metadataValue.caveSystems.find((system) => system.id === id) ?? null) as SavedCaveSystem | null;
  }

  criticalPathById(id: string): SavedCriticalPath | null {
    return structuredClone(this.metadataValue.criticalPaths.find((path) => path.id === id) ?? null) as SavedCriticalPath | null;
  }

  entityRegionKeys(): WorldMetadataEntityRegionKeys[] {
    const metadata = this.metadataValue;
    const rows: WorldMetadataEntityRegionKeys[] = [];
    for (const city of metadata.cities) rows.push({ kind: "cities", id: city.id, regionKeys: regionKeysForBounds(cityBounds(city)) });
    for (const district of metadata.districts) rows.push({ kind: "districts", id: district.id, regionKeys: regionKeysForBounds(districtBounds(district)) });
    for (const road of metadata.roads) rows.push({ kind: "roads", id: road.id, regionKeys: regionKeysForBounds(roadBounds(road)) });
    for (const entrance of metadata.caveEntrances) rows.push({ kind: "caveEntrances", id: entrance.id, regionKeys: regionKeysForBounds(caveEntranceBounds(entrance)) });
    for (const path of metadata.criticalPaths) rows.push({ kind: "criticalPaths", id: path.id, regionKeys: regionKeysForBounds(criticalPathBounds(path)) });
    for (const system of metadata.caveSystems) rows.push({ kind: "caveSystems", id: system.id, regionKeys: this.caveSystemRegionKeys(system.id) });
    return rows.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  }

  queryRegion(regionKey: string): WorldMetadataRegionQueryResult {
    const regionBounds = boundsForRegion(regionKey);
    const result = emptyQueryResult();
    const matchingCaveSystemIds = new Set<string>();
    const entranceIds = ids(this.metadataValue.caveEntrances.filter((entrance) => boundsOverlapHalfOpenRegion(caveEntranceBounds(entrance), regionBounds)));
    const criticalPathIds = ids(this.metadataValue.criticalPaths.filter((path) => boundsOverlapHalfOpenRegion(criticalPathBounds(path), regionBounds)));

    result.cities = this.metadataValue.cities.filter((city) => boundsOverlapHalfOpenRegion(cityBounds(city), regionBounds));
    result.districts = this.metadataValue.districts.filter((district) => boundsOverlapHalfOpenRegion(districtBounds(district), regionBounds));
    result.roads = this.metadataValue.roads.filter((road) => boundsOverlapHalfOpenRegion(roadBounds(road), regionBounds));
    result.caveEntrances = this.metadataValue.caveEntrances.filter((entrance) => entranceIds.has(entrance.id));
    result.criticalPaths = this.metadataValue.criticalPaths.filter((path) => criticalPathIds.has(path.id));

    for (const system of this.metadataValue.caveSystems) {
      if (system.entranceIds.some((id) => entranceIds.has(id)) || system.criticalPathIds.some((id) => criticalPathIds.has(id))) matchingCaveSystemIds.add(system.id);
    }
    result.caveSystems = this.metadataValue.caveSystems.filter((system) => matchingCaveSystemIds.has(system.id));
    return structuredClone(result) as WorldMetadataRegionQueryResult;
  }

  caveSystemRegionKeys(caveSystemId: string): string[] {
    const system = this.metadataValue.caveSystems.find((candidate) => candidate.id === caveSystemId);
    if (!system) throw new Error(`cave system not found: ${caveSystemId}`);
    const keys = new Set<string>();
    for (const entrance of this.metadataValue.caveEntrances.filter((candidate) => system.entranceIds.includes(candidate.id))) {
      regionKeysForBounds(caveEntranceBounds(entrance)).forEach((key) => keys.add(key));
    }
    for (const path of this.metadataValue.criticalPaths.filter((candidate) => system.criticalPathIds.includes(candidate.id))) {
      regionKeysForBounds(criticalPathBounds(path)).forEach((key) => keys.add(key));
    }
    return [...keys].sort();
  }
}
