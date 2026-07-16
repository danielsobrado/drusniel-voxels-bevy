import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { PageMesh } from "../types.js";
import { GameplayDiagnostics, gameplayDiagnostics } from "../player/gameplay_diagnostics.js";

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
  /**
   * Column certification (playable-world-contract P2.4): the fallback may only snap the
   * capsule up in columns proven single-surface (no voxel overlay, no edits, no overhangs).
   * Absent means certified everywhere — legacy heightfield-only worlds; app wiring in worlds
   * with 3D voxel regions must pass a real certifier so caves never get an invented floor.
   */
  certifyColumn?: (x: number, z: number) => boolean;
}

export interface TerrainColliderStatus {
  covered: boolean;
  /** Highest terrain revision among covering pages; -1 when uncovered. */
  revision: number;
  /** A rebuild for a covering page is queued/in flight — collider is stale but serving. */
  replacementPending: boolean;
}

export interface TerrainColliderSetOptions {
  diagnostics?: GameplayDiagnostics;
  /**
   * When true, scheduled page rebuilds self-process on macrotask timeouts (off the frame
   * callback path). Tests leave it false and drive `processPendingRebuilds()` manually.
   */
  autoProcessRebuilds?: boolean;
}

interface ColliderEntry {
  id: string;
  footprint: TerrainColliderFootprint;
  sourceGeometry: THREE.BufferGeometry | null;
  sourceMesh: PageMesh | null;
  geometry: THREE.BufferGeometry | null;
  boundsTree: MeshBVH | null;
  /** Terrain revision the collision geometry was built from (0 = initial/unknown). */
  revision: number;
}

interface ColliderRebuildJob {
  pageId: string;
  /** Cloned at enqueue time (snapshot semantics, matching `updatePage`), BVH not yet built. */
  replacement: ColliderEntry;
  enqueuedAtMs: number;
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

function entryFromPage(page: TerrainColliderPage, revision = 0): ColliderEntry {
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
    revision,
  };
}

function footprintContainsPoint(footprint: TerrainColliderFootprint, x: number, z: number): boolean {
  return x >= footprint.minX && x <= footprint.maxX && z >= footprint.minZ && z <= footprint.maxZ;
}

export class TerrainColliderSet {
  private readonly entries: Map<string, ColliderEntry>;
  private readonly spatialCells = new Map<string, Set<string>>();
  private readonly entryCells = new Map<string, string[]>();
  private readonly diagnostics: GameplayDiagnostics;
  private readonly autoProcessRebuilds: boolean;
  private readonly pendingJobs = new Map<string, ColliderRebuildJob>();
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while the rebuild pipeline builds a BVH — those builds are off the frame path. */
  private pipelineBuildActive = false;

  constructor(
    pages: readonly TerrainColliderPage[],
    private readonly heightFallback: TerrainHeightFallback | null = null,
    options: TerrainColliderSetOptions = {},
  ) {
    this.diagnostics = options.diagnostics ?? gameplayDiagnostics;
    this.autoProcessRebuilds = options.autoProcessRebuilds ?? false;
    this.entries = new Map(pages.map((page) => [page.id, entryFromPage(page)]));
    for (const entry of this.entries.values()) this.indexEntry(entry);
  }

  loadedPageCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.boundsTree !== null) count++;
    return count;
  }

  /** Build every page's BVH up front so the first raycast against a cold page doesn't hitch. */
  prewarmAll(): void {
    this.pipelineBuildActive = true;
    try {
      for (const entry of this.entries.values()) this.ensureEntry(entry);
    } finally {
      this.pipelineBuildActive = false;
    }
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
    // Pending rebuild snapshots live in the same world frame as the entries they replace.
    for (const job of this.pendingJobs.values()) {
      const replacement = job.replacement;
      replacement.footprint.minX += dx;
      replacement.footprint.maxX += dx;
      replacement.footprint.minZ += dz;
      replacement.footprint.maxZ += dz;
      replacement.sourceGeometry?.translate(dx, 0, dz);
      if (replacement.sourceMesh) translatePageMesh(replacement.sourceMesh, dx, dz);
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
    const startedAt = performance.now();
    const geometry = entry.sourceGeometry?.clone() ?? (entry.sourceMesh ? geometryFromPageMesh(entry.sourceMesh) : null);
    if (!geometry) throw new Error(`Collider page ${entry.id} has no source geometry`);
    geometry.computeBoundingBox();
    entry.geometry = geometry;
    entry.boundsTree = new MeshBVH(geometry);
    const buildMs = performance.now() - startedAt;
    this.diagnostics.add("collider_build_count");
    this.diagnostics.add("collider_build_total_ms", buildMs);
    if (!this.pipelineBuildActive) {
      this.diagnostics.add("collider_sync_frame_builds");
      this.diagnostics.add("collider_sync_frame_build_ms", buildMs);
    }
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

  /** The fallback column is certified single-surface (absent certifier = certified). */
  private columnCertifiedForFallback(x: number, z: number): boolean {
    return this.heightFallback?.certifyColumn?.(x, z) ?? true;
  }

  private applyHeightFallback(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    grounded: boolean,
  ): { position: THREE.Vector3; velocity: THREE.Vector3; grounded: boolean; fired: boolean; deniedUncertified: boolean } {
    if (grounded || !this.heightFallback?.enabled) return { position, velocity, grounded, fired: false, deniedUncertified: false };
    const terrainY = this.heightFallback.surfaceHeight(position.x, position.z);
    if (!Number.isFinite(terrainY) || position.y > terrainY) return { position, velocity, grounded, fired: false, deniedUncertified: false };
    // Never invent a floor in a 3D voxel column: a player below the canonical surface may
    // legitimately be in a cave. Only certified single-surface columns get the snap.
    if (!this.columnCertifiedForFallback(position.x, position.z)) {
      return { position, velocity, grounded, fired: false, deniedUncertified: true };
    }
    const resolvedPosition = position.clone();
    resolvedPosition.y = terrainY;
    const resolvedVelocity = velocity.clone();
    if (resolvedVelocity.y < 0) resolvedVelocity.y = 0;
    return { position: resolvedPosition, velocity: resolvedVelocity, grounded: true, fired: true, deniedUncertified: false };
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

  /**
   * Synchronously replace one page's collision geometry and rebuild its BVH on the calling
   * path. Frame-path callers should use `schedulePageUpdate` instead (P2 async pipeline);
   * this stays for tools/tests and is visible in `collider_sync_frame_builds` when misused.
   */
  updatePage(id: string, source: THREE.BufferGeometry | PageMesh, terrainRevision = 0): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const pending = this.pendingJobs.get(id);
    if (pending) {
      // The sync replacement is newer than the queued job — installing the job later
      // would resurrect stale geometry.
      this.discardJob(pending);
      this.pendingJobs.delete(id);
      this.diagnostics.add("collider_jobs_cancelled_stale");
      this.publishQueueGauges();
    }
    const wasLoaded = entry.boundsTree !== null;
    const replacement = entryFromPage({
      id,
      footprint: entry.footprint,
      ...(source instanceof THREE.BufferGeometry ? { geometry: source } : { mesh: source }),
    }, terrainRevision);
    if (wasLoaded) this.ensureEntry(replacement);
    this.entries.set(id, replacement);
    this.disposeEntry(entry);
    return true;
  }

  upsertPage(page: TerrainColliderPage): void {
    const pending = this.pendingJobs.get(page.id);
    if (pending) {
      this.discardJob(pending);
      this.pendingJobs.delete(page.id);
      this.diagnostics.add("collider_jobs_cancelled_stale");
      this.publishQueueGauges();
    }
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
    if (this.pendingJobs.has(id)) {
      this.discardJob(this.pendingJobs.get(id)!);
      this.pendingJobs.delete(id);
      this.publishQueueGauges();
    }
    return true;
  }

  /** A collider page (loaded or lazily buildable) covers this world column. */
  coversPoint(x: number, z: number): boolean {
    const key = `${Math.floor(x / COLLIDER_SPATIAL_CELL_SIZE)},${Math.floor(z / COLLIDER_SPATIAL_CELL_SIZE)}`;
    for (const entry of this.entriesForCellKeys([key])) {
      if (footprintContainsPoint(entry.footprint, x, z)) return true;
    }
    return false;
  }

  colliderStatusAt(x: number, z: number): TerrainColliderStatus {
    const key = `${Math.floor(x / COLLIDER_SPATIAL_CELL_SIZE)},${Math.floor(z / COLLIDER_SPATIAL_CELL_SIZE)}`;
    let covered = false;
    let revision = -1;
    let replacementPending = false;
    for (const entry of this.entriesForCellKeys([key])) {
      if (!footprintContainsPoint(entry.footprint, x, z)) continue;
      covered = true;
      revision = Math.max(revision, entry.revision);
      if (this.pendingJobs.has(entry.id)) replacementPending = true;
    }
    return { covered, revision, replacementPending };
  }

  /**
   * Asynchronous revision-validated page replacement (playable-world-contract P2.1):
   * queues the rebuild instead of constructing the `MeshBVH` on the calling (frame) path.
   * The old collider keeps serving queries until the validated replacement installs
   * atomically in `processPendingRebuilds`. Returns false when the page is unknown.
   */
  schedulePageUpdate(id: string, source: THREE.BufferGeometry | PageMesh, terrainRevision = 0): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const superseded = this.pendingJobs.get(id);
    if (superseded) {
      this.discardJob(superseded);
      this.pendingJobs.delete(id);
      this.diagnostics.add("collider_jobs_cancelled_stale");
    }
    const replacement = entryFromPage(
      {
        id,
        footprint: entry.footprint,
        ...(source instanceof THREE.BufferGeometry ? { geometry: source } : { mesh: source }),
      },
      terrainRevision,
    );
    this.pendingJobs.set(id, { pageId: id, replacement, enqueuedAtMs: performance.now() });
    this.diagnostics.add("collider_jobs_queued");
    this.publishQueueGauges();
    this.armRebuildTimer();
    return true;
  }

  pendingRebuildCount(): number {
    return this.pendingJobs.size;
  }

  /**
   * Build + install queued replacements, oldest first. Called off the frame path — by the
   * self-arming timeout (`autoProcessRebuilds`) or explicitly by tests/tools. Jobs whose
   * page vanished or was re-queued mid-build are discarded (`collider_jobs_cancelled_stale`).
   */
  processPendingRebuilds(maxJobs = 1): number {
    let processed = 0;
    while (processed < maxJobs) {
      const first = this.pendingJobs.entries().next();
      if (first.done) break;
      const [id, job] = first.value;
      this.pendingJobs.delete(id);
      processed++;
      const current = this.entries.get(id);
      if (!current) {
        this.discardJob(job);
        this.diagnostics.add("collider_jobs_cancelled_stale");
        continue;
      }
      if (current.boundsTree) {
        this.pipelineBuildActive = true;
        try {
          this.ensureEntry(job.replacement);
        } finally {
          this.pipelineBuildActive = false;
        }
      }
      // Revision validation on completion: a job for this page enqueued during the build
      // supersedes this result (only reachable with an interleaving/async builder).
      if (this.pendingJobs.has(id)) {
        this.discardJob(job);
        this.diagnostics.add("collider_jobs_cancelled_stale");
        continue;
      }
      const applyStartedAt = performance.now();
      this.entries.set(id, job.replacement);
      this.disposeEntry(current);
      const now = performance.now();
      this.diagnostics.add("collider_jobs_completed");
      this.diagnostics.set("collider_apply_ms", now - applyStartedAt);
      this.diagnostics.set("collider_queue_latency_ms", now - job.enqueuedAtMs);
      this.diagnostics.setMax("collider_queue_latency_max_ms", now - job.enqueuedAtMs);
    }
    this.publishQueueGauges();
    return processed;
  }

  private discardJob(job: ColliderRebuildJob): void {
    this.disposeEntry(job.replacement);
  }

  private publishQueueGauges(): void {
    this.diagnostics.set("collider_jobs_inflight", this.pendingJobs.size);
  }

  private armRebuildTimer(): void {
    if (!this.autoProcessRebuilds || this.rebuildTimer !== null || this.pendingJobs.size === 0) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.processPendingRebuilds(1);
      this.armRebuildTimer();
    }, 0);
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
    let staleTested = false;

    for (const entry of this.entriesForBox(tempBox)) {
      if (!overlapsFootprint(tempBox, entry.footprint)) continue;
      pagesTested++;
      if (this.pendingJobs.has(entry.id)) staleTested = true;
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

    // Reason-coded accounting (P0.3): only genuine coverage loss should ever gate.
    if (staleTested) this.diagnostics.add("collider_stale_frames");
    if (fallback.fired) this.diagnostics.add("fallback_heightfield_certified");
    if (fallback.deniedUncertified) this.diagnostics.add("fallback_denied_uncertified");
    if (!fallback.grounded) {
      if (pagesTested > 0) {
        this.diagnostics.add("collider_exact_no_ground");
      } else if (this.heightFallback?.enabled && this.columnCertifiedForFallback(resolvedPosition.x, resolvedPosition.z)) {
        // Airborne over a certified fallback column: the certified floor exists below.
        this.diagnostics.add("collider_exact_no_ground");
      } else {
        this.diagnostics.add("collider_coverage_missing");
      }
    }

    return {
      position: fallback.position,
      velocity: fallback.velocity,
      grounded: fallback.grounded,
      pagesTested,
    };
  }

  dispose(): void {
    if (this.rebuildTimer !== null) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    for (const job of this.pendingJobs.values()) this.discardJob(job);
    this.pendingJobs.clear();
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.spatialCells.clear();
    this.entryCells.clear();
  }
}
