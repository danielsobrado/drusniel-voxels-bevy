export interface WorldCenterPoint {
  x: number;
  z: number;
}

export interface WorldCenterDebugInput {
  camera: WorldCenterPoint;
  vegetationRingCenter?: WorldCenterPoint | null;
  vegetationGrassCenter?: WorldCenterPoint | null;
  vegetationTreesCenter?: WorldCenterPoint | null;
  canopyCenter?: WorldCenterPoint | null;
  waterOceanCenter?: WorldCenterPoint | null;
}

export interface WorldCenterDebugStats {
  cameraToVegetationRingCenterM?: number;
  cameraToVegetationGrassCenterM?: number;
  cameraToVegetationTreesCenterM?: number;
  cameraToCanopyCenterM?: number;
  cameraToWaterOceanCenterM?: number;
}

export const WORLD_CENTER_DEBUG_SOURCE_CODE = {
  camera: 1,
  vegetationRing: 2,
  vegetationGrass: 3,
  vegetationTrees: 4,
  canopy: 5,
  waterOcean: 6,
} as const;

export function computeWorldCenterDebugStats(input: WorldCenterDebugInput): WorldCenterDebugStats {
  assertFiniteCenter("camera", input.camera);
  return {
    cameraToVegetationRingCenterM: optionalDistance(input.camera, input.vegetationRingCenter, "vegetationRing"),
    cameraToVegetationGrassCenterM: optionalDistance(input.camera, input.vegetationGrassCenter, "vegetationGrass"),
    cameraToVegetationTreesCenterM: optionalDistance(input.camera, input.vegetationTreesCenter, "vegetationTrees"),
    cameraToCanopyCenterM: optionalDistance(input.camera, input.canopyCenter, "canopy"),
    cameraToWaterOceanCenterM: optionalDistance(input.camera, input.waterOceanCenter, "waterOcean"),
  };
}

export function publishWorldCenterStatsToCounters(
  counters: Record<string, number> | undefined,
  stats: WorldCenterDebugStats,
): void {
  if (!counters) return;
  writeOptional(counters, "camera_to_vegetation_ring_center_m", stats.cameraToVegetationRingCenterM);
  writeOptional(counters, "camera_to_vegetation_grass_center_m", stats.cameraToVegetationGrassCenterM);
  writeOptional(counters, "camera_to_vegetation_trees_center_m", stats.cameraToVegetationTreesCenterM);
  writeOptional(counters, "camera_to_canopy_center_m", stats.cameraToCanopyCenterM);
  writeOptional(counters, "camera_to_water_ocean_center_m", stats.cameraToWaterOceanCenterM);
}

export function centerDistance(camera: WorldCenterPoint, center: WorldCenterPoint): number {
  assertFiniteCenter("camera", camera);
  assertFiniteCenter("center", center);
  return Math.hypot(camera.x - center.x, camera.z - center.z);
}

export function centerWithinThreshold(distanceM: number | undefined, thresholdM: number): boolean {
  return typeof distanceM !== "number" || (Number.isFinite(distanceM) && distanceM <= thresholdM);
}

function optionalDistance(
  camera: WorldCenterPoint,
  center: WorldCenterPoint | null | undefined,
  label: string,
): number | undefined {
  if (!center) return undefined;
  assertFiniteCenter(label, center);
  return centerDistance(camera, center);
}

function assertFiniteCenter(label: string, center: WorldCenterPoint): void {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.z)) {
    throw new Error(`${label} center must be finite`);
  }
}

function writeOptional(counters: Record<string, number>, key: string, value: number | undefined): void {
  if (typeof value === "number" && Number.isFinite(value)) counters[key] = value;
}
