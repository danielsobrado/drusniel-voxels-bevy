import { describe, expect, it } from "vitest";
import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";
import {
  PLAYABLE_SLICE_STEPS,
  evaluatePlayableSliceRun,
  type PlayableSliceRunReport,
  type PlayableSliceStep,
} from "./playable_slice_contract.js";

function snapshot(step: PlayableSliceStep): PlayableSliceSnapshot {
  const index = PLAYABLE_SLICE_STEPS.indexOf(step);
  const terrainChanged = index >= PLAYABLE_SLICE_STEPS.indexOf("terrain_dug");
  const spellChanged = index >= PLAYABLE_SLICE_STEPS.indexOf("earth_cast_converged");
  const checkpointChanged = index === PLAYABLE_SLICE_STEPS.indexOf("checkpoint_saved");
  const reloaded = index >= PLAYABLE_SLICE_STEPS.indexOf("world_reloaded");
  const placed = step === "construction_placed";
  const pageCrossed = index >= PLAYABLE_SLICE_STEPS.indexOf("boundary_crossed");
  return {
    capturedAtMs: index,
    frame: index + 1,
    fps: 60,
    frameMs: 16,
    frameMsP95: 20,
    pose: [pageCrossed ? 65 + index : 0, 10, 0],
    grounded: true,
    pageSizeM: 64,
    page: pageCrossed ? [1, 0] : [0, 0],
    swim: index >= PLAYABLE_SLICE_STEPS.indexOf("water_entered")
      ? { mode: "surface", submersionM: 1, bodyId: "river:1" }
      : { mode: "dry", submersionM: 0, bodyId: "" },
    terrain: terrainChanged
      ? { revision: spellChanged ? 2 : 1, voxelDeltaCount: spellChanged ? 40 : 20 }
      : { revision: 0, voxelDeltaCount: 0 },
    construction: {
      active: placed,
      currentValid: placed,
      currentReason: null,
      placedPieces: placed ? 1 : 0,
      colliders: placed ? 1 : 0,
      unsupportedPieces: 0,
      pendingCollapses: 0,
      transactionInFlight: false,
    },
    persistence: {
      loaded: true,
      dirtyRegions: 0,
      lastError: 0,
      voxelDeltaCount: reloaded || checkpointChanged ? 40 : 0,
      checkpointRequests: checkpointChanged ? 1 : 0,
      checkpointCompleted: checkpointChanged ? 1 : 0,
      checkpointFailed: 0,
      checkpointInFlight: false,
    },
    spell: spellChanged && !reloaded
      ? {
          accepted: 1,
          denied: 0,
          committed: 1,
          convergenceCompleted: 1,
          convergenceFailed: 0,
          runtimeConvergenceCompleted: 1,
          runtimeConvergenceFailed: 0,
        }
      : {
          accepted: 0,
          denied: 0,
          committed: 0,
          convergenceCompleted: 0,
          convergenceFailed: 0,
          runtimeConvergenceCompleted: 0,
          runtimeConvergenceFailed: 0,
        },
    safety: {
      colliderCoverageMissing: 0,
      frontierBarrierEngagements: 0,
      syncFrameBuilds: 0,
      recoveries: 0,
      editsDeniedNotReady: 0,
      editCommandsExpired: 0,
    },
  };
}

function reportWithPreReloadRecovery(): Omit<PlayableSliceRunReport, "passed" | "failures"> {
  const steps = PLAYABLE_SLICE_STEPS.map((step) => {
    const base = snapshot(step);
    return {
      step,
      atMs: PLAYABLE_SLICE_STEPS.indexOf(step),
      snapshot: step === "water_entered"
        ? { ...base, safety: { ...base.safety, recoveries: 1 } }
        : base,
    };
  });
  return {
    schemaVersion: 1,
    mode: "continuous",
    runIndex: 0,
    freshProfile: false,
    startedAt: new Date(0).toISOString(),
    wallClockMs: 10_000,
    actions: [
      { channel: "keyboard", action: "move", atMs: 1 },
      { channel: "pointer", action: "edit", atMs: 2 },
      { channel: "navigation", action: "reload", atMs: 3 },
    ],
    steps,
    maxFrameMs: 50,
    maxFrameP95Ms: 25,
    travelledAfterReloadM: 5,
  };
}

describe("playable slice safety across reload", () => {
  it("does not let a reload reset hide an earlier recovery", () => {
    const failures = evaluatePlayableSliceRun(reportWithPreReloadRecovery());
    expect(failures).toContain("player recovery fired 1 times");
  });
});
