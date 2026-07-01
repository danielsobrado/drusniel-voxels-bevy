export interface TreeTerrainHeightSample {
  height: number;
  unknown?: boolean;
}

export interface TreeTerrainOcclusionSampler {
  sampleHeight(x: number, z: number): TreeTerrainHeightSample;
}

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
  const { sampler, settings } = query;
  if (!sampler || !settings.enabled) return false;

  const dx = query.targetX - query.cameraX;
  const dz = query.targetZ - query.cameraZ;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance < Math.max(0, settings.minDistanceM)) return false;

  const sampleCount = Math.max(1, Math.floor(settings.sampleCount));
  const startY = query.cameraY;
  const endY = query.targetGroundY + Math.max(0, settings.canopyHeightM) + Math.max(0, query.targetRadiusM) * 0.05;
  const margin = Math.max(0, settings.heightMarginM);

  for (let i = 1; i <= sampleCount; i++) {
    const t = i / (sampleCount + 1);
    const x = query.cameraX + dx * t;
    const z = query.cameraZ + dz * t;
    const sample = sampler.sampleHeight(x, z);
    if (sample.unknown || !Number.isFinite(sample.height)) return false;
    const lineY = startY + (endY - startY) * t;
    if (sample.height > lineY + margin) return true;
  }

  return false;
}
