import { SAVE_SCHEMA_VERSION } from "../save_config.js";
import type {
  SavedCaveEntrance,
  SavedCaveSystem,
  SavedCity,
  SavedCityDistrict,
  SavedCriticalPath,
  SavedRoad,
  WorldMetadataRecord,
} from "../save_schema.js";
import { assertWorldMetadataLinks, assertWorldMetadataRecord } from "../save_schema.js";

export type {
  CriticalPathPurpose,
  CriticalPathStatus,
  SavedBounds2D,
  SavedBounds3D,
  SavedCaveEntrance,
  SavedCaveSystem,
  SavedCity,
  SavedCityDistrict,
  SavedCriticalPath,
  SavedRoad,
  SavedRoadType,
  WorldMetadataRecord,
} from "../save_schema.js";

export { assertWorldMetadataLinks, assertWorldMetadataRecord };

export function createEmptyWorldMetadataRecord(revision = 0): WorldMetadataRecord {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    cities: [],
    districts: [],
    roads: [],
    caveEntrances: [],
    caveSystems: [],
    criticalPaths: [],
    revision,
  };
}

export interface WorldMetadataCounts {
  cities: number;
  districts: number;
  roads: number;
  caveEntrances: number;
  caveSystems: number;
  criticalPaths: number;
}

export function worldMetadataCounts(metadata: WorldMetadataRecord): WorldMetadataCounts {
  assertWorldMetadataRecord(metadata);
  return {
    cities: metadata.cities.length,
    districts: metadata.districts.length,
    roads: metadata.roads.length,
    caveEntrances: metadata.caveEntrances.length,
    caveSystems: metadata.caveSystems.length,
    criticalPaths: metadata.criticalPaths.length,
  };
}

export type WorldMetadataEntity =
  | SavedCity
  | SavedCityDistrict
  | SavedRoad
  | SavedCaveEntrance
  | SavedCaveSystem
  | SavedCriticalPath;
