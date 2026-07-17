import { describe, expect, it } from "vitest";
import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";
import {
  PLAYABLE_SLICE_STEPS,
  evaluatePlayableSliceRun,
  publicRouteAuditFailures,
  type PlayableSliceRunReport,
} from "./playable_slice_contract.js";

function snapshot(overrides: Partial<PlayableSliceSnapshot> = {}): PlayableSliceSnapshot {
  return {
    capturedAtMs: 0,
    frame: 1,
    fps: 60,
    frameMs: 16,
    frameMsP95: 20,
    pose: [0, 10, 0],
    grounded: true,
    pageSizeM: 64,
    page: [0, 0],
    swim: { mode: "dry", submersionM: 0, bodyId: "" },
    terrain: { revision: 0, voxelDeltaCount: 0 },
    construction: {
      active: false,
      placedPieces: 0,
      colliders: 0,
      unsupportedPieces: 0,
      pendingCollapses: 0,
      transactionInFlight: false,
    },
    persistence: {
      loaded: true,
      dirtyRegions: 0,
      lastError: 0,
      voxelDeltaCount: 0,
      checkpointRequests: 0,
      checkpointCompleted: 0,
      checkpointFailed: 0,
      checkpointInFlight: false,
    },
    spell: {
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
    ...overrides,
  };
}

function validReport(): Omit<PlayableSliceRunReport, "passed" | "failures"> {
  const snapshots: Record<string, PlayableSliceSnapshot> = {
    spawn_ready: snapshot(),
    boundary_crossed: snapshot({ page: [1, 0], pose: [65, 10, 0], frame: 2 }),
    terrain_dug: snapshot({
      page: [1, 0], frame: 3,
      terrain: { revision: 1, voxelDeltaCount: 20 },
    }),
    construction_placed: snapshot({
      page: [1, 0], frame: 4,
      terrain: { revision: 1, voxelDeltaCount: 20 },
      construction: {
        active: true,
        placedPieces: 1,
        colliders: 1,
        unsupportedPieces: 0,
        pendingCollapses: 0,
        transactionInFlight: false,
      },
    }),
    construction_broken: snapshot({
      page: [1, 0], frame: 5,
      terrain: { revision: 1, voxelDeltaCount: 20 },
    }),
    water_entered: snapshot({
      page: [1, 0], frame: 6,
      terrain: { revision: 1, voxelDeltaCount: 20 },
      swim: { mode: "surface", submersionM: 1, bodyId: "river:7" },
    }),
    earth_cast_converged: snapshot({
      page: [1, 0], frame: 7,
      terrain: { revision: 2, voxelDeltaCount: 40 },
      swim: { mode: "surface", submersionM: 1, bodyId: "river:7" },
      spell: {
        accepted: 1,
        denied: 0,
        committed: 1,
        convergenceCompleted: 1,
        convergenceFailed: 0,
        runtimeConvergenceCompleted: 1,
        runtimeConvergenceFailed: 0,
      },
    }),
    checkpoint_saved: snapshot({
      page: [1, 0], frame: 8,
      terrain: { revision: 2, voxelDeltaCount: 40 },
      spell: {
        accepted: 1,
        denied: 0,
        committed: 1,
        convergenceCompleted: 1,
        convergenceFailed: 0,
        runtimeConvergenceCompleted: 1,
        runtimeConvergenceFailed: 0,
      },
      persistence: {
        loaded: true,
        dirtyRegions: 0,
        lastError: 0,
        voxelDeltaCount: 40,
        checkpointRequests: 1,
        checkpointCompleted: 1,
        checkpointFailed: 0,
        checkpointInFlight: false,
      },
    }),
    world_reloaded: snapshot({
      page: [1, 0], frame: 10,
      terrain: { revision: 2, voxelDeltaCount: 40 },
      persistence: {
        loaded: true,
        dirtyRegions: 0,
        lastError: 0,
        voxelDeltaCount: 40,
        checkpointRequests: 0,
        checkpointCompleted: 0,
        checkpointFailed: 0,
        checkpointInFlight: false,
      },
    }),
    gameplay_continued: snapshot({
      page: [1, 0], frame: 20, pose: [70, 10, 0],
      terrain: { revision: 2, voxelDeltaCount: 40 },
      persistence: {
        loaded: true,
        dirtyRegions: 0,
        lastError: 0,
        voxelDeltaCount: 40,
        checkpointRequests: 0,
        checkpointCompleted: 0,
        checkpointFailed: 0,
        checkpointInFlight: false,
      },
    }),
  };
  return {
    schemaVersion: 1,
    mode: "continuous",
    runIndex: 0,
    freshProfile: false,
    startedAt: new Date(0).toISOString(),
    wallClockMs: 20_000,
    actions: [
      { channel: "keyboard", action: "sprint", atMs: 1 },
      { channel: "pointer", action: "dig", atMs: 2 },
      { channel: "navigation", action: "reload", atMs: 3 },
    ],
    steps: PLAYABLE_SLICE_STEPS.map((step, index) => ({ step, snapshot: snapshots[step]!, atMs: index })),
    maxFrameMs: 80,
    maxFrameP95Ms: 30,
    travelledAfterReloadM: 5,
  };
}

describe("playable slice acceptance contract", () => {
  it("accepts a complete public-route-only run", () => {
    expect(evaluatePlayableSliceRun(validReport())).toEqual([]);
  });

  it("rejects diagnostic barriers in the continuous slice", () => {
    expect(publicRouteAuditFailures("continuous", [
      { channel: "diagnostic_barrier", action: "settle", atMs: 1 },
    ])).toEqual(["continuous route used diagnostic barrier: settle"]);
  });

  it("reports subsystem and responsiveness regressions", () => {
    const report = validReport();
    const steps = report.steps.map((evidence) => evidence.step === "gameplay_continued"
      ? {
          ...evidence,
          snapshot: snapshot({
            frame: 20,
            persistence: { ...evidence.snapshot.persistence },
            safety: { ...evidence.snapshot.safety, colliderCoverageMissing: 1, recoveries: 1 },
          }),
        }
      : evidence);
    const failures = evaluatePlayableSliceRun({
      ...report,
      steps,
      maxFrameP95Ms: 70,
      travelledAfterReloadM: 0,
    });

    expect(failures).toContain("gameplay did not continue after reload");
    expect(failures).toContain("collider coverage was missing 1 times");
    expect(failures).toContain("player recovery fired 1 times");
    expect(failures.some((failure) => failure.includes("frame p95"))).toBe(true);
  });
});
