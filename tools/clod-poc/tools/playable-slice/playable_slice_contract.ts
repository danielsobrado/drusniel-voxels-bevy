import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";

export type PlayableSliceMode = "diagnostic" | "continuous";
export type PlayableSlicePublicChannel = "keyboard" | "pointer" | "navigation";
export type PlayableSliceActionChannel = PlayableSlicePublicChannel | "diagnostic_barrier";

export const PLAYABLE_SLICE_STEPS = [
  "spawn_ready",
  "boundary_crossed",
  "terrain_dug",
  "construction_placed",
  "construction_broken",
  "water_entered",
  "earth_cast_converged",
  "checkpoint_saved",
  "world_reloaded",
  "gameplay_continued",
] as const;

export type PlayableSliceStep = typeof PLAYABLE_SLICE_STEPS[number];

export interface PlayableSliceActionRecord {
  readonly channel: PlayableSliceActionChannel;
  readonly action: string;
  readonly atMs: number;
}

export interface PlayableSliceStepEvidence {
  readonly step: PlayableSliceStep;
  readonly snapshot: PlayableSliceSnapshot;
  readonly atMs: number;
}

export interface PlayableSliceThresholds {
  readonly maxWallClockMs: number;
  readonly maxFrameMs: number;
  readonly maxFrameP95Ms: number;
  readonly maxFrontierBarrierEngagements: number;
}

export const DEFAULT_PLAYABLE_SLICE_THRESHOLDS: Readonly<PlayableSliceThresholds> = Object.freeze({
  maxWallClockMs: 180_000,
  maxFrameMs: 250,
  maxFrameP95Ms: 50,
  maxFrontierBarrierEngagements: 1,
});

export interface PlayableSliceRunReport {
  readonly schemaVersion: 1;
  readonly mode: PlayableSliceMode;
  readonly runIndex: number;
  readonly freshProfile: boolean;
  readonly startedAt: string;
  readonly wallClockMs: number;
  readonly actions: readonly PlayableSliceActionRecord[];
  readonly steps: readonly PlayableSliceStepEvidence[];
  readonly maxFrameMs: number;
  readonly maxFrameP95Ms: number;
  readonly travelledAfterReloadM: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function stepMap(report: Pick<PlayableSliceRunReport, "steps">): Map<PlayableSliceStep, PlayableSliceStepEvidence> {
  return new Map(report.steps.map((evidence) => [evidence.step, evidence]));
}

function maxIncrease(
  snapshots: readonly PlayableSliceSnapshot[],
  baseline: number,
  read: (snapshot: PlayableSliceSnapshot) => number,
): number {
  return Math.max(0, ...snapshots.map((snapshot) => read(snapshot) - baseline));
}

export function publicRouteAuditFailures(
  mode: PlayableSliceMode,
  actions: readonly PlayableSliceActionRecord[],
): string[] {
  if (mode !== "continuous") return [];
  const forbidden = actions.filter((action) => action.channel === "diagnostic_barrier");
  return forbidden.map((action) => `continuous route used diagnostic barrier: ${action.action}`);
}

export function evaluatePlayableSliceRun(
  report: Omit<PlayableSliceRunReport, "passed" | "failures">,
  thresholds: Readonly<PlayableSliceThresholds> = DEFAULT_PLAYABLE_SLICE_THRESHOLDS,
): string[] {
  const failures = publicRouteAuditFailures(report.mode, report.actions);
  const steps = stepMap(report);
  for (const step of PLAYABLE_SLICE_STEPS) {
    if (!steps.has(step)) failures.push(`missing step evidence: ${step}`);
  }
  if (failures.some((failure) => failure.startsWith("missing step evidence"))) return failures;

  const start = steps.get("spawn_ready")!.snapshot;
  const boundary = steps.get("boundary_crossed")!.snapshot;
  const dug = steps.get("terrain_dug")!.snapshot;
  const placed = steps.get("construction_placed")!.snapshot;
  const broken = steps.get("construction_broken")!.snapshot;
  const water = steps.get("water_entered")!.snapshot;
  const spell = steps.get("earth_cast_converged")!.snapshot;
  const checkpoint = steps.get("checkpoint_saved")!.snapshot;
  const reloaded = steps.get("world_reloaded")!.snapshot;
  const continued = steps.get("gameplay_continued")!.snapshot;
  const snapshots = report.steps.map((evidence) => evidence.snapshot);

  if (boundary.page[0] === start.page[0] && boundary.page[1] === start.page[1]) {
    failures.push("player did not cross a terrain page boundary");
  }
  if (dug.terrain.revision <= start.terrain.revision || dug.terrain.voxelDeltaCount <= start.terrain.voxelDeltaCount) {
    failures.push("public dig input did not commit terrain");
  }
  if (placed.construction.placedPieces <= dug.construction.placedPieces) {
    failures.push("public construction input did not place a piece");
  }
  if (placed.construction.colliders < placed.construction.placedPieces) {
    failures.push("placed construction collider count lagged visible pieces");
  }
  if (placed.construction.unsupportedPieces !== 0 || placed.construction.pendingCollapses !== 0) {
    failures.push("placed construction entered an unsupported or collapsing state");
  }
  if (broken.construction.placedPieces >= placed.construction.placedPieces) {
    failures.push("public break/delete input did not remove the placed piece");
  }
  if (broken.construction.colliders !== broken.construction.placedPieces) {
    failures.push("construction visual/collider counts diverged after break");
  }
  if (water.swim.mode !== "surface" && water.swim.mode !== "submerged") {
    failures.push(`player did not enter authoritative water: ${water.swim.mode}`);
  }
  if (spell.spell.runtimeConvergenceCompleted <= water.spell.runtimeConvergenceCompleted) {
    failures.push("terrain-affecting spell did not reach runtime convergence");
  }
  if (spell.spell.runtimeConvergenceFailed > water.spell.runtimeConvergenceFailed) {
    failures.push("terrain-affecting spell reported runtime convergence failure");
  }
  if (checkpoint.persistence.checkpointCompleted <= spell.persistence.checkpointCompleted) {
    failures.push("public checkpoint action did not complete");
  }
  if (checkpoint.persistence.checkpointFailed > spell.persistence.checkpointFailed) {
    failures.push("public checkpoint action failed");
  }
  if (
    checkpoint.persistence.checkpointInFlight
    || checkpoint.persistence.dirtyRegions !== 0
    || checkpoint.persistence.lastError !== 0
  ) {
    failures.push("checkpoint returned before persistence converged");
  }
  if (checkpoint.persistence.voxelDeltaCount < spell.terrain.voxelDeltaCount) {
    failures.push("checkpoint did not persist all authoritative voxel edits");
  }
  if (!reloaded.persistence.loaded || reloaded.persistence.lastError !== 0) {
    failures.push("saved world did not reload cleanly");
  }
  if (reloaded.persistence.voxelDeltaCount < checkpoint.persistence.voxelDeltaCount) {
    failures.push("reloaded save lost checkpointed voxel edits");
  }
  if (report.travelledAfterReloadM < 1) failures.push("gameplay did not continue after reload");
  if (continued.frame <= reloaded.frame) failures.push("render loop did not advance after reload");

  const safetyDeltas = {
    coverage: maxIncrease(snapshots, start.safety.colliderCoverageMissing, (snapshot) => snapshot.safety.colliderCoverageMissing),
    recoveries: maxIncrease(snapshots, start.safety.recoveries, (snapshot) => snapshot.safety.recoveries),
    syncBuilds: maxIncrease(snapshots, start.safety.syncFrameBuilds, (snapshot) => snapshot.safety.syncFrameBuilds),
    barriers: maxIncrease(snapshots, start.safety.frontierBarrierEngagements, (snapshot) => snapshot.safety.frontierBarrierEngagements),
    expired: maxIncrease(snapshots, start.safety.editCommandsExpired, (snapshot) => snapshot.safety.editCommandsExpired),
    deniedNotReady: maxIncrease(snapshots, start.safety.editsDeniedNotReady, (snapshot) => snapshot.safety.editsDeniedNotReady),
  };
  if (safetyDeltas.coverage !== 0) failures.push(`collider coverage was missing ${safetyDeltas.coverage} times`);
  if (safetyDeltas.recoveries !== 0) failures.push(`player recovery fired ${safetyDeltas.recoveries} times`);
  if (safetyDeltas.syncBuilds !== 0) failures.push(`synchronous frame collider builds increased by ${safetyDeltas.syncBuilds}`);
  if (safetyDeltas.barriers > thresholds.maxFrontierBarrierEngagements) {
    failures.push(`frontier barrier engagements ${safetyDeltas.barriers} exceed ${thresholds.maxFrontierBarrierEngagements}`);
  }
  if (safetyDeltas.expired !== 0) failures.push(`edit commands expired ${safetyDeltas.expired} times`);
  if (safetyDeltas.deniedNotReady !== 0) failures.push(`edits were denied as not-ready ${safetyDeltas.deniedNotReady} times`);
  if (report.wallClockMs > thresholds.maxWallClockMs) {
    failures.push(`wall clock ${report.wallClockMs.toFixed(0)}ms exceeds ${thresholds.maxWallClockMs}ms`);
  }
  if (report.maxFrameMs > thresholds.maxFrameMs) {
    failures.push(`frame max ${report.maxFrameMs.toFixed(1)}ms exceeds ${thresholds.maxFrameMs}ms`);
  }
  if (report.maxFrameP95Ms > thresholds.maxFrameP95Ms) {
    failures.push(`frame p95 ${report.maxFrameP95Ms.toFixed(1)}ms exceeds ${thresholds.maxFrameP95Ms}ms`);
  }

  return failures;
}

export function finalizePlayableSliceRun(
  report: Omit<PlayableSliceRunReport, "passed" | "failures">,
  thresholds: Readonly<PlayableSliceThresholds> = DEFAULT_PLAYABLE_SLICE_THRESHOLDS,
): PlayableSliceRunReport {
  const failures = evaluatePlayableSliceRun(report, thresholds);
  return { ...report, passed: failures.length === 0, failures };
}
