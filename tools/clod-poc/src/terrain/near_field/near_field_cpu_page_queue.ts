import {
  createChunkMeshBuild,
  finalizeChunkMeshBuild,
  stepChunkMeshBuild,
  type ChunkMeshBuild,
} from "../../terrain/terrain.js";
import { setVoxelOverlayResidentBounds } from "../voxel_overlay/voxel_overlay.js";
import type { ClodPagesConfig } from "../../config.js";
import type { WorldBounds } from "../../terrain/terrain_surface.js";
import { CPU_CHUNK_MESH_BUDGET_MS } from "./near_field_bubble_budgets.js";
import {
  chunkColliderId,
  liveBubbleChunkFootprint,
  type ChunkGroupEntry,
  type NearFieldBubbleSceneApply,
} from "./near_field_bubble_scene_apply.js";

export interface PendingCpuPageBuild {
  px: number;
  pz: number;
  worldBounds: WorldBounds;
  chunks: Array<[number, number]>;
  active: { dx: number; dz: number; build: ChunkMeshBuild } | null;
  failures: number;
}

export interface NearFieldCpuPageQueueDeps {
  pending: Map<string, PendingCpuPageBuild>;
  gpuPendingHas: (key: string) => boolean;
  getEntry: (key: string) => ChunkGroupEntry | undefined;
  chunksPerPage: number;
  chunkSize: number;
  cfg: ClodPagesConfig;
  sceneApply: NearFieldBubbleSceneApply;
  onWorkUnitMs: (ms: number) => void;
}

export interface NearFieldCpuPageQueue {
  enqueueChunk: (key: string, px: number, pz: number, worldBounds: WorldBounds, dx: number, dz: number) => void;
  enqueuePage: (key: string, px: number, pz: number, worldBounds: WorldBounds, chunks: Array<[number, number]>) => void;
  drain: (tBubbleStart: number) => void;
  delete: (key: string) => void;
}

export function createNearFieldCpuPageQueue(deps: NearFieldCpuPageQueueDeps): NearFieldCpuPageQueue {
  const { chunksPerPage: P, chunkSize: S } = deps;

  const enqueueChunk: NearFieldCpuPageQueue["enqueueChunk"] = (key, px, pz, worldBounds, dx, dz) => {
    const existing = deps.pending.get(key);
    if (existing) {
      existing.chunks.push([dx, dz]);
      return;
    }
    deps.pending.set(key, { px, pz, worldBounds, chunks: [[dx, dz]], active: null, failures: 0 });
  };

  const enqueuePage: NearFieldCpuPageQueue["enqueuePage"] = (key, px, pz, worldBounds, chunks) => {
    deps.pending.set(key, { px, pz, worldBounds, chunks, active: null, failures: 0 });
  };

  const drain: NearFieldCpuPageQueue["drain"] = (tBubbleStart) => {
    const deadlineMs = tBubbleStart + CPU_CHUNK_MESH_BUDGET_MS;
    while (deps.pending.size > 0) {
      const next = deps.pending.entries().next().value as [string, PendingCpuPageBuild];
      const [key, job] = next;
      const entry = deps.getEntry(key);
      if (!entry || (job.chunks.length === 0 && !job.active)) {
        deps.pending.delete(key);
        continue;
      }
      try {
        const unitStartedAt = performance.now();
        if (!job.active) {
          const [dx, dz] = job.chunks.shift()!;
          job.active = {
            dx,
            dz,
            build: createChunkMeshBuild(job.px * P + dx, job.pz * P + dz, deps.cfg, job.worldBounds),
          };
        }
        const complete = stepChunkMeshBuild(job.active.build, deadlineMs);
        if (!complete) {
          deps.onWorkUnitMs(performance.now() - unitStartedAt);
          return;
        }
        const { dx, dz, build } = job.active;
        deps.sceneApply.addChunkMesh(
          entry.group,
          entry.mats,
          entry.unsubs,
          entry.colliderIds,
          finalizeChunkMeshBuild(build),
          chunkColliderId(key, dx, dz),
          liveBubbleChunkFootprint(job.px, job.pz, dx, dz, P, S),
          dz * P + dx,
        );
        job.active = null;
        deps.onWorkUnitMs(performance.now() - unitStartedAt);
      } catch (error) {
        job.failures++;
        const dx = job.active?.dx ?? -1;
        const dz = job.active?.dz ?? -1;
        job.active = null;
        console.error(`[bubble] CPU chunk meshing failed for page ${key} chunk (${dx},${dz})`, error);
      }
      if (job.chunks.length === 0 && !job.active) {
        deps.pending.delete(key);
        if (!deps.gpuPendingHas(key)) {
          entry.failed = job.failures > 0;
          entry.validEmpty = job.failures === 0 && entry.group.children.length === 0;
          entry.ready = true;
          setVoxelOverlayResidentBounds(key, entry.voxelOverlayBounds);
        }
      }
      if (performance.now() >= deadlineMs) return;
    }
  };

  return {
    enqueueChunk,
    enqueuePage,
    drain,
    delete: (key) => {
      deps.pending.delete(key);
    },
  };
}
