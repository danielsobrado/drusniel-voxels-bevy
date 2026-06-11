import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

export interface TerrainColliderFootprint {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface TerrainColliderPage {
  id: string;
  geometry: THREE.BufferGeometry;
  footprint: TerrainColliderFootprint;
}

export interface CapsuleCollisionConfig {
  capsuleRadius: number;
  capsuleHeight: number;
  maxSlopeDegrees: number;
}

export interface TerrainSpawnHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  pageId: string;
}

export interface CapsuleCollisionResult {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  grounded: boolean;
  pagesTested: number;
}

interface ColliderEntry {
  id: string;
  footprint: TerrainColliderFootprint;
  geometry: THREE.BufferGeometry;
  boundsTree: MeshBVH;
}

const tempBox = new THREE.Box3();
const tempSegment = new THREE.Line3();
const trianglePoint = new THREE.Vector3();
const capsulePoint = new THREE.Vector3();
const pushDirection = new THREE.Vector3();
const triangleNormal = new THREE.Vector3();

function overlapsFootprint(box: THREE.Box3, footprint: TerrainColliderFootprint): boolean {
  return box.max.x >= footprint.minX
    && box.min.x <= footprint.maxX
    && box.max.z >= footprint.minZ
    && box.min.z <= footprint.maxZ;
}

export class TerrainColliderSet {
  private readonly entries: ColliderEntry[];

  constructor(pages: readonly TerrainColliderPage[]) {
    this.entries = pages.map((page) => {
      const geometry = page.geometry.clone();
      geometry.computeBoundingBox();
      return {
        id: page.id,
        footprint: page.footprint,
        geometry,
        boundsTree: new MeshBVH(geometry),
      };
    });
  }

  raycastSpawn(ray: THREE.Ray): TerrainSpawnHit | null {
    let nearest: TerrainSpawnHit | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const entry of this.entries) {
      const hit = entry.boundsTree.raycastFirst(ray, THREE.DoubleSide);
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

  resolveCapsule(
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

    for (const entry of this.entries) {
      if (!overlapsFootprint(tempBox, entry.footprint)) continue;
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

          if (triangleNormal.y >= maxSlopeCosine && pushDirection.y > 0.01) {
            grounded = true;
          }
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

  dispose(): void {
    for (const entry of this.entries) entry.geometry.dispose();
  }
}
