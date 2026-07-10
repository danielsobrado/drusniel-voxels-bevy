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

export interface TerrainHeightFallback {
  enabled: boolean;
  surfaceHeight: (x: number, z: number) => number;
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
const COLLIDER_SPATIAL_CELL_SIZE = 64;

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

function translatePageMesh(mesh: PageMesh, dx: number, dz: number): void {
  for (let i = 0; i < mesh.positions.length; i += 3) {
    mesh.positions[i] += dx;
    mesh.positions[i + 2] += dz;
  }
}

function entryFromPage(page: TerrainColliderPage): ColliderEntry {
  if (!page.geometry && !page.mesh) throw new Error(`Collider page ${page.id} needs geometry or mesh source`);
  return {
    id: page.id,
    footprint: { ...page.footprint },
    sourceGeometry: page.geometry?.clone() ?? null,
    sourceMesh: page.mesh
      ? {
          ...page.mesh,
          positions: new Float32Array(page.mesh.positions),
        }
      : null,
    geometry: null,
    boundsTree: null,
  };
}

export class TerrainColliderSet {
  private readonly entries: Map<string, ColliderEntry>;
  private readonly spatialCells = new Map<string, Set<string>>();
  private readonly entryCells = new Map<string, string[]>();

  constructor(
    pages: readonly TerrainColliderPage[],
    private readonly heightFallback: TerrainHeightFallback | null = null,
  ) {
    this.entries = new Map(pages.map((page) => [page.id, entryFromPage(page)]));
    for (const entry of this.entries.values()) this.indexEntry(entry);
  }

  loadedPageCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.boundsTree !== null) count++;
    return count;
  }

  pageCount(): number {
    return this.entries.size;
  }

  translateHorizontal(dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    for (const entry of this.entries.values()) {
      entry.footprint.minX += dx;
      entry.footprint.maxX += dx;
      entry.footprint.minZ += dz;
      entry.footprint.maxZ += dz;
      entry.sourceGeometry?.translate(dx, 0, dz);
      if (entry.sourceMesh) translatePageMesh(entry.sourceMesh, dx, dz);
      entry.geometry?.dispose();
      entry.geometry = null;
      entry.boundsTree = null;
    }
    this.rebuildSpatialIndex();
  }

  private indexEntry(entry: ColliderEntry): void {
    const minX = Math.floor(entry.footprint.minX / COLLIDER_SPATIAL_CELL_SIZE);
    const maxX = Math.floor((entry.footprint.maxX - 1e-6) / COLLIDER_SPATIAL_CELL_SIZE);
    const minZ = Math.floor(entry.footprint.minZ / COLLIDER_SPATIAL_CELL_SIZE);
    const maxZ = Math.floor((entry.footprint.maxZ - 1e-6) / COLLIDER_SPATIAL_CELL_SIZE);
    const keys: string[] = [];
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const key = `${x},${z}`;
        const ids = this.spatialCells.get(key) ?? new Set<string>();
        ids.add(entry.id);
        this.spatialCells.set(key, ids);
        keys.push(key);
      }
    }
    this.entryCells.set(entry.id, keys);
  }

  private unindexEntry(id: string): void {
    for (const key of this.entryCells.get(id) ?? []) {
      const ids = this.spatialCells.get(key);
      ids?.delete(id);
      if (ids?.size === 0) this.spatialCells.delete(key);
    }
    this.entryCells.delete(id);
  }

  private rebuildSpatialIndex(): void {
    this.spatialCells.clear();
    this.entryCells.clear();
    for (const entry of this.entries.values()) this.indexEntry(entry);
  }

  private entriesForCellKeys(keys: Iterable<string>): ColliderEntry[] {
    const ids = new Set<string>();
    for (const key of keys) for (const id of this.spatialCells.get(key) ?? []) ids.add(id);
    return [...ids].map((id) => this.entries.get(id)).filter((entry): entry is ColliderEntry => entry !== undefined);
  }

  private entriesForRay(ray: THREE.Ray, maxDistance: number): ColliderEntry[] {
    if (!Number.isFinite(maxDistance)) return [...this.entries.values()];
    const horizontalDistance = maxDistance * Math.hypot(ray.direction.x, ray.direction.z);
    const steps = Math.max(1, Math.ceil(horizontalDistance / COLLIDER_SPATIAL_CELL_SIZE));
    const keys = new Set<string>();
    for (let step = 0; step <= steps; step++) {
      const distance = maxDistance * (step / steps);
      const cellX = Math.floor((ray.origin.x + ray.direction.x * distance) / COLLIDER_SPATIAL_CELL_SIZE);
      const cellZ = Math.floor((ray.origin.z + ray.direction.z * distance) / COLLIDER_SPATIAL_CELL_SIZE);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) keys.add(`${cellX + dx},${cellZ + dz}`);
    }
    return this.entriesForCellKeys(keys);
  }

  private entriesForBox(box: THREE.Box3): ColliderEntry[] {
    const keys: string[] = [];
    const minX = Math.floor(box.min.x / COLLIDER_SPATIAL_CELL_SIZE);
    const maxX = Math.floor(box.max.x / COLLIDER_SPATIAL_CELL_SIZE);
    const minZ = Math.floor(box.min.z / COLLIDER_SPATIAL_CELL_SIZE);
    const maxZ = Math.floor(box.max.z / COLLIDER_SPATIAL_CELL_SIZE);
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) keys.push(`${x},${z}`);
    return this.entriesForCellKeys(keys);
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

  private disposeEntry(entry: ColliderEntry): void {
    entry.geometry?.dispose();
    entry.sourceGeometry?.dispose();
    entry.geometry = null;
    entry.sourceGeometry = null;
    entry.sourceMesh = null;
    entry.boundsTree = null;
  }

  private applyHeightFallback(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    grounded: boolean,
  ): { position: THREE.Vector3; velocity: THREE.Vector3; grounded: boolean } {
    if (grounded || !this.heightFallback?.enabled) return { position, velocity, grounded };
    const terrainY = this.heightFallback.surfaceHeight(position.x, position.z);
    if (!Number.isFinite(terrainY) || position.y > terrainY) return { position, velocity, grounded };
    const resolvedPosition = position.clone();
    resolvedPosition.y = terrainY;
    const resolvedVelocity = velocity.clone();
    if (resolvedVelocity.y < 0) resolvedVelocity.y = 0;
    return { position: resolvedPosition, velocity: resolvedVelocity, grounded: true };
  }

  raycastSpawn(ray: THREE.Ray): TerrainSpawnHit | null {
    let nearest: TerrainSpawnHit | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const entry of this.entriesForRay(ray, 10000)) {
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
  raycastSurface(ray: THREE.Ray, maxDistance = Number.POSITIVE_INFINITY): TerrainSurfaceHit | null {
    let nearest: TerrainSurfaceHit | null = null;
    for (const entry of this.entriesForRay(ray, maxDistance)) {
      if (!rayCanHitFootprint(ray, entry.footprint)) continue;
      const hit = this.ensureEntry(entry).raycastFirst(ray, THREE.DoubleSide);
      if (!hit || hit.distance > maxDistance) continue;
      if (!nearest || hit.distance < nearest.distance) {
        nearest = { point: hit.point.clone(), distance: hit.distance, pageId: entry.id };
      }
    }
    return nearest;
  }

  /** Replace one page's collision geometry (after a terrain edit) and rebuild its BVH. */
  updatePage(id: string, source: THREE.BufferGeometry | PageMesh): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const wasLoaded = entry.boundsTree !== null;
    const replacement = entryFromPage({
      id,
      footprint: entry.footprint,
      ...(source instanceof THREE.BufferGeometry ? { geometry: source } : { mesh: source }),
    });
    if (wasLoaded) this.ensureEntry(replacement);
    this.entries.set(id, replacement);
    this.disposeEntry(entry);
    return true;
  }

  upsertPage(page: TerrainColliderPage): void {
    const previous = this.entries.get(page.id);
    const replacement = entryFromPage(page);
    if (previous?.boundsTree) this.ensureEntry(replacement);
    this.entries.set(page.id, replacement);
    this.unindexEntry(page.id);
    this.indexEntry(replacement);
    if (previous) this.disposeEntry(previous);
  }

  removePage(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.unindexEntry(id);
    this.disposeEntry(entry);
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

    for (const entry of this.entriesForBox(tempBox)) {
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

    const fallback = this.applyHeightFallback(resolvedPosition, resolvedVelocity, grounded);
    return {
      position: fallback.position,
      velocity: fallback.velocity,
      grounded: fallback.grounded,
      pagesTested,
    };
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.spatialCells.clear();
    this.entryCells.clear();
  }
}
