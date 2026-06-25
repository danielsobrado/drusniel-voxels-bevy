import * as THREE from "three";
import type { TerrainColliderSet, TerrainSurfaceHit } from "../terrain/terrain_collider.js";

export interface TerrainRaycastServiceDeps {
  terrainColliders: TerrainColliderSet;
  surfaceHeight: (x: number, z: number) => number;
  worldCells: number;
}

export interface TerrainRaycastService {
  raycastTerrainHeightfield(ray: THREE.Ray): TerrainSurfaceHit | null;
  raycastEditableTerrain(ray: THREE.Ray): TerrainSurfaceHit | null;
}

export function createTerrainRaycastService(deps: TerrainRaycastServiceDeps): TerrainRaycastService {
  const raycastTerrainHeightfield = (ray: THREE.Ray): TerrainSurfaceHit | null => {
    const maxDistance = Math.max(8000, deps.worldCells * 8);
    const step = 2;
    let previousT = 0;
    const previousPoint = ray.at(previousT, new THREE.Vector3());
    let previousSigned = previousPoint.y - deps.surfaceHeight(previousPoint.x, previousPoint.z);

    for (let t = step; t <= maxDistance; t += step) {
      const point = ray.at(t, new THREE.Vector3());
      const inWorld = point.x >= 0 && point.x <= deps.worldCells && point.z >= 0 && point.z <= deps.worldCells;
      const signed = inWorld ? point.y - deps.surfaceHeight(point.x, point.z) : Number.POSITIVE_INFINITY;
      if (inWorld && previousSigned >= 0 && signed <= 0) {
        let lo = previousT;
        let hi = t;
        const hit = new THREE.Vector3();
        for (let i = 0; i < 12; i++) {
          const midT = (lo + hi) * 0.5;
          ray.at(midT, hit);
          const midSigned = hit.y - deps.surfaceHeight(hit.x, hit.z);
          if (midSigned > 0) lo = midT;
          else hi = midT;
        }
        ray.at(hi, hit);
        return { point: hit.clone(), distance: hi, pageId: "heightfield" };
      }
      previousT = t;
      previousSigned = signed;
    }
    return null;
  };

  const raycastEditableTerrain = (ray: THREE.Ray): TerrainSurfaceHit | null =>
    deps.terrainColliders.raycastSurface(ray) ?? raycastTerrainHeightfield(ray);

  return { raycastTerrainHeightfield, raycastEditableTerrain };
}
