import type { ConstructionController } from "../construction/construction_controller.js";
import type { PlayerController } from "../player_controller.js";

export interface PlayableSliceStats {
  readonly fps: number;
  readonly frameMs: number;
  readonly frameMsP95: number;
  readonly frame: number;
  readonly counters: Record<string, number>;
}

export interface PlayableSliceSnapshot {
  readonly capturedAtMs: number;
  readonly frame: number;
  readonly fps: number;
  readonly frameMs: number;
  readonly frameMsP95: number;
  readonly pose: readonly [number, number, number];
  readonly grounded: boolean;
  readonly pageSizeM: number;
  readonly page: readonly [number, number];
  readonly swim: {
    readonly mode: string;
    readonly submersionM: number;
    readonly bodyId: string;
  };
  readonly terrain: {
    readonly revision: number;
    readonly voxelDeltaCount: number;
  };
  readonly construction: {
    readonly active: boolean;
    readonly currentValid: boolean;
    readonly currentReason: string | null;
    readonly placedPieces: number;
    readonly colliders: number;
    readonly unsupportedPieces: number;
    readonly pendingCollapses: number;
    readonly transactionInFlight: boolean;
  };
  readonly persistence: {
    readonly loaded: boolean;
    readonly dirtyRegions: number;
    readonly lastError: number;
    readonly voxelDeltaCount: number;
    readonly checkpointRequests: number;
    readonly checkpointCompleted: number;
    readonly checkpointFailed: number;
    readonly checkpointInFlight: boolean;
  };
  readonly spell: {
    readonly accepted: number;
    readonly denied: number;
    readonly committed: number;
    readonly convergenceCompleted: number;
    readonly convergenceFailed: number;
    readonly runtimeConvergenceCompleted: number;
    readonly runtimeConvergenceFailed: number;
  };
  readonly safety: {
    readonly colliderCoverageMissing: number;
    readonly frontierBarrierEngagements: number;
    readonly syncFrameBuilds: number;
    readonly colliderWorkerFaults: number;
    readonly recoveries: number;
    readonly editsDeniedNotReady: number;
    readonly editCommandsExpired: number;
    readonly editCommandDenials: number;
  };
}

export interface PlayableSliceSnapshotInput {
  readonly player: PlayerController;
  readonly constructionController: ConstructionController | null;
  readonly stats: PlayableSliceStats | null;
  readonly terrainRevision: number;
  readonly voxelDeltaCount: number;
  readonly pageSizeM: number;
  readonly nowMs?: () => number;
}

function counter(counters: Record<string, number>, key: string): number {
  const value = counters[key];
  return Number.isFinite(value) ? value : 0;
}

function prefixTotal(counters: Record<string, number>, prefix: string): number {
  let total = 0;
  for (const [key, value] of Object.entries(counters)) {
    if (key.startsWith(prefix) && Number.isFinite(value)) total += value;
  }
  return total;
}

export function createPlayableSliceSnapshot(input: PlayableSliceSnapshotInput): PlayableSliceSnapshot {
  const stats = input.stats;
  const counters = stats?.counters ?? {};
  const construction = input.constructionController?.stats() ?? null;
  const pageSizeM = Math.max(1, input.pageSizeM);
  const pose = input.player.position.toArray() as [number, number, number];

  return {
    capturedAtMs: (input.nowMs ?? (() => performance.now()))(),
    frame: stats?.frame ?? 0,
    fps: stats?.fps ?? 0,
    frameMs: stats?.frameMs ?? 0,
    frameMsP95: stats?.frameMsP95 ?? 0,
    pose,
    grounded: input.player.grounded,
    pageSizeM,
    page: [Math.floor(pose[0] / pageSizeM), Math.floor(pose[2] / pageSizeM)],
    swim: {
      mode: input.player.swimMode,
      submersionM: input.player.waterSubmersionM,
      bodyId: input.player.waterBodyId,
    },
    terrain: {
      revision: input.terrainRevision,
      voxelDeltaCount: input.voxelDeltaCount,
    },
    construction: {
      active: construction?.active ?? false,
      currentValid: construction?.currentValid ?? false,
      currentReason: construction?.currentReason ?? null,
      placedPieces: construction?.placedPieces ?? 0,
      colliders: construction ? counter(counters, "construction_colliders_active") : 0,
      unsupportedPieces: construction ? counter(counters, "construction_unsupported_pieces") : 0,
      pendingCollapses: construction?.pendingCollapses ?? 0,
      transactionInFlight: construction?.placementInFlight ?? false,
    },
    persistence: {
      loaded: counter(counters, "save_loaded") === 1,
      dirtyRegions: counter(counters, "save_dirty_region_count"),
      lastError: counter(counters, "save_last_error"),
      voxelDeltaCount: counter(counters, "save_voxel_delta_count"),
      checkpointRequests: counter(counters, "save_checkpoint_requests"),
      checkpointCompleted: counter(counters, "save_checkpoint_completed"),
      checkpointFailed: counter(counters, "save_checkpoint_failed"),
      checkpointInFlight: counter(counters, "save_checkpoint_in_flight") === 1,
    },
    spell: {
      accepted: counter(counters, "spell_world_casts_accepted"),
      denied: counter(counters, "spell_world_casts_denied"),
      committed: counter(counters, "spell_world_edits_committed"),
      convergenceCompleted: counter(counters, "spell_world_convergence_completed"),
      convergenceFailed: counter(counters, "spell_world_convergence_failed"),
      runtimeConvergenceCompleted: counter(counters, "spell_world_runtime_convergence_completed"),
      runtimeConvergenceFailed: counter(counters, "spell_world_runtime_convergence_failed"),
    },
    safety: {
      colliderCoverageMissing: counter(counters, "collider_coverage_missing"),
      frontierBarrierEngagements: counter(counters, "frontier_barrier_engagements"),
      syncFrameBuilds: counter(counters, "collider_sync_frame_builds"),
      colliderWorkerFaults: Math.max(
        counter(counters, "collider_worker_failures"),
        counter(counters, "collider_worker_fallback_builds"),
      ),
      recoveries: prefixTotal(counters, "player_recovery_"),
      editsDeniedNotReady: counter(counters, "edits_denied_not_ready"),
      editCommandsExpired: counter(counters, "edit_commands_expired"),
      editCommandDenials: prefixTotal(counters, "edit_commands_denied_"),
    },
  };
}
