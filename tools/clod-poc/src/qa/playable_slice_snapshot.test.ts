import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ConstructionController } from "../construction/construction_controller.js";
import type { PlayerController } from "../player_controller.js";
import { createPlayableSliceSnapshot } from "./playable_slice_snapshot.js";

function fakePlayer(): PlayerController {
  return {
    position: new THREE.Vector3(130, 42, -2),
    grounded: false,
    swimMode: "surface",
    waterSubmersionM: 1.25,
    waterBodyId: "river:7",
  } as unknown as PlayerController;
}

function fakeConstruction(): ConstructionController {
  return {
    stats: () => ({
      active: true,
      placedPieces: 3,
      pendingCollapses: 0,
      placementInFlight: false,
    }),
  } as unknown as ConstructionController;
}

describe("playable slice snapshot", () => {
  it("composes player and P1-P6 subsystem evidence without mutation", () => {
    const snapshot = createPlayableSliceSnapshot({
      player: fakePlayer(),
      constructionController: fakeConstruction(),
      terrainRevision: 14,
      voxelDeltaCount: 36,
      pageSizeM: 64,
      nowMs: () => 1234,
      stats: {
        fps: 58,
        frameMs: 17.2,
        frameMsP95: 24,
        frame: 900,
        counters: {
          construction_colliders_active: 3,
          construction_unsupported_pieces: 1,
          save_loaded: 1,
          save_dirty_region_count: 0,
          save_last_error: 0,
          save_voxel_delta_count: 36,
          save_checkpoint_requests: 1,
          save_checkpoint_completed: 1,
          spell_world_casts_accepted: 1,
          spell_world_edits_committed: 1,
          spell_world_convergence_completed: 1,
          spell_world_runtime_convergence_completed: 1,
          collider_coverage_missing: 0,
          frontier_barrier_engagements: 1,
          collider_sync_frame_builds: 0,
          collider_worker_failures: 2,
          collider_worker_fallback_builds: 1,
          player_recovery_kill_plane: 1,
          player_recovery_non_finite: 2,
          edit_commands_denied_revision: 1,
          edit_commands_denied_distance: 2,
        },
      },
    });

    expect(snapshot).toMatchObject({
      capturedAtMs: 1234,
      frame: 900,
      pose: [130, 42, -2],
      page: [2, -1],
      swim: { mode: "surface", submersionM: 1.25, bodyId: "river:7" },
      terrain: { revision: 14, voxelDeltaCount: 36 },
      construction: {
        active: true,
        placedPieces: 3,
        colliders: 3,
        unsupportedPieces: 1,
        transactionInFlight: false,
      },
      persistence: {
        loaded: true,
        dirtyRegions: 0,
        checkpointRequests: 1,
        checkpointCompleted: 1,
        checkpointFailed: 0,
      },
      spell: {
        accepted: 1,
        committed: 1,
        convergenceCompleted: 1,
        runtimeConvergenceCompleted: 1,
      },
      safety: {
        colliderCoverageMissing: 0,
        frontierBarrierEngagements: 1,
        syncFrameBuilds: 0,
        colliderWorkerFaults: 3,
        recoveries: 3,
        editCommandDenials: 3,
      },
    });
  });

  it("fails closed to zeroed optional subsystem evidence", () => {
    const snapshot = createPlayableSliceSnapshot({
      player: fakePlayer(),
      constructionController: null,
      stats: null,
      terrainRevision: 0,
      voxelDeltaCount: 0,
      pageSizeM: 0,
      nowMs: () => 0,
    });

    expect(snapshot.pageSizeM).toBe(1);
    expect(snapshot.construction.placedPieces).toBe(0);
    expect(snapshot.persistence.loaded).toBe(false);
    expect(snapshot.spell.accepted).toBe(0);
    expect(snapshot.safety.recoveries).toBe(0);
    expect(snapshot.safety.colliderWorkerFaults).toBe(0);
    expect(snapshot.safety.editCommandDenials).toBe(0);
  });
});
