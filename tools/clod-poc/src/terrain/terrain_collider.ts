import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { PageMesh } from "../types.js";

export interface TerrainColliderFootprint {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface TerrainColliderPage {
  id: string;
  geometry?: THREE.BufferGeometry;
  mesh?: PageMesh;
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

export interface TerrainSurfaceHit {
  point: THREE.Vector3;
  distance: number;
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
  sourceGeometry: THREE.BufferGeometry | null;
  sourceMesh: PageMesh | null;
  geometry: THREE.BufferGeometry | null;
  boundsTree: MeshBVH | null;
}

const tempBox = new THREE.Box3();
const tempRayBox = new THREE.Box3();
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

function geometryFromPageMesh(mesh: PageMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return geometry;
}

function rayCanHitFootprint(ray: THREE.Ray, footprint: TerrainColliderFootprint): boolean {
  tempRayBox.min.set(footprint.minX, -10000, footprint.minZ);
  tempRayBox.max.set(footprint.maxX, 10000, footprint.maxZ);
  return ray.intersectsBox(tempRayBox);
}

export class TerrainColliderSet {
  private readonly entries: ColliderEntry[];

  constructor(pages: readonly TerrainColliderPage[]) {
    this.entries = pages.map((page) => {
      if (!page.geometry && !page.mesh) throw new Error(`Collider page ${page.id} needs geometry or mesh source`);
      return {
        id: page.id,
        footprint: page.footprint,
        sourceGeometry: page.geometry?.clone() ?? null,
        sourceMesh: page.mesh ?? null,
        geometry: null,
        boundsTree: null,
      };
    });
  }

  loadedPageCount(): number {
    return this.entries.filter((entry) => entry.boundsTree !== null).length;
  }

  private ensureEntry(entry: ColliderEntry): MeshBVH {
    if (entry.boundsTree) return entry.boundsTree;
    const geometry = entry.sourceGeometry?.clone() ?? (entry.sourceMesh ? geometryFromPageMesh(entry.sourceMesh) : null);
    if (!geometry) throw new Error(`Collider page ${entry.id} has no source geometry`);
    geometry.computeBoundingBox();
    entry.geometry = geometry;
    entry.boundsTree = new MeshBVH(geometry);
    return entry.boundsTree;
  }

  raycastSpawn(ray: THREE.Ray): TerrainSpawnHit | null {
    let nearest: TerrainSpawnHit | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const entry of this.entries) {
      if (!rayCanHitFootprint(ray, entry.footprint)) continue;
      const hit = this.ensureEntry(entry).raycastFirst(ray, THREE.DoubleSide);
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
  raycastSurface(ray: THREE.Ray): TerrainSurfaceHit | null {
    let nearest: TerrainSurfaceHit | null = null;
    for (const entry of this.entries) {
      if (!rayCanHitFootprint(ray, entry.footprint)) continue;
      const hit = this.ensureEntry(entry).raycastFirst(ray, THREE.DoubleSide);
      if (!hit) continue;
      if (!nearest || hit.distance < nearest.distance) {
        nearest = { point: hit.point.clone(), distance: hit.distance, pageId: entry.id };
      }
    }
    return nearest;
  }

  /** Replace one page's collision geometry (after a terrain edit) and rebuild its BVH. */
  updatePage(id: string, source: THREE.BufferGeometry | PageMesh): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    const wasLoaded = entry.boundsTree !== null;
    entry.geometry?.dispose();
    entry.sourceGeometry?.dispose();
    entry.geometry = null;
    entry.boundsTree = null;
    if (source instanceof THREE.BufferGeometry) {
      entry.sourceGeometry = source.clone();
      entry.sourceMesh = null;
    } else {
      entry.sourceGeometry = null;
      entry.sourceMesh = source;
    }
    if (wasLoaded) this.ensureEntry(entry);
    return true;
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
      this.ensureEntry(entry).shapecast({
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
    for (const entry of this.entries) {
      entry.geometry?.dispose();
      entry.sourceGeometry?.dispose();
      entry.geometry = null;
      entry.sourceGeometry = null;
      entry.boundsTree = null;
    }
  }
}
