import { sampleTerrainVisibility, type TerrainHeightSample, type TerrainHeightSampler } from "../vegetation/vegetation_visibility_provider.js";

export type TreeTerrainHeightSample = TerrainHeightSample;
export type TreeTerrainOcclusionSampler = TerrainHeightSampler;

export interface TreeTerrainOcclusionSettings {
  enabled: boolean;
  minDistanceM: number;
  sampleCount: number;
  heightMarginM: number;
  canopyHeightM: number;
}

export interface TreeTerrainOcclusionQuery {
  sampler: TreeTerrainOcclusionSampler | undefined;
  settings: TreeTerrainOcclusionSettings;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  targetX: number;
  targetZ: number;
  targetGroundY: number;
  targetRadiusM: number;
}

export const DEFAULT_TREE_TERRAIN_OCCLUSION_SETTINGS: TreeTerrainOcclusionSettings = {
  enabled: true,
  minDistanceM: 96,
  sampleCount: 6,
  heightMarginM: 1.75,
  canopyHeightM: 5.5,
};

export function isTreeClusterTerrainOccluded(query: TreeTerrainOcclusionQuery): boolean {
  return !sampleTerrainVisibility({
    ...query,
    settings: {
      enabled: query.settings.enabled,
      minDistanceM: query.settings.minDistanceM,
      sampleCount: query.settings.sampleCount,
      heightMarginM: query.settings.heightMarginM,
      crownHeightM: query.settings.canopyHeightM,
    },
  }).visible;
}
