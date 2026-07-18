import { describe, expect, it } from "vitest";
import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";
import {
  PLAYABLE_SLICE_STEPS,
  type PlayableSliceRunReport,
} from "./playable_slice_contract.js";
import { playableSliceCertificationIntegrityFailures } from "./playable_slice_certification_integrity.js";
import { frameP95Ms } from "./playable_slice_frame_metrics.js";

describe("frameP95Ms", () => {
  it("computes the route-wide percentile from collected frame intervals", () => {
    const samples = Array.from({ length: 99 }, (_, index) => index + 1);
    expect(frameP95Ms(samples)).toBe(95);
  });

  it("returns zero without route samples", () => {
    expect(frameP95Ms([])).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "fails closed for invalid frame sample: %s",
    (sample) => {
      expect(frameP95Ms([sample])).toBeNaN();
    },
  );
});

function snapshot(): PlayableSliceSnapshot {
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
      currentValid: false,
      currentReason: null,
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
      colliderWorkerFaults: 0,
      recoveries: 0,
      editsDeniedNotReady: 0,
      editCommandsExpired: 0,
      editCommandDenials: 0,
    },
  };
}

function report(): PlayableSliceRunReport {
  return {
    schemaVersion: 1,
    mode: "continuous",
    runIndex: 0,
    freshProfile: false,
    expectedWaterBodyId: "hydrology:7",
    startedAt: "2026-07-18T00:00:00.000Z",
    wallClockMs: 1,
    actions: [
      { channel: "keyboard", action: "down:w", atMs: 1 },
      { channel: "keyboard", action: "up:w", atMs: 2 },
    ],
    steps: PLAYABLE_SLICE_STEPS.map((step, index) => ({
      step,
      atMs: index + 1,
      snapshot: snapshot(),
    })),
    maxFrameMs: 16,
    maxFrameP95Ms: 16,
    travelledAfterReloadM: 1,
    passed: true,
    failures: [],
  };
}

describe("playable slice certification integrity", () => {
  it("accepts clean canonical report metadata", () => {
    expect(playableSliceCertificationIntegrityFailures(report())).toEqual([]);
  });

  it("rejects startup safety debt", () => {
    const value = report();
    const steps = value.steps.map((evidence) => evidence.step === "spawn_ready"
      ? {
          ...evidence,
          snapshot: {
            ...evidence.snapshot,
            safety: { ...evidence.snapshot.safety, recoveries: 1 },
          },
        }
      : evidence);

    expect(playableSliceCertificationIntegrityFailures({ ...value, steps }))
      .toContain("spawn readiness inherited player recoveries: 1");
  });

  it("rejects backwards action time and noncanonical metadata", () => {
    const value = report();
    const failures = playableSliceCertificationIntegrityFailures({
      ...value,
      startedAt: "July 18, 2026",
      expectedWaterBodyId: "lake:7",
      actions: [
        { channel: "keyboard", action: "later", atMs: 2 },
        { channel: "keyboard", action: "earlier", atMs: 1 },
      ],
    });

    expect(failures).toContain("startedAt must use canonical ISO-8601 UTC format");
    expect(failures).toContain("expected water body id must be canonical hydrology authority");
    expect(failures).toContain("public action timestamp moved backwards at earlier");
  });
});
