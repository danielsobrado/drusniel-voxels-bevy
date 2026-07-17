import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { PageMesh } from "../types.js";
import { GameplayDiagnostics, gameplayDiagnostics } from "../player/gameplay_diagnostics.js";
import {
  createTerrainColliderRemoteBuilder,
  type TerrainColliderBuildInput,
  type TerrainColliderBuildResult,
  type TerrainColliderRemoteBuilder,
} from "./terrain_collider_worker_client.js";

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
  /** Automatically drains scheduled replacements outside the render/frame callback. */
  autoProcessRebuilds?: boolean;
  /** Injectable for tests. Undefined creates the browser worker; null forces fallback mode. */
  remoteBuilder?: TerrainColliderRemoteBuilder | null;
}

interface ColliderMeshSource {
  positions: Float32Array;
  indices: Uint32Array;
}

interface ColliderEntry {
  id: string;
  footprint: TerrainColliderFootprint;
  source: ColliderMeshSource | null;
  geometry: THREE.BufferGeometry | null;
  boundsTree: MeshBVH | null;
  /** Terrain revision the collision geometry was built from (0 = initial/unknown). */
  revision: number;
}

interface ColliderRebuildJob {
  pageId: string;
  /** Immutable snapshot at enqueue time; later origin shifts translate this snapshot too. */
  replacement: ColliderEntry;
  /** The live entry this job is allowed to replace. Object identity is the revision token. */
  expectedEntry: ColliderEntry;
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

function copyGeometrySource(geometry: THREE.BufferGeometry): ColliderMeshSource {
  const position = geometry.getAttribute("position");
  if (!position) throw new Error("Collider geometry needs a position attribute");

  const positions = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    positions[i * 3] = position.getX(i);
    positions[i * 3 + 1] = position.getY(i);
    positions[i * 3 + 2] = position.getZ(i);
  }

  const sourceIndex = geometry.getIndex();
  const indices = new Uint32Array(sourceIndex?.count ?? position.count);
  if (sourceIndex) {
    for (let i = 0; i < sourceIndex.count; i++) indices[i] = sourceIndex.getX(i);
  } else {
    for (let i = 0; i < position.count; i++) indices[i] = i;
  }
  return { positions, indices };
}

function copyPageMeshSource(mesh: PageMesh): ColliderMeshSource {
  return {
    positions: new Float32Array(mesh.positions),
    indices: new Uint32Array(mesh.indices),
  };
}

function geometryFromSource(source: ColliderMeshSource): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(source.positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(source.indices), 1));
  return geometry;
}

function workerInputFromSource(source: ColliderMeshSource): TerrainColliderBuildInput {
  const positions = new Float32Array(source.positions);
  const vertexCount = positions.length / 3;
  const indices = vertexCount <= 0xffff
    ? Uint16Array.from(source.indices)
    : new Uint32Array(source.indices);
  return { positions, indices };
}

function rayCanHitFootprint(ray: THREE.Ray, footprint: TerrainColliderFootprint): boolean {
  tempRayBox.min.set(footprint.minX, -10000, footprint.minZ);
  tempRayBox.max.set(footprint.maxX, 10000, footprint.maxZ);
  return ray.intersectsBox(tempRayBox);
}

function translateSource(source: ColliderMeshSource, dx: number, dz: number): void {
  for (let i = 0; i < source.positions.length; i += 3) {
    source.positions[i] += dx;
    source.positions[i + 2] += dz;
  }
}

function entryFromPage(page: TerrainColliderPage, revision = 0): ColliderEntry {
  if (!page.geometry && !page.mesh) throw new Error(`Collider page ${page.id} needs geometry or mesh source`);
  return {
    id: page.id,
    footprint: { ...page.footprint },
    source: page.geometry ? copyGeometrySource(page.geometry) : copyPageMeshSource(page.mesh!),
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
  private remoteBuilder: TerrainColliderRemoteBuilder | null;
  private activeJob: ColliderRebuildJob | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private asyncDrainActive = false;
  private pipelineBuildActive = false;
  private translationEpoch = 0;
  private disposed = false;

  constructor(
    pages: readonly TerrainColliderPage[],
    private readonly heightFallback: TerrainHeightFallback | null = null,
    options: TerrainColliderSetOptions = {},
  ) {
    this.diagnostics = options.diagnostics ?? gameplayDiagnostics;
    this.autoProcessRebuilds = options.autoProcessRebuilds ?? false;
    this.remoteBuilder = options.remoteBuilder === undefined
      ? createTerrainColliderRemoteBuilder()
      : options.remoteBuilder;
    this.entries = new Map(pages.map((page) => [page.id, entryFromPage(page)]));
    for (const entry of this.entries.values()) this.indexEntry(entry);
  }

  loadedPageCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.boundsTree !== null) count++;
    return count;
  }

  /** Build every page synchronously. Tools/tests use this deterministic path. */
  prewarmAll(): void {
    this.pipelineBuildActive = true;
    try {
      for (const entry of this.entries.values()) this.ensureEntry(entry);
    } finally {
      this.pipelineBuildActive = false;
    }
  }

  /** Build every page in the worker before gameplay starts; falls back loudly in counters. */
  async prewarmAllAsync(): Promise<void> {
    for (const entry of this.entries.values()) {
      while (!this.disposed && !entry.boundsTree) {
        const buildEpoch = this.translationEpoch;
        const result = await this.requestRemoteBuild(entry);
        if (this.disposed) return;
        if (buildEpoch !== this.translationEpoch) continue;
        if (result) this.applyRemoteBuild(entry, result);
        else this.buildEntryAsPipelineFallback(entry);
      }
    }
  }

  pageCount(): number {
    return this.entries.size;
  }

  translateHorizontal(dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    this.translationEpoch++;
    for (const entry of this.entries.values()) {
      entry.footprint.minX += dx;
      entry.footprint.maxX += dx;
      entry.footprint.minZ += dz;
      entry.footprint.maxZ += dz;
      if (entry.source) translateSource(entry.source, dx, dz);
      if (entry.geometry && entry.boundsTree) {
        entry.geometry.translate(dx, 0, dz);
        entry.boundsTree.refit();
      }
    }
    for (const job of this.pendingJobs.values()) this.translateJob(job, dx, dz);
    if (this.activeJob) this.translateJob(this.activeJob, dx, dz);
    this.rebuildSpatialIndex();
  }

  private translateJob(job: ColliderRebuildJob, dx: number, dz: number): void {
    const replacement = job.replacement;
    replacement.footprint.minX += dx;
    replacement.footprint.maxX += dx;
    replacement.footprint.minZ += dz;
    replacement.footprint.maxZ += dz;
    if (replacement.source) translateSource(replacement.source, dx, dz);
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
    if (!entry.source) throw new Error(`Collider page ${entry.id} has no source geometry`);
    const startedAt = performance.now();
    const geometry = geometryFromSource(entry.source);
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

  private async requestRemoteBuild(entry: ColliderEntry): Promise<TerrainColliderBuildResult | null> {
    const builder = this.remoteBuilder;
    if (!entry.source || !builder?.available()) return null;
    try {
      const result = await builder.build(workerInputFromSource(entry.source));
      this.diagnostics.add("collider_build_count");
      this.diagnostics.add("collider_build_total_ms", result.buildMs);
      this.diagnostics.add("collider_worker_build_count");
      this.diagnostics.add("collider_worker_build_total_ms", result.buildMs);
      return result;
    } catch {
      this.diagnostics.add("collider_worker_failures");
      if (this.remoteBuilder === builder) {
        builder.dispose();
        this.remoteBuilder = null;
      }
      return null;
    }
  }

  private applyRemoteBuild(entry: ColliderEntry, result: TerrainColliderBuildResult): void {
    if (!entry.source) throw new Error(`Collider page ${entry.id} has no source geometry`);
    const geometry = geometryFromSource(entry.source);
    geometry.computeBoundingBox();
    entry.geometry = geometry;
    entry.boundsTree = MeshBVH.deserialize(result.serialized, geometry);
  }

  private buildEntryAsPipelineFallback(entry: ColliderEntry): void {
    this.diagnostics.add("collider_worker_fallback_builds");
    this.pipelineBuildActive = true;
    try {
      this.ensureEntry(entry);
    } finally {
      this.pipelineBuildActive = false;
    }
  }

  private disposeEntry(entry: ColliderEntry): void {
    entry.geometry?.dispose();
    entry.geometry = null;
    entry.source = null;
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

  /** Synchronous replacement for deterministic tools/tests. Runtime callers must schedule. */
  updatePage(id: string, source: THREE.BufferGeometry | PageMesh, terrainRevision = 0): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.cancelPendingJob(id);
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
    this.cancelPendingJob(page.id);
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
    this.cancelPendingJob(id);
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
      if (this.hasRebuildFor(entry.id)) replacementPending = true;
    }
    return { covered, revision, replacementPending };
  }

  /** Queue a revision-validated replacement while the old collider continues serving. */
  schedulePageUpdate(id: string, source: THREE.BufferGeometry | PageMesh, terrainRevision = 0): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.cancelPendingJob(id);
    const replacement = entryFromPage(
      {
        id,
        footprint: entry.footprint,
        ...(source instanceof THREE.BufferGeometry ? { geometry: source } : { mesh: source }),
      },
      terrainRevision,
    );
    this.pendingJobs.set(id, {
      pageId: id,
      replacement,
      expectedEntry: entry,
      enqueuedAtMs: performance.now(),
    });
    this.diagnostics.add("collider_jobs_queued");
    this.publishQueueGauges();
    this.armRebuildTimer();
    return true;
  }

  pendingRebuildCount(): number {
    return this.pendingJobs.size + (this.activeJob ? 1 : 0);
  }

  /** Deterministic synchronous drain for tests/tools. Runtime auto-drain uses the worker. */
  processPendingRebuilds(maxJobs = 1): number {
    if (this.activeJob || this.asyncDrainActive) return 0;
    let processed = 0;
    while (processed < maxJobs) {
      const first = this.pendingJobs.entries().next();
      if (first.done) break;
      const [id, job] = first.value;
      this.pendingJobs.delete(id);
      processed++;
      const current = this.entries.get(id);
      if (!current || current !== job.expectedEntry) {
        this.discardJob(job);
        this.diagnostics.add("collider_jobs_cancelled_stale");
        continue;
      }
      if (current.boundsTree) this.buildEntryAsPipelineFallback(job.replacement);
      this.installReplacement(job, current);
    }
    this.publishQueueGauges();
    return processed;
  }

  /** Worker-backed drain. Old colliders serve until a validated result installs atomically. */
  async processPendingRebuildsAsync(maxJobs = 1): Promise<number> {
    if (this.asyncDrainActive) return 0;
    this.asyncDrainActive = true;
    let processed = 0;
    try {
      while (!this.disposed && processed < maxJobs) {
        const first = this.pendingJobs.entries().next();
        if (first.done) break;
        const [id, job] = first.value;
        this.pendingJobs.delete(id);
        this.activeJob = job;
        this.publishQueueGauges();
        processed++;

        const current = this.entries.get(id);
        if (!current || current !== job.expectedEntry) {
          this.discardJob(job);
          this.diagnostics.add("collider_jobs_cancelled_stale");
          this.activeJob = null;
          continue;
        }

        let result: TerrainColliderBuildResult | null = null;
        const buildEpoch = this.translationEpoch;
        if (current.boundsTree) result = await this.requestRemoteBuild(job.replacement);
        if (this.disposed) break;

        if (this.pendingJobs.has(id) || this.entries.get(id) !== job.expectedEntry) {
          this.discardJob(job);
          this.diagnostics.add("collider_jobs_cancelled_stale");
          this.activeJob = null;
          continue;
        }

        if (buildEpoch !== this.translationEpoch) {
          this.pendingJobs.set(id, job);
          this.diagnostics.add("collider_jobs_requeued_origin_shift");
          this.activeJob = null;
          break;
        }

        if (current.boundsTree) {
          const applyStartedAt = performance.now();
          if (result) {
            try {
              this.applyRemoteBuild(job.replacement, result);
            } catch {
              this.diagnostics.add("collider_worker_failures");
              this.buildEntryAsPipelineFallback(job.replacement);
            }
          } else {
            this.buildEntryAsPipelineFallback(job.replacement);
          }
          this.diagnostics.set("collider_apply_ms", performance.now() - applyStartedAt);
        }
        this.installReplacement(job, current);
        this.activeJob = null;
      }
    } finally {
      this.activeJob = null;
      this.asyncDrainActive = false;
      this.publishQueueGauges();
    }
    return processed;
  }

  private installReplacement(job: ColliderRebuildJob, current: ColliderEntry): void {
    const applyStartedAt = performance.now();
    this.entries.set(job.pageId, job.replacement);
    this.disposeEntry(current);
    const now = performance.now();
    this.diagnostics.add("collider_jobs_completed");
    this.diagnostics.set("collider_apply_ms", Math.max(this.diagnostics.get("collider_apply_ms"), now - applyStartedAt));
    this.diagnostics.set("collider_queue_latency_ms", now - job.enqueuedAtMs);
    this.diagnostics.setMax("collider_queue_latency_max_ms", now - job.enqueuedAtMs);
  }

  private hasRebuildFor(id: string): boolean {
    return this.pendingJobs.has(id) || this.activeJob?.pageId === id;
  }

  private cancelPendingJob(id: string): void {
    const pending = this.pendingJobs.get(id);
    if (!pending) return;
    this.pendingJobs.delete(id);
    this.discardJob(pending);
    this.diagnostics.add("collider_jobs_cancelled_stale");
    this.publishQueueGauges();
  }

  private discardJob(job: ColliderRebuildJob): void {
    this.disposeEntry(job.replacement);
  }

  private publishQueueGauges(): void {
    this.diagnostics.set("collider_jobs_inflight", this.pendingJobs.size + (this.activeJob ? 1 : 0));
  }

  private armRebuildTimer(): void {
    if (!this.autoProcessRebuilds || this.rebuildTimer !== null || this.asyncDrainActive || this.pendingJobs.size === 0) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      void this.processPendingRebuildsAsync(1).finally(() => this.armRebuildTimer());
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
      if (this.hasRebuildFor(entry.id)) staleTested = true;
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

    const fallback = this.applyHeightFallback(resolvedPosition, resolvedVelocity, grounded);

    if (staleTested) this.diagnostics.add("collider_stale_frames");
    if (fallback.fired) this.diagnostics.add("fallback_heightfield_certified");
    if (fallback.deniedUncertified) this.diagnostics.add("fallback_denied_uncertified");
    if (!fallback.grounded) {
      if (pagesTested > 0) {
        this.diagnostics.add("collider_exact_no_ground");
      } else if (this.heightFallback?.enabled && this.columnCertifiedForFallback(resolvedPosition.x, resolvedPosition.z)) {
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
    if (this.disposed) return;
    this.disposed = true;
    if (this.rebuildTimer !== null) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    this.remoteBuilder?.dispose();
    this.remoteBuilder = null;
    for (const job of this.pendingJobs.values()) this.discardJob(job);
    this.pendingJobs.clear();
    if (this.activeJob) this.discardJob(this.activeJob);
    this.activeJob = null;
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.spatialCells.clear();
    this.entryCells.clear();
    this.publishQueueGauges();
  }
}
