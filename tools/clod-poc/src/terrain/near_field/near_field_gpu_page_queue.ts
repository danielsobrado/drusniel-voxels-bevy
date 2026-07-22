import { getDigEditsSnapshot } from "../../terrain/terrain.js";
import { resolveDigEdits } from "../../gpu/terrain_field_core.js";
import type { ChunkMesh, GpuChunkMesher } from "../../gpu/gpu_chunk_mesher.js";
import { setVoxelOverlayResidentBounds } from "../voxel_overlay/voxel_overlay.js";
import type { WorldBounds } from "../../terrain/terrain_surface.js";
import type { TerrainColliderSet } from "../../terrain/terrain_collider.js";
import {
  GPU_APPLY_BUDGET_MS,
  GPU_PAGE_RETRY_DELAY_FRAMES,
  GPU_PAGE_RETRY_LIMIT,
} from "./near_field_bubble_budgets.js";
import {
  chunkColliderId,
  liveBubbleChunkFootprint,
  type ChunkGroupEntry,
  type NearFieldBubbleSceneApply,
} from "./near_field_bubble_scene_apply.js";

export interface PendingGpuPageBuild {
  px: number;
  pz: number;
  worldBounds: WorldBounds;
  edits: ReturnType<typeof resolveDigEdits>;
  chunks: Array<[number, number]>;
  inflight: number;
  failures: number;
  attempts: number;
  nextRetryFrame: number;
  meshChunks: number;
  emptyChunks: number;
  startedAtMs: number;
}

export interface PendingGpuWaitPageBuild {
  px: number;
  pz: number;
}

export function pageChunks(chunksPerPage: number): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  for (let dz = 0; dz < chunksPerPage; dz++) {
    for (let dx = 0; dx < chunksPerPage; dx++) chunks.push([dx, dz]);
  }
  return chunks;
}

export interface NearFieldGpuPageQueueDeps {
  pending: Map<string, PendingGpuPageBuild>;
  wait: Map<string, PendingGpuWaitPageBuild>;
  applyQueue: Array<{
    key: string;
    entry: ChunkGroupEntry;
    job: PendingGpuPageBuild;
    dx: number;
    dz: number;
    cm: ChunkMesh;
  }>;
  cpuPendingHas: (key: string) => boolean;
  enqueueCpuChunk: (key: string, px: number, pz: number, worldBounds: WorldBounds, dx: number, dz: number) => void;
  getEntry: (key: string) => ChunkGroupEntry | undefined;
  getGpuMesher: () => GpuChunkMesher | null;
  buildWorldBoundsForPage: (px: number, pz: number) => WorldBounds;
  getFrame: () => number;
  liveStreamingEnabled: boolean;
  terrainColliders: TerrainColliderSet | null;
  chunksPerPage: number;
  chunkSize: number;
  dispatchBudget: number;
  maxInflightChunks: number;
  sceneApply: NearFieldBubbleSceneApply;
  onGpuRetry: () => void;
  onGpuTerminalFailure: () => void;
  onChunkMs: (ms: number) => void;
  onSlowestPageMs: (ms: number) => void;
  onApplyMs: (ms: number) => void;
}

export interface NearFieldGpuPageQueue {
  enqueuePageBuild: (
    key: string,
    px: number,
    pz: number,
    worldBounds: WorldBounds,
    attempts?: number,
    nextRetryFrame?: number,
  ) => void;
  enqueueWait: (key: string, px: number, pz: number) => void;
  promoteWaitBuilds: () => void;
  drainApplyQueue: (deadlineMs?: number) => void;
  drainPendingBuilds: () => void;
  countChunks: () => { pendingChunks: number; inflightChunks: number };
  retryPages: () => number;
  delete: (key: string) => void;
}

export function createNearFieldGpuPageQueue(deps: NearFieldGpuPageQueueDeps): NearFieldGpuPageQueue {
  const { chunksPerPage: P, chunkSize: S } = deps;

  const enqueuePageBuild: NearFieldGpuPageQueue["enqueuePageBuild"] = (
    key,
    px,
    pz,
    worldBounds,
    attempts = 0,
    nextRetryFrame = 0,
  ) => {
    const edits = resolveDigEdits(getDigEditsSnapshot());
    deps.pending.set(key, {
      px,
      pz,
      worldBounds,
      edits,
      chunks: pageChunks(P),
      inflight: 0,
      failures: 0,
      attempts,
      nextRetryFrame,
      meshChunks: 0,
      emptyChunks: 0,
      startedAtMs: performance.now(),
    });
  };

  const enqueueWait: NearFieldGpuPageQueue["enqueueWait"] = (key, px, pz) => {
    deps.wait.set(key, { px, pz });
  };

  const countInflightChunks = (): number => {
    let inflightChunks = 0;
    for (const job of deps.pending.values()) inflightChunks += job.inflight;
    return inflightChunks;
  };

  const retryGpuPageBuild = (key: string, entry: ChunkGroupEntry, job: PendingGpuPageBuild): boolean => {
    if (!deps.liveStreamingEnabled || job.attempts >= GPU_PAGE_RETRY_LIMIT) return false;
    deps.sceneApply.clearEntryContent(entry);
    entry.ready = false;
    entry.failed = false;
    entry.validEmpty = false;
    deps.onGpuRetry();
    enqueuePageBuild(key, job.px, job.pz, job.worldBounds, job.attempts + 1, deps.getFrame() + GPU_PAGE_RETRY_DELAY_FRAMES);
    return true;
  };

  const completeGpuChunk = (key: string, entry: ChunkGroupEntry, job: PendingGpuPageBuild) => {
    job.inflight--;
    if (deps.getEntry(key) !== entry || deps.pending.get(key) !== job) return;
    if (job.chunks.length > 0 || job.inflight > 0) return;
    deps.pending.delete(key);
    if (deps.cpuPendingHas(key)) return;

    if (job.failures > 0 && retryGpuPageBuild(key, entry, job)) return;
    if (job.failures > 0) deps.onGpuTerminalFailure();
    entry.failed = job.failures > 0;
    entry.validEmpty = job.failures === 0 && job.meshChunks === 0;
    entry.ready = true;
    setVoxelOverlayResidentBounds(key, entry.voxelOverlayBounds);
    deps.onSlowestPageMs(performance.now() - job.startedAtMs);
  };

  const promoteWaitBuilds: NearFieldGpuPageQueue["promoteWaitBuilds"] = () => {
    if (deps.wait.size === 0 || !deps.getGpuMesher()) return;
    const jobs = [...deps.wait.entries()]
      .sort((a, b) => (deps.getEntry(b[0])?.lastTouchFrame ?? -1) - (deps.getEntry(a[0])?.lastTouchFrame ?? -1));
    for (const [key, job] of jobs) {
      const entry = deps.getEntry(key);
      deps.wait.delete(key);
      if (!entry || entry.ready || entry.failed || deps.pending.has(key)) continue;
      enqueuePageBuild(key, job.px, job.pz, deps.buildWorldBoundsForPage(job.px, job.pz));
    }
  };

  const drainApplyQueue: NearFieldGpuPageQueue["drainApplyQueue"] = (
    deadlineMs = performance.now() + GPU_APPLY_BUDGET_MS,
  ) => {
    while (deps.applyQueue.length > 0) {
      const { key, entry, job, dx, dz, cm } = deps.applyQueue.shift()!;
      if (deps.getEntry(key) === entry && deps.pending.get(key) === job) {
        const applyStartedAt = performance.now();
        job.meshChunks++;
        deps.sceneApply.addChunkMesh(
          entry.group,
          entry.mats,
          entry.unsubs,
          entry.colliderIds,
          cm,
          chunkColliderId(key, dx, dz),
          liveBubbleChunkFootprint(job.px, job.pz, dx, dz, P, S),
          dz * P + dx,
        );
        deps.onApplyMs(performance.now() - applyStartedAt);
      }
      completeGpuChunk(key, entry, job);
      if (performance.now() >= deadlineMs) break;
    }
  };

  const drainPendingBuilds: NearFieldGpuPageQueue["drainPendingBuilds"] = () => {
    let dispatched = 0;
    let inflightChunks = countInflightChunks();
    const jobs = [...deps.pending.entries()]
      .sort((a, b) => (deps.getEntry(b[0])?.lastTouchFrame ?? -1) - (deps.getEntry(a[0])?.lastTouchFrame ?? -1));
    for (const [key, job] of jobs) {
      if (inflightChunks >= deps.maxInflightChunks) return;
      if (deps.getFrame() < job.nextRetryFrame) continue;
      const entry = deps.getEntry(key);
      const gpuMesher = deps.getGpuMesher();
      if (!entry) {
        deps.pending.delete(key);
        continue;
      }
      if (!gpuMesher) {
        if (job.inflight === 0) {
          deps.pending.delete(key);
          entry.ready = false;
          entry.failed = false;
          entry.validEmpty = false;
          enqueueWait(key, job.px, job.pz);
        }
        continue;
      }
      while (job.chunks.length > 0 && dispatched < deps.dispatchBudget && inflightChunks < deps.maxInflightChunks) {
        const [dx, dz] = job.chunks.shift()!;
        job.inflight++;
        dispatched++;
        inflightChunks++;
        const chunkStartedAt = performance.now();
        gpuMesher.meshChunk(job.px * P + dx, job.pz * P + dz, job.worldBounds, job.edits)
          .then((cm) => {
            deps.onChunkMs(performance.now() - chunkStartedAt);
            const current = deps.getEntry(key) === entry && deps.pending.get(key) === job;
            if (current && cm.indices.length > 0) {
              deps.applyQueue.push({ key, entry, job, dx, dz, cm });
              return;
            }
            if (current) {
              job.emptyChunks++;
              if (deps.terrainColliders && !deps.liveStreamingEnabled) {
                deps.enqueueCpuChunk(key, job.px, job.pz, job.worldBounds, dx, dz);
              }
            }
            completeGpuChunk(key, entry, job);
          })
          .catch(() => {
            deps.onChunkMs(performance.now() - chunkStartedAt);
            if (deps.getEntry(key) === entry && deps.pending.get(key) === job) job.failures++;
            completeGpuChunk(key, entry, job);
          });
      }
      if (dispatched >= deps.dispatchBudget || inflightChunks >= deps.maxInflightChunks) return;
    }
  };

  const countChunks: NearFieldGpuPageQueue["countChunks"] = () => {
    let pendingChunks = 0;
    let inflightChunks = 0;
    for (const job of deps.pending.values()) {
      pendingChunks += job.chunks.length;
      inflightChunks += job.inflight;
    }
    return { pendingChunks, inflightChunks };
  };

  const retryPages: NearFieldGpuPageQueue["retryPages"] = () => {
    let total = 0;
    const frame = deps.getFrame();
    for (const job of deps.pending.values()) {
      if (job.attempts > 0 || frame < job.nextRetryFrame) total++;
    }
    return total;
  };

  return {
    enqueuePageBuild,
    enqueueWait,
    promoteWaitBuilds,
    drainApplyQueue,
    drainPendingBuilds,
    countChunks,
    retryPages,
    delete: (key) => {
      deps.pending.delete(key);
      deps.wait.delete(key);
    },
  };
}
