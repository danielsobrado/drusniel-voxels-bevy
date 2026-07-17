import * as THREE from "three";
import type { ConstructionPlacementConfig, ConstructionSurfaceHit } from "./types.js";

const RAYCAST_REFINE_STEPS = 12;
const NORMAL_SAMPLE_EPSILON_M = 0.2;

export interface AuthoritativeConstructionTerrainHit {
  point: THREE.Vector3;
  distance: number;
  pageId: string;
}

export interface ConstructionTerrainRaycastInput {
  ray: THREE.Ray;
  worldCells: number;
  placement: ConstructionPlacementConfig;
  raycastAuthoritativeTerrain?: (ray: THREE.Ray, maxDistance?: number) => AuthoritativeConstructionTerrainHit | null;
  surfaceHeightAt?: (x: number, z: number) => number;
  densityAt?: (x: number, y: number, z: number) => number;
}

export function isConstructionPointInWorld(
  x: number,
  z: number,
  worldCells: number,
  unboundedWorld: boolean,
): boolean {
  return unboundedWorld || (x >= 0 && x <= worldCells && z >= 0 && z <= worldCells);
}

function normalizeNormal(normal: THREE.Vector3, ray: THREE.Ray): readonly [number, number, number] {
  if (normal.lengthSq() <= 1e-10) normal.set(0, 1, 0);
  else normal.normalize();
  if (normal.dot(ray.direction) > 0) normal.negate();
  return [normal.x, normal.y, normal.z];
}

function densityNormalAt(
  point: THREE.Vector3,
  ray: THREE.Ray,
  densityAt: (x: number, y: number, z: number) => number,
): readonly [number, number, number] {
  const e = NORMAL_SAMPLE_EPSILON_M;
  const dx = densityAt(point.x + e, point.y, point.z) - densityAt(point.x - e, point.y, point.z);
  const dy = densityAt(point.x, point.y + e, point.z) - densityAt(point.x, point.y - e, point.z);
  const dz = densityAt(point.x, point.y, point.z + e) - densityAt(point.x, point.y, point.z - e);
  return normalizeNormal(new THREE.Vector3(-dx, -dy, -dz), ray);
}

function heightfieldNormalAt(
  point: THREE.Vector3,
  ray: THREE.Ray,
  surfaceHeightAt: (x: number, z: number) => number,
): readonly [number, number, number] {
  const e = NORMAL_SAMPLE_EPSILON_M;
  const dx = surfaceHeightAt(point.x + e, point.z) - surfaceHeightAt(point.x - e, point.z);
  const dz = surfaceHeightAt(point.x, point.z + e) - surfaceHeightAt(point.x, point.z - e);
  return normalizeNormal(new THREE.Vector3(-dx, e * 2, -dz), ray);
}

function authoritativeHit(input: ConstructionTerrainRaycastInput): ConstructionSurfaceHit | null {
  const hit = input.raycastAuthoritativeTerrain?.(input.ray, input.placement.maxRayDistanceM);
  if (!hit) return null;
  const normal = input.densityAt
    ? densityNormalAt(hit.point, input.ray, input.densityAt)
    : [0, 1, 0] as const;
  return {
    point: [hit.point.x, hit.point.y, hit.point.z],
    normal,
    distanceM: hit.distance,
    surfaceType: "terrain",
    pageId: hit.pageId,
  };
}

function heightfieldHit(input: ConstructionTerrainRaycastInput): ConstructionSurfaceHit | null {
  const surfaceHeightAt = input.surfaceHeightAt;
  if (!surfaceHeightAt || input.placement.allowHeightfieldFallback !== true) return null;
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
    const signed = scratch.y - surfaceHeightAt(scratch.x, scratch.z);
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
        const midSigned = scratch.y - surfaceHeightAt(scratch.x, scratch.z);
        if (midSigned > 0) lo = mid;
        else hi = mid;
      }
      input.ray.at(hi, scratch);
      return {
        point: [scratch.x, scratch.y, scratch.z],
        normal: heightfieldNormalAt(scratch, input.ray, surfaceHeightAt),
        distanceM: hi,
        surfaceType: "terrain",
        pageId: "heightfield-debug-fallback",
      };
    }
    previousT = t;
    previousSigned = signed;
  }
  return null;
}

export function raycastConstructionTerrain(input: ConstructionTerrainRaycastInput): ConstructionSurfaceHit | null {
  return authoritativeHit(input) ?? heightfieldHit(input);
}
