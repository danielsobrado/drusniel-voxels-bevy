import { describe, expect, it } from "vitest";
import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";
import {
  PLAYABLE_SLICE_STEPS,
  evaluatePlayableSliceRun,
  publicRouteAuditFailures,
  type PlayableSliceActionRecord,
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
    ...overrides,
  };
}

function publicActions(): PlayableSliceActionRecord[] {
  return [
    { channel: "keyboard", action: "down:Shift", atMs: 50 },
    { channel: "keyboard", action: "down:w", atMs: 50 },
    { channel: "pointer", action: "click:left", atMs: 150 },
    { channel: "keyboard", action: "down:Tab", atMs: 250 },
    { channel: "keyboard", action: "b", atMs: 250 },
    { channel: "pointer", action: "click:left", atMs: 250 },
    { channel: "pointer", action: "click:right", atMs: 350 },
    { channel: "keyboard", action: "up:Tab", atMs: 450 },
    { channel: "keyboard", action: "down:Shift", atMs: 450 },
    { channel: "keyboard", action: "down:w", atMs: 450 },
    { channel: "keyboard", action: "4", atMs: 550 },
    { channel: "keyboard", action: "Control+s", atMs: 650 },
    { channel: "navigation", action: "reload saved world", atMs: 750 },
    { channel: "keyboard", action: "down:w", atMs: 850 },
  ];
}

function validReport(): Omit<PlayableSliceRunReport, "passed" | "failures"> {
  const snapshots: Record<string, PlayableSliceSnapshot> = {
    spawn_ready: snapshot(),
    boundary_crossed: snapshot({ page: [1, 0], pose: [65, 10, 0], frame: 2 }),
    terrain_dug: snapshot({ page: [1, 0], frame: 3, terrain: { revision: 1, voxelDeltaCount: 20 } }),
    construction_placed: snapshot({
      page: [1, 0], frame: 4,
      terrain: { revision: 1, voxelDeltaCount: 20 },
      construction: {
        active: true,
        currentValid: true,
        currentReason: null,
        placedPieces: 1,
        colliders: 1,
        unsupportedPieces: 0,
        pendingCollapses: 0,
        transactionInFlight: false,
      },
    }),
    construction_broken: snapshot({ page: [1, 0], frame: 5, terrain: { revision: 1, voxelDeltaCount: 20 } }),
    water_entered: snapshot({
      page: [1, 0], frame: 6,
      terrain: { revision: 1, voxelDeltaCount: 20 },
      swim: { mode: "surface", submersionM: 1, bodyId: "hydrology:7" },
    }),
    earth_cast_converged: snapshot({
      page: [1, 0], frame: 7,
      terrain: { revision: 2, voxelDeltaCount: 40 },
      swim: { mode: "surface", submersionM: 1, bodyId: "hydrology:7" },
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
    expectedWaterBodyId: "hydrology:7",
    startedAt: new Date(0).toISOString(),
    wallClockMs: 20_000,
    actions: publicActions(),
    steps: PLAYABLE_SLICE_STEPS.map((step, index) => ({ step, snapshot: snapshots[step]!, atMs: index * 100 })),
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

  it("rejects missing, duplicated, or reordered step evidence", () => {
    const report = validReport();
    const steps = [...report.steps];
    [steps[2], steps[3]] = [steps[3]!, steps[2]!];
    const failures = evaluatePlayableSliceRun({ ...report, steps });

    expect(failures.some((failure) => failure.includes("step 3 expected terrain_dug"))).toBe(true);
    expect(failures.some((failure) => failure.includes("step 4 expected construction_placed"))).toBe(true);
  });

  it("rejects an unloaded, airborne, or wet route start", () => {
    const report = validReport();
    const steps = report.steps.map((item) => item.step === "spawn_ready"
      ? {
          ...item,
          snapshot: {
            ...item.snapshot,
            grounded: false,
            swim: { mode: "surface", submersionM: 0.25, bodyId: "hydrology:7" },
            persistence: { ...item.snapshot.persistence, loaded: false },
          },
        }
      : item);
    const failures = evaluatePlayableSliceRun({ ...report, steps });

    expect(failures).toContain("saved world was not loaded cleanly at route start");
    expect(failures).toContain("player was not grounded at route start");
    expect(failures).toContain("route did not start on dry authoritative terrain");
  });

  it("rejects entering water before dig and construction finish", () => {
    const report = validReport();
    const steps = report.steps.map((item) => item.step === "terrain_dug"
      ? { ...item, snapshot: { ...item.snapshot, swim: { mode: "surface", submersionM: 0.5, bodyId: "hydrology:7" } } }
      : item);

    expect(evaluatePlayableSliceRun({ ...report, steps }))
      .toContain("route entered water before the canonical water step: terrain_dug");
  });

  it("rejects a different authoritative water body", () => {
    const report = validReport();
    const steps = report.steps.map((item) => item.step === "water_entered"
      ? { ...item, snapshot: { ...item.snapshot, swim: { mode: "surface", submersionM: 1, bodyId: "hydrology:99" } } }
      : item);

    expect(evaluatePlayableSliceRun({ ...report, steps }))
      .toContain("player entered hydrology:99, expected hydrology:7");
  });

  it("rejects non-finite report and snapshot evidence", () => {
    const report = validReport();
    const steps = report.steps.map((item) => item.step === "water_entered"
      ? { ...item, snapshot: { ...item.snapshot, pose: [Number.NaN, 10, 0], swim: { ...item.snapshot.swim, submersionM: Number.POSITIVE_INFINITY } } }
      : item);
    const failures = evaluatePlayableSliceRun({
      ...report,
      steps,
      maxFrameMs: Number.NaN,
      travelledAfterReloadM: Number.POSITIVE_INFINITY,
    });

    expect(failures).toContain("maxFrameMs must be finite");
    expect(failures).toContain("travelledAfterReloadM must be finite");
    expect(failures).toContain("water_entered snapshot pose[0] must be finite");
    expect(failures).toContain("water_entered snapshot swim.submersionM must be finite");
  });

  it("requires each state transition to follow its public input", () => {
    const report = validReport();
    const actions = report.actions.filter((action) => !(action.channel === "pointer" && action.action === "click:left" && action.atMs === 150));

    expect(evaluatePlayableSliceRun({ ...report, actions }))
      .toContain("missing public terrain dig action: pointer:click:left");
  });

  it("rejects an earth cast that converges without committing terrain", () => {
    const report = validReport();
    const water = report.steps.find((item) => item.step === "water_entered")!.snapshot;
    const steps = report.steps.map((item) => item.step === "earth_cast_converged"
      ? {
          ...item,
          snapshot: {
            ...item.snapshot,
            terrain: { ...water.terrain },
            spell: {
              ...item.snapshot.spell,
              committed: water.spell.committed,
              convergenceCompleted: water.spell.convergenceCompleted,
            },
          },
        }
      : item);
    const failures = evaluatePlayableSliceRun({ ...report, steps });

    expect(failures).toContain("terrain-affecting spell did not commit an authoritative edit");
    expect(failures).toContain("terrain-affecting spell did not complete terrain convergence");
    expect(failures).toContain("terrain-affecting spell did not change authoritative terrain state");
  });

  it("rejects a denied earth cast even if a terminal counter changes", () => {
    const report = validReport();
    const steps = report.steps.map((item) => item.step === "earth_cast_converged"
      ? { ...item, snapshot: { ...item.snapshot, spell: { ...item.snapshot.spell, denied: 1 } } }
      : item);

    expect(evaluatePlayableSliceRun({ ...report, steps })).toContain("public earth spell input was denied");
  });

  it("rejects extra stale construction colliders", () => {
    const report = validReport();
    const steps = report.steps.map((item) => item.step === "construction_placed"
      ? { ...item, snapshot: { ...item.snapshot, construction: { ...item.snapshot.construction, colliders: 2 } } }
      : item);

    expect(evaluatePlayableSliceRun({ ...report, steps })).toContain("placed construction visual/collider counts diverged");
  });

  it("rejects persistence metadata without restored live terrain", () => {
    const report = validReport();
    const steps = report.steps.map((item) => item.step === "world_reloaded"
      ? { ...item, snapshot: { ...item.snapshot, terrain: { revision: 0, voxelDeltaCount: 0 } } }
      : item);

    expect(evaluatePlayableSliceRun({ ...report, steps }))
      .toContain("reloaded terrain authority did not restore checkpointed voxel edits");
  });

  it("rejects a construction piece resurrected by reload", () => {
    const report = validReport();
    const steps = report.steps.map((item) => item.step === "world_reloaded"
      ? {
          ...item,
          snapshot: {
            ...item.snapshot,
            construction: { ...item.snapshot.construction, placedPieces: 1, colliders: 1 },
          },
        }
      : item);

    expect(evaluatePlayableSliceRun({ ...report, steps }))
      .toContain("reloaded construction state does not match the post-break world");
  });

  it("gates collider worker faults and all edit-command denials", () => {
    const report = validReport();
    const steps = report.steps.map((item) => item.step === "construction_broken"
      ? {
          ...item,
          snapshot: {
            ...item.snapshot,
            safety: { ...item.snapshot.safety, colliderWorkerFaults: 1, editCommandDenials: 2 },
          },
        }
      : item);
    const failures = evaluatePlayableSliceRun({ ...report, steps });

    expect(failures).toContain("collider worker faults increased by 1");
    expect(failures).toContain("edit command denials increased by 2");
  });

  it("reports subsystem and responsiveness regressions", () => {
    const report = validReport();
    const steps = report.steps.map((evidence) => evidence.step === "gameplay_continued"
      ? {
          ...evidence,
          snapshot: snapshot({
            frame: 20,
            terrain: { ...evidence.snapshot.terrain },
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
