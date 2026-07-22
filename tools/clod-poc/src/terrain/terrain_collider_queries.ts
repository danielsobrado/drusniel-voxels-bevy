import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import type { GameplayDiagnostics } from "../player/gameplay_diagnostics.js";
import {
  applyHeightFallback,
  columnCertifiedForFallback,
} from "./terrain_collider_height_fallback.js";
import {
  overlapsFootprint,
  rayCanHitFootprint,
} from "./terrain_collider_spatial_index.js";
import type {
  CapsuleCollisionConfig,
  CapsuleCollisionResult,
  TerrainColliderFootprint,
  TerrainHeightFallback,
  TerrainSpawnHit,
  TerrainSurfaceHit,
} from "./terrain_collider.js";

const tempBox = new THREE.Box3();
const tempSegment = new THREE.Line3();
const trianglePoint = new THREE.Vector3();
const capsulePoint = new THREE.Vector3();
const pushDirection = new THREE.Vector3();
const triangleNormal = new THREE.Vector3();

export interface TerrainColliderQueryEntry {
  id: string;
  footprint: TerrainColliderFootprint;
}

export interface TerrainColliderQueryDeps<TEntry extends TerrainColliderQueryEntry> {
  entriesForRay: (ray: THREE.Ray, maxDistance: number) => TEntry[];
  entriesForBox: (box: THREE.Box3) => TEntry[];
  ensureEntry: (entry: TEntry) => MeshBVH;
  hasRebuildFor: (id: string) => boolean;
  heightFallback: TerrainHeightFallback | null;
  diagnostics: GameplayDiagnostics;
}

export function terrainColliderRaycastSpawn<TEntry extends TerrainColliderQueryEntry>(
  deps: TerrainColliderQueryDeps<TEntry>,
  ray: THREE.Ray,
): TerrainSpawnHit | null {
  let nearest: TerrainSpawnHit | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const entry of deps.entriesForRay(ray, 10000)) {
    if (!rayCanHitFootprint(ray, entry.footprint)) continue;
    const hit = deps.ensureEntry(entry).raycastFirst(ray, THREE.DoubleSide);
    if (!hit || hit.distance >= nearestDistance || !hit.face) continue;

    const normal = hit.face.normal.clone().normalize();
    if (normal.y < 0) normal.negate();
    if (normal.y <= 0.01) continue;

    nearestDistance = hit.distance;
    nearest = {
      point: hit.point.clone(),
      normal,
      pageId: entry.id,
    };
  }

  return nearest;
}

/** Nearest terrain hit with no slope filter — walls and ceilings count (dig targeting). */
export function terrainColliderRaycastSurface<TEntry extends TerrainColliderQueryEntry>(
  deps: TerrainColliderQueryDeps<TEntry>,
  ray: THREE.Ray,
  maxDistance = Number.POSITIVE_INFINITY,
): TerrainSurfaceHit | null {
  let nearest: TerrainSurfaceHit | null = null;
  for (const entry of deps.entriesForRay(ray, maxDistance)) {
    if (!rayCanHitFootprint(ray, entry.footprint)) continue;
    const hit = deps.ensureEntry(entry).raycastFirst(ray, THREE.DoubleSide);
    if (!hit || hit.distance > maxDistance) continue;
    if (!nearest || hit.distance < nearest.distance) {
      nearest = { point: hit.point.clone(), distance: hit.distance, pageId: entry.id };
    }
  }
  return nearest;
}

export function terrainColliderResolveCapsule<TEntry extends TerrainColliderQueryEntry>(
  deps: TerrainColliderQueryDeps<TEntry>,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  config: CapsuleCollisionConfig,
): CapsuleCollisionResult {
  const radius = config.capsuleRadius;
  tempSegment.start.set(position.x, position.y + radius, position.z);
  tempSegment.end.set(position.x, position.y + config.capsuleHeight - radius, position.z);
  tempBox.makeEmpty();
  tempBox.expandByPoint(tempSegment.start);
  tempBox.expandByPoint(tempSegment.end);
  tempBox.min.addScalar(-radius);
  tempBox.max.addScalar(radius);

  const maxSlopeCosine = Math.cos(THREE.MathUtils.degToRad(config.maxSlopeDegrees));
  let grounded = false;
  let pagesTested = 0;
  let staleTested = false;

  for (const entry of deps.entriesForBox(tempBox)) {
    if (!overlapsFootprint(tempBox, entry.footprint)) continue;
    pagesTested++;
    if (deps.hasRebuildFor(entry.id)) staleTested = true;
    deps.ensureEntry(entry).shapecast({
      intersectsBounds: (box) => box.intersectsBox(tempBox),
      intersectsTriangle: (triangle) => {
        const distance = triangle.closestPointToSegment(tempSegment, trianglePoint, capsulePoint);
        if (distance >= radius) return false;

        triangle.getNormal(triangleNormal);
        if (triangleNormal.y < 0) triangleNormal.negate();
        const depth = radius - distance;
        pushDirection.subVectors(capsulePoint, trianglePoint);
        if (pushDirection.lengthSq() < 1e-10) pushDirection.copy(triangleNormal);
        else pushDirection.normalize();

        tempSegment.start.addScaledVector(pushDirection, depth);
        tempSegment.end.addScaledVector(pushDirection, depth);
        tempBox.translate(pushDirection.clone().multiplyScalar(depth));

        if (triangleNormal.y >= maxSlopeCosine && pushDirection.y > 0.01) grounded = true;
        return false;
      },
    });
  }

  const resolvedPosition = new THREE.Vector3(
    tempSegment.start.x,
    tempSegment.start.y - radius,
    tempSegment.start.z,
  );
  const displacement = resolvedPosition.clone().sub(position);
  const resolvedVelocity = velocity.clone();
  if (displacement.lengthSq() > 1e-10) {
    const collisionNormal = displacement.normalize();
    const intoSurface = resolvedVelocity.dot(collisionNormal);
    if (intoSurface < 0) resolvedVelocity.addScaledVector(collisionNormal, -intoSurface);
  }
  if (grounded && resolvedVelocity.y < 0) resolvedVelocity.y = 0;

  const fallback = applyHeightFallback(deps.heightFallback, resolvedPosition, resolvedVelocity, grounded);

  if (staleTested) deps.diagnostics.add("collider_stale_frames");
  if (fallback.fired) deps.diagnostics.add("fallback_heightfield_certified");
  if (fallback.deniedUncertified) deps.diagnostics.add("fallback_denied_uncertified");
  if (!fallback.grounded) {
    if (pagesTested > 0) {
      deps.diagnostics.add("collider_exact_no_ground");
    } else if (
      deps.heightFallback?.enabled
      && columnCertifiedForFallback(deps.heightFallback, resolvedPosition.x, resolvedPosition.z)
    ) {
      deps.diagnostics.add("collider_exact_no_ground");
    } else {
      deps.diagnostics.add("collider_coverage_missing");
    }
  }

  return {
    position: fallback.position,
    velocity: fallback.velocity,
    grounded: fallback.grounded,
    pagesTested,
  };
}
