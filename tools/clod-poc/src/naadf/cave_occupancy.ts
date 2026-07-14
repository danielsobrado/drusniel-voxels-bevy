import { density } from "../terrain/terrain_density.js";
import {
  getVoxelOverlaySource,
  voxelOverlayHasResidentBounds,
  voxelOverlayPointIsResident,
} from "../terrain/voxel_overlay/voxel_overlay.js";

export interface CaveOccupancyTraceResult {
  readonly blocked: boolean;
  readonly steps: number;
}

export const CAVE_OCCUPANCY_MAX_STEPS = 64;
const CAVE_OCCUPANCY_STEP_M = 1.5;

export function traceCaveOccupancy(
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistanceM: number,
): CaveOccupancyTraceResult | null {
  const source = getVoxelOverlaySource();
  if (!voxelOverlayHasResidentBounds()) return null;
  const length = Math.hypot(dirX, dirY, dirZ);
  if (length < 1e-10 || maxDistanceM <= 0) return { blocked: false, steps: 0 };
  const dx = dirX / length;
  const dy = dirY / length;
  const dz = dirZ / length;
  const steps = Math.min(CAVE_OCCUPANCY_MAX_STEPS, Math.ceil(maxDistanceM / CAVE_OCCUPANCY_STEP_M));
  for (let step = 1; step <= steps; step++) {
    const distance = Math.min(maxDistanceM, step * CAVE_OCCUPANCY_STEP_M);
    const sx = x + dx * distance;
    const sy = y + dy * distance;
    const sz = z + dz * distance;
    const nearComplexRegion = voxelOverlayPointIsResident(sx, sz) && source.regions.some((region) =>
      sx >= region.bounds.minX && sx <= region.bounds.maxX
      && sy >= region.bounds.minY && sy <= region.bounds.maxY
      && sz >= region.bounds.minZ && sz <= region.bounds.maxZ);
    if (nearComplexRegion && density(sx, sy, sz) > 0) return { blocked: true, steps: step };
  }
  return { blocked: false, steps };
}
