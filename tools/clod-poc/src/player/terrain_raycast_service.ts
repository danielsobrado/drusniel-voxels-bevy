import * as THREE from "three";
import type { TerrainColliderSet, TerrainSurfaceHit } from "../terrain/terrain_collider.js";
import { setActiveTerrainRaycastService } from "./terrain_raycast_registry.js";

export interface TerrainRaycastServiceDeps {
  terrainColliders: TerrainColliderSet;
  surfaceHeight: (x: number, z: number) => number;
  worldCells: number;
  allowOutOfWorld?: boolean;
  getMode?: () => string;
}

export interface TerrainRaycastService {
  raycastTerrainHeightfield(ray: THREE.Ray): TerrainSurfaceHit | null;
  raycastAuthoritativeTerrain(ray: THREE.Ray, maxDistance?: number): TerrainSurfaceHit | null;
  raycastEditableTerrain(ray: THREE.Ray, maxDistance?: number): TerrainSurfaceHit | null;
}

export function createTerrainRaycastService(deps: TerrainRaycastServiceDeps): TerrainRaycastService {
  const samplePoint = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();

  const raycastTerrainHeightfieldWithin = (
    ray: THREE.Ray,
    maxDistance: number,
  ): TerrainSurfaceHit | null => {
    const step = 2;
    let previousT = 0;
    ray.at(previousT, samplePoint);
    const previousInWorld = deps.allowOutOfWorld === true || samplePoint.x >= 0
      && samplePoint.x <= deps.worldCells
      && samplePoint.z >= 0
      && samplePoint.z <= deps.worldCells;
    let previousSigned = previousInWorld
      ? samplePoint.y - deps.surfaceHeight(samplePoint.x, samplePoint.z)
      : Number.POSITIVE_INFINITY;

    for (let t = step; t <= maxDistance; t += step) {
      ray.at(t, samplePoint);
      const inWorld = deps.allowOutOfWorld === true || samplePoint.x >= 0
        && samplePoint.x <= deps.worldCells
        && samplePoint.z >= 0
        && samplePoint.z <= deps.worldCells;
      const signed = inWorld
        ? samplePoint.y - deps.surfaceHeight(samplePoint.x, samplePoint.z)
        : Number.POSITIVE_INFINITY;
      if (inWorld && previousSigned >= 0 && signed <= 0) {
        let lo = previousT;
        let hi = t;
        for (let i = 0; i < 12; i += 1) {
          const midT = (lo + hi) * 0.5;
          ray.at(midT, hitPoint);
          const midSigned = hitPoint.y - deps.surfaceHeight(hitPoint.x, hitPoint.z);
          if (midSigned > 0) lo = midT;
          else hi = midT;
        }
        ray.at(hi, hitPoint);
        return { point: hitPoint.clone(), distance: hi, pageId: "heightfield" };
      }
      previousT = t;
      previousSigned = signed;
    }
    return null;
  };

  const raycastTerrainHeightfield = (ray: THREE.Ray): TerrainSurfaceHit | null =>
    raycastTerrainHeightfieldWithin(ray, Math.max(8000, deps.worldCells * 8));

  const raycastAuthoritativeTerrain = (
    ray: THREE.Ray,
    maxDistance = Number.POSITIVE_INFINITY,
  ): TerrainSurfaceHit | null => deps.terrainColliders.raycastSurface(ray, maxDistance);

  const raycastEditableTerrain = (ray: THREE.Ray, maxDistanceOverride?: number): TerrainSurfaceHit | null => {
    const playing = deps.getMode?.() === "playing";
    const maxDistance = maxDistanceOverride ?? (playing ? 8 : 4000);
    const colliderHit = raycastAuthoritativeTerrain(ray, maxDistance);
    if (colliderHit || playing) return colliderHit;
    return raycastTerrainHeightfieldWithin(ray, maxDistance);
  };

  const service: TerrainRaycastService = {
    raycastTerrainHeightfield,
    raycastAuthoritativeTerrain,
    raycastEditableTerrain,
  };
  setActiveTerrainRaycastService(service);
  return service;
}
