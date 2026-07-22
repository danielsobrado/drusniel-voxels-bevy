import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import type { PageMesh } from "../types.js";
import type { GameplayDiagnostics } from "../player/gameplay_diagnostics.js";
import type {
  TerrainColliderBuildResult,
} from "./terrain_collider_worker_client.js";
import type {
  TerrainColliderFootprint,
  TerrainColliderPage,
} from "./terrain_collider.js";

export interface ColliderMeshSource {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface ColliderEntry {
  id: string;
  footprint: TerrainColliderFootprint;
  source: ColliderMeshSource | null;
  geometry: THREE.BufferGeometry | null;
  boundsTree: MeshBVH | null;
  /** Terrain revision the collision geometry was built from (0 = initial/unknown). */
  revision: number;
}

export interface ColliderRebuildJob {
  pageId: string;
  /** Immutable snapshot at enqueue time; later origin shifts translate this snapshot too. */
  replacement: ColliderEntry;
  /** The live entry this job is allowed to replace. Object identity is the revision token. */
  expectedEntry: ColliderEntry;
  enqueuedAtMs: number;
}

export interface TerrainColliderRebuildQueueDeps {
  diagnostics: GameplayDiagnostics;
  autoProcessRebuilds: boolean;
  getEntry: (id: string) => ColliderEntry | undefined;
  setEntry: (id: string, entry: ColliderEntry) => void;
  getTranslationEpoch: () => number;
  isDisposed: () => boolean;
  requestRemoteBuild: (entry: ColliderEntry) => Promise<TerrainColliderBuildResult | null>;
  applyRemoteBuild: (entry: ColliderEntry, result: TerrainColliderBuildResult) => void;
  buildEntryAsPipelineFallback: (entry: ColliderEntry) => void;
  ensureEntry: (entry: ColliderEntry) => MeshBVH;
  disposeEntry: (entry: ColliderEntry) => void;
  indexEntry: (entry: ColliderEntry) => void;
  unindexEntry: (id: string) => void;
  entryFromPage: (page: TerrainColliderPage, revision?: number) => ColliderEntry;
  translateSource: (source: ColliderMeshSource, dx: number, dz: number) => void;
}

export interface TerrainColliderRebuildQueue {
  scheduleInitialUpsert(page: TerrainColliderPage): void;
  takePendingInitial(id: string): ColliderEntry | undefined;
  schedulePageUpdate(id: string, source: THREE.BufferGeometry | PageMesh, terrainRevision?: number): boolean;
  enqueueReplacement(pageId: string, replacement: ColliderEntry, expectedEntry: ColliderEntry): void;
  pendingRebuildCount(): number;
  processPendingRebuilds(maxJobs?: number): number;
  processPendingRebuildsAsync(maxJobs?: number): Promise<number>;
  hasRebuildFor(id: string): boolean;
  cancelPendingJob(id: string): void;
  translatePending(dx: number, dz: number): void;
  publishQueueGauges(): void;
  armRebuildTimer(): void;
  dispose(): void;
}

export function createTerrainColliderRebuildQueue(
  deps: TerrainColliderRebuildQueueDeps,
): TerrainColliderRebuildQueue {
  const pendingJobs = new Map<string, ColliderRebuildJob>();
  const pendingInitialBuilds = new Map<string, ColliderEntry>();
  let activeJob: ColliderRebuildJob | null = null;
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let asyncDrainActive = false;

  const discardJob = (job: ColliderRebuildJob): void => {
    deps.disposeEntry(job.replacement);
  };

  const publishQueueGauges = (): void => {
    deps.diagnostics.set(
      "collider_jobs_inflight",
      pendingJobs.size + pendingInitialBuilds.size + (activeJob ? 1 : 0),
    );
  };

  const cancelPendingJob = (id: string): void => {
    const pending = pendingJobs.get(id);
    if (!pending) return;
    pendingJobs.delete(id);
    discardJob(pending);
    deps.diagnostics.add("collider_jobs_cancelled_stale");
    publishQueueGauges();
  };

  const installReplacement = (job: ColliderRebuildJob, current: ColliderEntry): void => {
    const applyStartedAt = performance.now();
    deps.setEntry(job.pageId, job.replacement);
    deps.disposeEntry(current);
    const now = performance.now();
    deps.diagnostics.add("collider_jobs_completed");
    deps.diagnostics.set("collider_apply_ms", Math.max(deps.diagnostics.get("collider_apply_ms"), now - applyStartedAt));
    deps.diagnostics.set("collider_queue_latency_ms", now - job.enqueuedAtMs);
    deps.diagnostics.setMax("collider_queue_latency_max_ms", now - job.enqueuedAtMs);
  };

  const translateJob = (job: ColliderRebuildJob, dx: number, dz: number): void => {
    const replacement = job.replacement;
    replacement.footprint.minX += dx;
    replacement.footprint.maxX += dx;
    replacement.footprint.minZ += dz;
    replacement.footprint.maxZ += dz;
    if (replacement.source) deps.translateSource(replacement.source, dx, dz);
  };

  const armRebuildTimer = (): void => {
    if (!deps.autoProcessRebuilds || rebuildTimer !== null || asyncDrainActive || pendingJobs.size === 0) return;
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      void processPendingRebuildsAsync(1).finally(() => armRebuildTimer());
    }, 0);
  };

  const processPendingRebuilds = (maxJobs = 1): number => {
    if (activeJob || asyncDrainActive) return 0;
    let processed = 0;
    while (processed < maxJobs) {
      const first = pendingJobs.entries().next();
      if (first.done) break;
      const [id, job] = first.value;
      pendingJobs.delete(id);
      processed++;
      const current = deps.getEntry(id);
      if (!current || current !== job.expectedEntry) {
        discardJob(job);
        deps.diagnostics.add("collider_jobs_cancelled_stale");
        continue;
      }
      if (current.boundsTree) deps.buildEntryAsPipelineFallback(job.replacement);
      installReplacement(job, current);
    }
    publishQueueGauges();
    return processed;
  };

  const processPendingRebuildsAsync = async (maxJobs = 1): Promise<number> => {
    if (asyncDrainActive) return 0;
    asyncDrainActive = true;
    let processed = 0;
    try {
      while (!deps.isDisposed() && processed < maxJobs) {
        const first = pendingJobs.entries().next();
        if (first.done) break;
        const [id, job] = first.value;
        pendingJobs.delete(id);
        activeJob = job;
        publishQueueGauges();
        processed++;

        const current = deps.getEntry(id);
        if (!current || current !== job.expectedEntry) {
          discardJob(job);
          deps.diagnostics.add("collider_jobs_cancelled_stale");
          activeJob = null;
          continue;
        }

        let result: TerrainColliderBuildResult | null = null;
        const buildEpoch = deps.getTranslationEpoch();
        if (current.boundsTree) result = await deps.requestRemoteBuild(job.replacement);
        if (deps.isDisposed()) break;

        if (pendingJobs.has(id) || deps.getEntry(id) !== job.expectedEntry) {
          discardJob(job);
          deps.diagnostics.add("collider_jobs_cancelled_stale");
          activeJob = null;
          continue;
        }

        if (buildEpoch !== deps.getTranslationEpoch()) {
          pendingJobs.set(id, job);
          deps.diagnostics.add("collider_jobs_requeued_origin_shift");
          activeJob = null;
          break;
        }

        if (current.boundsTree) {
          const applyStartedAt = performance.now();
          if (result) {
            try {
              deps.applyRemoteBuild(job.replacement, result);
            } catch {
              deps.diagnostics.add("collider_worker_failures");
              deps.buildEntryAsPipelineFallback(job.replacement);
            }
          } else {
            deps.buildEntryAsPipelineFallback(job.replacement);
          }
          deps.diagnostics.set("collider_apply_ms", performance.now() - applyStartedAt);
        }
        installReplacement(job, current);
        activeJob = null;
      }
    } finally {
      activeJob = null;
      asyncDrainActive = false;
      publishQueueGauges();
    }
    return processed;
  };

  const buildAndInstallInitialUpsert = async (entry: ColliderEntry): Promise<void> => {
    while (!deps.isDisposed() && pendingInitialBuilds.get(entry.id) === entry) {
      const buildEpoch = deps.getTranslationEpoch();
      const result = await deps.requestRemoteBuild(entry);
      if (deps.isDisposed() || pendingInitialBuilds.get(entry.id) !== entry) break;
      if (buildEpoch !== deps.getTranslationEpoch()) continue;
      if (result) {
        try {
          deps.applyRemoteBuild(entry, result);
        } catch {
          deps.diagnostics.add("collider_worker_failures");
          deps.buildEntryAsPipelineFallback(entry);
        }
      } else {
        deps.buildEntryAsPipelineFallback(entry);
      }
      if (deps.isDisposed() || pendingInitialBuilds.get(entry.id) !== entry) break;
      pendingInitialBuilds.delete(entry.id);
      deps.setEntry(entry.id, entry);
      deps.unindexEntry(entry.id);
      deps.indexEntry(entry);
      deps.diagnostics.add("collider_jobs_completed");
      publishQueueGauges();
      return;
    }
    deps.disposeEntry(entry);
    publishQueueGauges();
  };

  const scheduleInitialUpsert = (page: TerrainColliderPage): void => {
    const replacement = deps.entryFromPage(page);
    pendingInitialBuilds.set(page.id, replacement);
    deps.diagnostics.add("collider_jobs_queued");
    publishQueueGauges();
    void buildAndInstallInitialUpsert(replacement);
  };

  return {
    scheduleInitialUpsert,
    takePendingInitial(id) {
      const pending = pendingInitialBuilds.get(id);
      if (pending) pendingInitialBuilds.delete(id);
      return pending;
    },
    schedulePageUpdate(id, source, terrainRevision = 0) {
      const entry = deps.getEntry(id);
      if (!entry) return false;
      cancelPendingJob(id);
      const replacement = deps.entryFromPage(
        {
          id,
          footprint: entry.footprint,
          ...(source instanceof THREE.BufferGeometry ? { geometry: source } : { mesh: source }),
        },
        terrainRevision,
      );
      pendingJobs.set(id, {
        pageId: id,
        replacement,
        expectedEntry: entry,
        enqueuedAtMs: performance.now(),
      });
      deps.diagnostics.add("collider_jobs_queued");
      publishQueueGauges();
      armRebuildTimer();
      return true;
    },
    enqueueReplacement(pageId, replacement, expectedEntry) {
      pendingJobs.set(pageId, {
        pageId,
        replacement,
        expectedEntry,
        enqueuedAtMs: performance.now(),
      });
      deps.diagnostics.add("collider_jobs_queued");
      publishQueueGauges();
      armRebuildTimer();
    },
    pendingRebuildCount() {
      return pendingJobs.size + pendingInitialBuilds.size + (activeJob ? 1 : 0);
    },
    processPendingRebuilds,
    processPendingRebuildsAsync,
    hasRebuildFor(id) {
      return pendingJobs.has(id) || activeJob?.pageId === id;
    },
    cancelPendingJob,
    translatePending(dx, dz) {
      for (const job of pendingJobs.values()) translateJob(job, dx, dz);
      if (activeJob) translateJob(activeJob, dx, dz);
      for (const entry of pendingInitialBuilds.values()) {
        entry.footprint.minX += dx;
        entry.footprint.maxX += dx;
        entry.footprint.minZ += dz;
        entry.footprint.maxZ += dz;
        if (entry.source) deps.translateSource(entry.source, dx, dz);
      }
    },
    publishQueueGauges,
    armRebuildTimer,
    dispose() {
      if (rebuildTimer !== null) {
        clearTimeout(rebuildTimer);
        rebuildTimer = null;
      }
      for (const job of pendingJobs.values()) discardJob(job);
      pendingJobs.clear();
      pendingInitialBuilds.clear();
      if (activeJob) discardJob(activeJob);
      activeJob = null;
      publishQueueGauges();
    },
  };
}
