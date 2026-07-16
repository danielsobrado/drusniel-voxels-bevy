import * as THREE from "three";
import type { ConstructionPlacementConfig } from "./types.js";
import type { TerrainHitPoint } from "./placement.js";

const RAYCAST_REFINE_STEPS = 12;

export interface ConstructionTerrainRaycastInput {
  ray: THREE.Ray;
  worldCells: number;
  placement: ConstructionPlacementConfig;
  surfaceHeightAt: (x: number, z: number) => number;
}

export function isConstructionPointInWorld(
  x: number,
  z: number,
  worldCells: number,
  unboundedWorld: boolean,
): boolean {
  return unboundedWorld || (x >= 0 && x <= worldCells && z >= 0 && z <= worldCells);
}

export function raycastConstructionTerrain(input: ConstructionTerrainRaycastInput): TerrainHitPoint | null {
  const maxDistance = input.placement.maxRayDistanceM;
  const step = input.placement.terrainStepM;
  const scratch = new THREE.Vector3();
  const unboundedWorld = input.placement.unboundedWorld === true;
  let previousT: number | null = null;
  let previousSigned = 0;

  for (let t = 0; t <= maxDistance; t += step) {
    input.ray.at(t, scratch);
    if (!isConstructionPointInWorld(scratch.x, scratch.z, input.worldCells, unboundedWorld)) {
      previousT = null;
      continue;
    }
    const signed = scratch.y - input.surfaceHeightAt(scratch.x, scratch.z);
    if (previousT !== null && previousSigned >= 0 && signed <= 0) {
      let lo = previousT;
      let hi = t;
      for (let i = 0; i < RAYCAST_REFINE_STEPS; i += 1) {
        const mid = (lo + hi) * 0.5;
        input.ray.at(mid, scratch);
        if (!isConstructionPointInWorld(scratch.x, scratch.z, input.worldCells, unboundedWorld)) {
          lo = mid;
          continue;
        }
        const midSigned = scratch.y - input.surfaceHeightAt(scratch.x, scratch.z);
        if (midSigned > 0) lo = mid;
        else hi = mid;
      }
      input.ray.at(hi, scratch);
      return { point: [scratch.x, scratch.y, scratch.z], distanceM: hi };
    }
    previousT = t;
    previousSigned = signed;
  }
  return null;
}
