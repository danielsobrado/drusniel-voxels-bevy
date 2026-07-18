import { describe, expect, it } from "vitest";
import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";
import type {
  PlayableSliceActionRecord,
  PlayableSliceStepEvidence,
} from "./playable_slice_contract.js";
import {
  runContinuousPlayableSlice,
  runDiagnosticPlayableSlice,
  type DiagnosticPlayableSliceDriver,
} from "./playable_slice_route.js";

function snapshot(overrides: Partial<PlayableSliceSnapshot> = {}): PlayableSliceSnapshot {
  return {
    capturedAtMs: 0,
    frame: 1,
    fps: 60,
    frameMs: 16,
    frameMsP95: 20,
    pose: [56, 10, 20],
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

function routeSnapshots(): Map<string, PlayableSliceSnapshot> {
  const dug = snapshot({ page: [1, 0], pose: [65, 10, 20], frame: 3, terrain: { revision: 1, voxelDeltaCount: 20 } });
  const spellState = {
    accepted: 1,
    denied: 0,
    committed: 1,
    convergenceCompleted: 1,
    convergenceFailed: 0,
    runtimeConvergenceCompleted: 1,
    runtimeConvergenceFailed: 0,
  };
  return new Map([
    ["terrain page boundary", snapshot({ page: [1, 0], pose: [65, 10, 20], frame: 2 })],
    ["terrain edit commit", dug],
    ["construction preview", snapshot({
      ...dug,
      construction: { ...dug.construction, active: true, currentValid: true },
    })],
    ["construction placement", snapshot({
      ...dug,
      frame: 4,
      construction: { ...dug.construction, active: true, currentValid: true, placedPieces: 1, colliders: 1 },
    })],
    ["construction break", snapshot({ ...dug, frame: 5 })],
    ["authoritative water entry", snapshot({
      ...dug,
      frame: 6,
      swim: { mode: "surface", submersionM: 1, bodyId: "river:7" },
    })],
    ["earth spell runtime convergence", snapshot({
      ...dug,
      frame: 7,
      terrain: { revision: 2, voxelDeltaCount: 40 },
      swim: { mode: "surface", submersionM: 1, bodyId: "river:7" },
      spell: spellState,
    })],
    ["save checkpoint", snapshot({
      ...dug,
      frame: 8,
      terrain: { revision: 2, voxelDeltaCount: 40 },
      spell: spellState,
      persistence: {
        ...dug.persistence,
        voxelDeltaCount: 40,
        checkpointRequests: 1,
        checkpointCompleted: 1,
      },
    })],
    ["saved world reload", snapshot({
      ...dug,
      frame: 10,
      terrain: { revision: 2, voxelDeltaCount: 40 },
      persistence: { ...dug.persistence, voxelDeltaCount: 40 },
    })],
    ["continued gameplay", snapshot({
      ...dug,
      frame: 20,
      pose: [70, 10, 20],
      terrain: { revision: 2, voxelDeltaCount: 40 },
      persistence: { ...dug.persistence, voxelDeltaCount: 40 },
    })],
  ]);
}

class FakeDriver implements DiagnosticPlayableSliceDriver {
  readonly actions: PlayableSliceActionRecord[] = [];
  readonly evidence: PlayableSliceStepEvidence[] = [];
  readonly maxFrameMs = 80;
  readonly maxFrameP95Ms = 30;
  private readonly snapshots = routeSnapshots();
  private elapsed = 0;
  private current = snapshot();
  private pointerLocked = true;

  nowMs(): number { return this.elapsed += 10; }
  async snapshot(): Promise<PlayableSliceSnapshot> { return this.current; }
  recordEvidence(item: PlayableSliceStepEvidence): void { this.evidence.push(item); }
  async keyDown(key: string): Promise<void> {
    if (key === "Tab") this.pointerLocked = false;
    this.record("keyboard", `down:${key}`);
  }
  async keyUp(key: string): Promise<void> {
    if (key === "Tab") this.pointerLocked = true;
    this.record("keyboard", `up:${key}`);
  }
  async press(key: string, modifiers: readonly string[] = []): Promise<void> {
    this.record("keyboard", `${modifiers.join("+")}${modifiers.length > 0 ? "+" : ""}${key}`);
  }
  async pointerMoveToCenter(): Promise<void> { this.record("pointer", "move:center"); }
  async pointerClick(button: "left" | "right"): Promise<void> { this.record("pointer", `click:${button}`); }
  async waitForPointerLock(locked: boolean): Promise<void> {
    if (this.pointerLocked !== locked) throw new Error(`pointer lock expected ${locked}`);
  }
  async reload(): Promise<void> { this.record("navigation", "reload"); }
  async diagnosticBarrier(label: string): Promise<void> { this.record("diagnostic_barrier", label); }
  async waitUntil(
    label: string,
    predicate: (snapshot: PlayableSliceSnapshot) => boolean,
  ): Promise<PlayableSliceSnapshot> {
    const next = this.snapshots.get(label);
    if (!next || !predicate(next)) throw new Error(`invalid fake evidence for ${label}`);
    this.current = next;
    return next;
  }

  private record(channel: PlayableSliceActionRecord["channel"], action: string): void {
    this.actions.push({ channel, action, atMs: this.nowMs() });
  }
}

function actionIndex(actions: readonly PlayableSliceActionRecord[], action: string): number {
  return actions.findIndex((item) => item.action === action);
}

describe("playable slice route", () => {
  it("runs the continuous sequence through public inputs without diagnostic barriers", async () => {
    const driver = new FakeDriver();
    const report = await runContinuousPlayableSlice(driver, { runIndex: 0, freshProfile: false });

    expect(report.passed).toBe(true);
    expect(report.steps.map((step) => step.step)).toHaveLength(10);
    expect(report.actions.some((action) => action.channel === "diagnostic_barrier")).toBe(false);
    expect(driver.evidence).toEqual(report.steps);
  });

  it("holds Tab while construction releases pointer lock and resumes play afterwards", async () => {
    const driver = new FakeDriver();
    const report = await runContinuousPlayableSlice(driver, { runIndex: 0, freshProfile: false });

    const tabDown = actionIndex(report.actions, "down:Tab");
    const buildOn = actionIndex(report.actions, "b");
    const deleteClick = actionIndex(report.actions, "click:right");
    const tabUp = actionIndex(report.actions, "up:Tab");
    const waterSprint = report.actions.findIndex((action, index) => index > tabUp && action.action === "down:Shift");
    expect(tabDown).toBeGreaterThanOrEqual(0);
    expect(buildOn).toBeGreaterThan(tabDown);
    expect(deleteClick).toBeGreaterThan(buildOn);
    expect(tabUp).toBeGreaterThan(deleteClick);
    expect(waterSprint).toBeGreaterThan(tabUp);
  });

  it("uses explicit barriers only in diagnostic mode", async () => {
    const driver = new FakeDriver();
    const report = await runDiagnosticPlayableSlice(driver, { runIndex: 0, freshProfile: false });

    expect(report.passed).toBe(true);
    expect(report.actions.filter((action) => action.channel === "diagnostic_barrier").length).toBeGreaterThan(0);
  });
});
