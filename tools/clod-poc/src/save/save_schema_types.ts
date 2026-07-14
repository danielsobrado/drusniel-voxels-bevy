import type { ProjectPropInstance } from "../project/project_props.js";
import type { VoxelDelta } from "../terrain/voxel_edits/voxel_edit_types.js";
import type { WorldManifest } from "../world/world_manifest.js";
import type { EnvironmentalPropLayer } from "../world/prop_identity.js";

export type SaveSchemaVersion = 1 | 2;
export type SaveProceduralProfile = "infinite-islands-v1" | "continent-v1";
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
  worldManifest?: WorldManifest;
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
  format: "json";
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
  environmental?: { tileKey: { x: number; z: number }; layer: EnvironmentalPropLayer; candidateIndex: number };
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
