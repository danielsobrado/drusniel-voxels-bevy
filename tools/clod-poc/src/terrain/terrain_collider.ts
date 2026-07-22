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
import {
  terrainColliderRaycastSpawn,
  terrainColliderRaycastSurface,
  terrainColliderResolveCapsule,
  type TerrainColliderQueryDeps,
} from "./terrain_collider_queries.js";
import {
  createTerrainColliderRebuildQueue,
  type ColliderEntry,
  type ColliderMeshSource,
  type TerrainColliderRebuildQueue,
} from "./terrain_collider_rebuild_queue.js";
import {
  COLLIDER_SPATIAL_CELL_SIZE,
  createTerrainColliderSpatialIndex,
  footprintContainsPoint,
  type TerrainColliderSpatialIndex,
} from "./terrain_collider_spatial_index.js";

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

export class TerrainColliderSet {
  private readonly entries: Map<string, ColliderEntry>;
  private readonly spatial: TerrainColliderSpatialIndex;
  private readonly rebuildQueue: TerrainColliderRebuildQueue;
  private readonly diagnostics: GameplayDiagnostics;
  private readonly autoProcessRebuilds: boolean;
  private remoteBuilder: TerrainColliderRemoteBuilder | null;
  private pipelineBuildActive = false;
  private translationEpoch = 0;
  private disposed = false;
  private readonly queryDeps: TerrainColliderQueryDeps<ColliderEntry>;

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
    this.spatial = createTerrainColliderSpatialIndex();
    this.entries = new Map(pages.map((page) => [page.id, entryFromPage(page)]));
    for (const entry of this.entries.values()) this.spatial.indexEntry(entry);

    this.rebuildQueue = createTerrainColliderRebuildQueue({
      diagnostics: this.diagnostics,
      autoProcessRebuilds: this.autoProcessRebuilds,
      getEntry: (id) => this.entries.get(id),
      setEntry: (id, entry) => { this.entries.set(id, entry); },
      getTranslationEpoch: () => this.translationEpoch,
      isDisposed: () => this.disposed,
      requestRemoteBuild: (entry) => this.requestRemoteBuild(entry),
      applyRemoteBuild: (entry, result) => this.applyRemoteBuild(entry, result),
      buildEntryAsPipelineFallback: (entry) => this.buildEntryAsPipelineFallback(entry),
      ensureEntry: (entry) => this.ensureEntry(entry),
      disposeEntry: (entry) => this.disposeEntry(entry),
      indexEntry: (entry) => this.spatial.indexEntry(entry),
      unindexEntry: (id) => this.spatial.unindexEntry(id),
      entryFromPage,
      translateSource,
    });

    this.queryDeps = {
      entriesForRay: (ray, maxDistance) => this.entriesForRay(ray, maxDistance),
      entriesForBox: (box) => this.entriesForBox(box),
      ensureEntry: (entry) => this.ensureEntry(entry),
      hasRebuildFor: (id) => this.rebuildQueue.hasRebuildFor(id),
      heightFallback: this.heightFallback,
      diagnostics: this.diagnostics,
    };
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
    this.rebuildQueue.translatePending(dx, dz);
    this.spatial.rebuild(this.entries.values());
  }

  private resolveEntry = (id: string): ColliderEntry | undefined => this.entries.get(id);

  private entriesForRay(ray: THREE.Ray, maxDistance: number): ColliderEntry[] {
    return this.spatial.entriesForRay(ray, maxDistance, this.resolveEntry, () => this.entries.values());
  }

  private entriesForBox(box: THREE.Box3): ColliderEntry[] {
    return this.spatial.entriesForBox(box, this.resolveEntry);
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

  raycastSpawn(ray: THREE.Ray): TerrainSpawnHit | null {
    return terrainColliderRaycastSpawn(this.queryDeps, ray);
  }

  /** Nearest terrain hit with no slope filter — walls and ceilings count (dig targeting). */
  raycastSurface(ray: THREE.Ray, maxDistance = Number.POSITIVE_INFINITY): TerrainSurfaceHit | null {
    return terrainColliderRaycastSurface(this.queryDeps, ray, maxDistance);
  }

  /** Synchronous replacement for deterministic tools/tests. Runtime callers must schedule. */
  updatePage(id: string, source: THREE.BufferGeometry | PageMesh, terrainRevision = 0): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.rebuildQueue.cancelPendingJob(id);
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
    this.rebuildQueue.takePendingInitial(page.id);
    if (this.autoProcessRebuilds) {
      const previous = this.entries.get(page.id);
      if (previous) {
        this.rebuildQueue.cancelPendingJob(page.id);
        const replacement = entryFromPage(page);
        this.rebuildQueue.enqueueReplacement(page.id, replacement, previous);
      } else {
        this.rebuildQueue.scheduleInitialUpsert(page);
      }
      return;
    }
    this.rebuildQueue.cancelPendingJob(page.id);
    const previous = this.entries.get(page.id);
    const replacement = entryFromPage(page);
    if (previous?.boundsTree) this.ensureEntry(replacement);
    this.entries.set(page.id, replacement);
    this.spatial.unindexEntry(page.id);
    this.spatial.indexEntry(replacement);
    if (previous) this.disposeEntry(previous);
  }

  removePage(id: string): boolean {
    const pendingInitial = this.rebuildQueue.takePendingInitial(id);
    if (pendingInitial) this.rebuildQueue.publishQueueGauges();
    const entry = this.entries.get(id);
    if (!entry) return pendingInitial !== undefined;
    this.entries.delete(id);
    this.spatial.unindexEntry(id);
    this.disposeEntry(entry);
    this.rebuildQueue.cancelPendingJob(id);
    return true;
  }

  /** A collider page (loaded or lazily buildable) covers this world column. */
  coversPoint(x: number, z: number): boolean {
    return this.spatial.coversPoint(x, z, this.resolveEntry);
  }

  colliderStatusAt(x: number, z: number): TerrainColliderStatus {
    const key = `${Math.floor(x / COLLIDER_SPATIAL_CELL_SIZE)},${Math.floor(z / COLLIDER_SPATIAL_CELL_SIZE)}`;
    let covered = false;
    let revision = -1;
    let replacementPending = false;
    for (const entry of this.spatial.entriesForCellKeys([key], this.resolveEntry)) {
      if (!footprintContainsPoint(entry.footprint, x, z)) continue;
      covered = true;
      revision = Math.max(revision, entry.revision);
      if (this.rebuildQueue.hasRebuildFor(entry.id)) replacementPending = true;
    }
    return { covered, revision, replacementPending };
  }

  /** Queue a revision-validated replacement while the old collider continues serving. */
  schedulePageUpdate(id: string, source: THREE.BufferGeometry | PageMesh, terrainRevision = 0): boolean {
    return this.rebuildQueue.schedulePageUpdate(id, source, terrainRevision);
  }

  pendingRebuildCount(): number {
    return this.rebuildQueue.pendingRebuildCount();
  }

  /** Deterministic synchronous drain for tests/tools. Runtime auto-drain uses the worker. */
  processPendingRebuilds(maxJobs = 1): number {
    return this.rebuildQueue.processPendingRebuilds(maxJobs);
  }

  /** Worker-backed drain. Old colliders serve until a validated result installs atomically. */
  async processPendingRebuildsAsync(maxJobs = 1): Promise<number> {
    return this.rebuildQueue.processPendingRebuildsAsync(maxJobs);
  }

  resolveCapsule(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    config: CapsuleCollisionConfig,
  ): CapsuleCollisionResult {
    return terrainColliderResolveCapsule(this.queryDeps, position, velocity, config);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rebuildQueue.dispose();
    this.remoteBuilder?.dispose();
    this.remoteBuilder = null;
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.spatial.clear();
    this.rebuildQueue.publishQueueGauges();
  }
}
