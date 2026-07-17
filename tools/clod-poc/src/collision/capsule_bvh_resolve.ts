import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import type { CapsuleCollisionConfig, CapsuleCollisionResult } from "../terrain/terrain_collider.js";

export interface CapsuleBvhFootprint {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface CapsuleBvhColliderEntry {
  footprint: CapsuleBvhFootprint;
  boundsTree: MeshBVH;
}

const tempBox = new THREE.Box3();
const tempSegment = new THREE.Line3();
const trianglePoint = new THREE.Vector3();
const capsulePoint = new THREE.Vector3();
const pushDirection = new THREE.Vector3();
const triangleNormal = new THREE.Vector3();

export function footprintFromBox(box: THREE.Box3): CapsuleBvhFootprint {
  return { minX: box.min.x, minZ: box.min.z, maxX: box.max.x, maxZ: box.max.z };
}

export function capsuleBoxOverlapsFootprint(box: THREE.Box3, footprint: CapsuleBvhFootprint): boolean {
  return box.max.x >= footprint.minX
    && box.min.x <= footprint.maxX
    && box.max.z >= footprint.minZ
    && box.min.z <= footprint.maxZ;
}

/**
 * Positional capsule resolve against a set of world-space BVH entries (props,
 * construction pieces). Same contract as TerrainColliderSet.resolveCapsule so results
 * can be chained; `pagesTested` counts entries whose footprint overlapped the capsule.
 */
export function resolveCapsuleAgainstBvhEntries(
  entries: Iterable<CapsuleBvhColliderEntry>,
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

  for (const entry of entries) {
    if (!capsuleBoxOverlapsFootprint(tempBox, entry.footprint)) continue;
    pagesTested++;
    entry.boundsTree.shapecast({
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

  return { position: resolvedPosition, velocity: resolvedVelocity, grounded, pagesTested };
}
