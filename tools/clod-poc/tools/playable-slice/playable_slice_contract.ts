import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";
import { playableSliceCertificationIntegrityFailures } from "./playable_slice_certification_integrity.js";

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
  readonly expectedWaterBodyId: string;
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

function stepSequenceFailures(steps: readonly PlayableSliceStepEvidence[]): string[] {
  const failures: string[] = [];
  if (steps.length !== PLAYABLE_SLICE_STEPS.length) {
    failures.push(`expected ${PLAYABLE_SLICE_STEPS.length} step records, received ${steps.length}`);
  }
  const count = Math.min(steps.length, PLAYABLE_SLICE_STEPS.length);
  for (let index = 0; index < count; index += 1) {
    const expected = PLAYABLE_SLICE_STEPS[index];
    const actual = steps[index]?.step;
    if (actual !== expected) failures.push(`step ${index + 1} expected ${expected}, received ${actual ?? "missing"}`);
  }
  return failures;
}

function increaseAcrossCounterResets(
  snapshots: readonly PlayableSliceSnapshot[],
  read: (snapshot: PlayableSliceSnapshot) => number,
): number {
  if (snapshots.length === 0) return 0;
  let previous = read(snapshots[0]!);
  let increase = 0;
  for (let index = 1; index < snapshots.length; index += 1) {
    const current = read(snapshots[index]!);
    increase += current >= previous ? current - previous : current;
    previous = current;
  }
  return increase;
}

function isDry(snapshot: PlayableSliceSnapshot): boolean {
  return snapshot.swim.mode === "dry"
    && snapshot.swim.submersionM <= 0
    && snapshot.swim.bodyId.length === 0;
}

function numericFailure(
  failures: string[],
  label: string,
  value: number,
  options: { integer?: boolean; nonNegative?: boolean; positive?: boolean } = {},
): void {
  if (!Number.isFinite(value)) {
    failures.push(`${label} must be finite`);
    return;
  }
  if (options.integer && !Number.isInteger(value)) failures.push(`${label} must be an integer`);
  if (options.positive && value <= 0) failures.push(`${label} must be positive`);
  else if (options.nonNegative && value < 0) failures.push(`${label} must be non-negative`);
}

function snapshotIntegrityFailures(step: PlayableSliceStep, snapshot: PlayableSliceSnapshot): string[] {
  const failures: string[] = [];
  const label = `${step} snapshot`;
  numericFailure(failures, `${label} capturedAtMs`, snapshot.capturedAtMs, { nonNegative: true });
  numericFailure(failures, `${label} frame`, snapshot.frame, { integer: true, nonNegative: true });
  numericFailure(failures, `${label} fps`, snapshot.fps, { nonNegative: true });
  numericFailure(failures, `${label} frameMs`, snapshot.frameMs, { nonNegative: true });
  numericFailure(failures, `${label} frameMsP95`, snapshot.frameMsP95, { nonNegative: true });
  snapshot.pose.forEach((value, index) => numericFailure(failures, `${label} pose[${index}]`, value));
  numericFailure(failures, `${label} pageSizeM`, snapshot.pageSizeM, { positive: true });
  snapshot.page.forEach((value, index) => numericFailure(failures, `${label} page[${index}]`, value, { integer: true }));
  numericFailure(failures, `${label} swim.submersionM`, snapshot.swim.submersionM, { nonNegative: true });

  const integerCounters: readonly [string, number][] = [
    ["terrain.revision", snapshot.terrain.revision],
    ["terrain.voxelDeltaCount", snapshot.terrain.voxelDeltaCount],
    ["construction.placedPieces", snapshot.construction.placedPieces],
    ["construction.colliders", snapshot.construction.colliders],
    ["construction.unsupportedPieces", snapshot.construction.unsupportedPieces],
    ["construction.pendingCollapses", snapshot.construction.pendingCollapses],
    ["persistence.dirtyRegions", snapshot.persistence.dirtyRegions],
    ["persistence.lastError", snapshot.persistence.lastError],
    ["persistence.voxelDeltaCount", snapshot.persistence.voxelDeltaCount],
    ["persistence.checkpointRequests", snapshot.persistence.checkpointRequests],
    ["persistence.checkpointCompleted", snapshot.persistence.checkpointCompleted],
    ["persistence.checkpointFailed", snapshot.persistence.checkpointFailed],
    ["spell.accepted", snapshot.spell.accepted],
    ["spell.denied", snapshot.spell.denied],
    ["spell.committed", snapshot.spell.committed],
    ["spell.convergenceCompleted", snapshot.spell.convergenceCompleted],
    ["spell.convergenceFailed", snapshot.spell.convergenceFailed],
    ["spell.runtimeConvergenceCompleted", snapshot.spell.runtimeConvergenceCompleted],
    ["spell.runtimeConvergenceFailed", snapshot.spell.runtimeConvergenceFailed],
    ["safety.colliderCoverageMissing", snapshot.safety.colliderCoverageMissing],
    ["safety.frontierBarrierEngagements", snapshot.safety.frontierBarrierEngagements],
    ["safety.syncFrameBuilds", snapshot.safety.syncFrameBuilds],
    ["safety.colliderWorkerFaults", snapshot.safety.colliderWorkerFaults],
    ["safety.recoveries", snapshot.safety.recoveries],
    ["safety.editsDeniedNotReady", snapshot.safety.editsDeniedNotReady],
    ["safety.editCommandsExpired", snapshot.safety.editCommandsExpired],
    ["safety.editCommandDenials", snapshot.safety.editCommandDenials],
  ];
  for (const [name, value] of integerCounters) {
    numericFailure(failures, `${label} ${name}`, value, { integer: true, nonNegative: true });
  }
  return failures;
}

function reportIntegrityFailures(report: Omit<PlayableSliceRunReport, "passed" | "failures">): string[] {
  const failures: string[] = [];
  numericFailure(failures, "runIndex", report.runIndex, { integer: true, nonNegative: true });
  numericFailure(failures, "wallClockMs", report.wallClockMs, { nonNegative: true });
  numericFailure(failures, "maxFrameMs", report.maxFrameMs, { nonNegative: true });
  numericFailure(failures, "maxFrameP95Ms", report.maxFrameP95Ms, { nonNegative: true });
  numericFailure(failures, "travelledAfterReloadM", report.travelledAfterReloadM, { nonNegative: true });
  if (Number.isNaN(Date.parse(report.startedAt))) failures.push("startedAt must be a valid ISO-8601 timestamp");

  let previousStepAtMs = Number.NEGATIVE_INFINITY;
  for (const evidence of report.steps) {
    numericFailure(failures, `${evidence.step} evidence atMs`, evidence.atMs, { nonNegative: true });
    if (Number.isFinite(evidence.atMs) && evidence.atMs < previousStepAtMs) {
      failures.push(`${evidence.step} evidence timestamp is earlier than the previous step`);
    }
    previousStepAtMs = evidence.atMs;
    failures.push(...snapshotIntegrityFailures(evidence.step, evidence.snapshot));
  }
  for (const action of report.actions) {
    numericFailure(failures, `action ${action.action || "<empty>"} atMs`, action.atMs, { nonNegative: true });
    if (!action.action.trim()) failures.push("public action name must not be empty");
  }
  return failures;
}

export function publicRouteAuditFailures(
  mode: PlayableSliceMode,
  actions: readonly PlayableSliceActionRecord[],
): string[] {
  if (mode !== "continuous") return [];
  const forbidden = actions.filter((action) => action.channel === "diagnostic_barrier");
  return forbidden.map((action) => `continuous route used diagnostic barrier: ${action.action}`);
}

interface RequiredPublicAction {
  readonly after: PlayableSliceStep;
  readonly before: PlayableSliceStep;
  readonly channel: PlayableSlicePublicChannel;
  readonly action: string;
  readonly label: string;
}

const REQUIRED_PUBLIC_ACTIONS: readonly RequiredPublicAction[] = [
  { after: "spawn_ready", before: "boundary_crossed", channel: "keyboard", action: "down:Shift", label: "boundary sprint" },
  { after: "spawn_ready", before: "boundary_crossed", channel: "keyboard", action: "down:w", label: "boundary movement" },
  { after: "boundary_crossed", before: "terrain_dug", channel: "pointer", action: "click:left", label: "terrain dig" },
  { after: "terrain_dug", before: "construction_placed", channel: "keyboard", action: "down:Tab", label: "construction UI access" },
  { after: "terrain_dug", before: "construction_placed", channel: "keyboard", action: "b", label: "construction mode" },
  { after: "terrain_dug", before: "construction_placed", channel: "pointer", action: "click:left", label: "construction placement" },
  { after: "construction_placed", before: "construction_broken", channel: "pointer", action: "click:right", label: "construction break" },
  { after: "construction_broken", before: "water_entered", channel: "keyboard", action: "up:Tab", label: "construction exit" },
  { after: "construction_broken", before: "water_entered", channel: "keyboard", action: "down:w", label: "water approach" },
  { after: "water_entered", before: "earth_cast_converged", channel: "keyboard", action: "4", label: "earth spell" },
  { after: "earth_cast_converged", before: "checkpoint_saved", channel: "keyboard", action: "Control+s", label: "checkpoint" },
  { after: "checkpoint_saved", before: "world_reloaded", channel: "navigation", action: "reload saved world", label: "saved-world reload" },
  { after: "world_reloaded", before: "gameplay_continued", channel: "keyboard", action: "down:w", label: "post-reload movement" },
];

function publicRouteSequenceFailures(report: Omit<PlayableSliceRunReport, "passed" | "failures">): string[] {
  const failures: string[] = [];
  const steps = stepMap(report);
  for (const requirement of REQUIRED_PUBLIC_ACTIONS) {
    const after = steps.get(requirement.after)?.atMs;
    const before = steps.get(requirement.before)?.atMs;
    if (after === undefined || before === undefined) continue;
    const found = report.actions.some((action) => action.channel === requirement.channel
      && action.action === requirement.action
      && action.atMs >= after
      && action.atMs <= before);
    if (!found) failures.push(`missing public ${requirement.label} action: ${requirement.channel}:${requirement.action}`);
  }
  return failures;
}

export function evaluatePlayableSliceRun(
  report: Omit<PlayableSliceRunReport, "passed" | "failures">,
  thresholds: Readonly<PlayableSliceThresholds> = DEFAULT_PLAYABLE_SLICE_THRESHOLDS,
): string[] {
  const failures = [
    ...publicRouteAuditFailures(report.mode, report.actions),
    ...stepSequenceFailures(report.steps),
  ];
  const steps = stepMap(report);
  for (const step of PLAYABLE_SLICE_STEPS) {
    if (!steps.has(step)) failures.push(`missing step evidence: ${step}`);
  }
  if (failures.some((failure) => failure.startsWith("missing step evidence"))) return failures;

  const integrityFailures = reportIntegrityFailures(report);
  failures.push(...integrityFailures);
  if (integrityFailures.length > 0) return failures;
  failures.push(...playableSliceCertificationIntegrityFailures(report));
  failures.push(...publicRouteSequenceFailures(report));

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

  if (!start.persistence.loaded || start.persistence.lastError !== 0) {
    failures.push("saved world was not loaded cleanly at route start");
  }
  if (!start.grounded) failures.push("player was not grounded at route start");
  if (!isDry(start)) failures.push("route did not start on dry authoritative terrain");
  for (const [step, snapshot] of [
    ["boundary_crossed", boundary],
    ["terrain_dug", dug],
    ["construction_placed", placed],
    ["construction_broken", broken],
  ] as const) {
    if (!isDry(snapshot)) failures.push(`route entered water before the canonical water step: ${step}`);
  }
  if (boundary.page[0] === start.page[0] && boundary.page[1] === start.page[1]) {
    failures.push("player did not cross a terrain page boundary");
  }
  if (dug.terrain.revision <= start.terrain.revision || dug.terrain.voxelDeltaCount <= start.terrain.voxelDeltaCount) {
    failures.push("public dig input did not commit terrain");
  }
  if (placed.construction.placedPieces <= dug.construction.placedPieces) {
    failures.push("public construction input did not place a piece");
  }
  if (placed.construction.colliders !== placed.construction.placedPieces) {
    failures.push("placed construction visual/collider counts diverged");
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
  if (water.swim.bodyId.length === 0 || water.swim.submersionM <= 0) {
    failures.push("swim state did not identify an immersed authoritative water body");
  }
  if (!report.expectedWaterBodyId.trim()) {
    failures.push("expected canonical river body id is missing");
  } else if (water.swim.bodyId !== report.expectedWaterBodyId) {
    failures.push(`player entered ${water.swim.bodyId || "unknown water"}, expected ${report.expectedWaterBodyId}`);
  }
  if (spell.spell.accepted <= water.spell.accepted) failures.push("public earth spell input was not accepted");
  if (spell.spell.denied > water.spell.denied) failures.push("public earth spell input was denied");
  if (spell.spell.committed <= water.spell.committed) failures.push("terrain-affecting spell did not commit an authoritative edit");
  if (spell.spell.convergenceCompleted <= water.spell.convergenceCompleted) {
    failures.push("terrain-affecting spell did not complete terrain convergence");
  }
  if (spell.spell.convergenceFailed > water.spell.convergenceFailed) {
    failures.push("terrain-affecting spell reported terrain convergence failure");
  }
  if (spell.spell.runtimeConvergenceCompleted <= water.spell.runtimeConvergenceCompleted) {
    failures.push("terrain-affecting spell did not reach runtime convergence");
  }
  if (spell.spell.runtimeConvergenceFailed > water.spell.runtimeConvergenceFailed) {
    failures.push("terrain-affecting spell reported runtime convergence failure");
  }
  if (spell.terrain.revision <= water.terrain.revision || spell.terrain.voxelDeltaCount <= water.terrain.voxelDeltaCount) {
    failures.push("terrain-affecting spell did not change authoritative terrain state");
  }
  if (checkpoint.persistence.checkpointCompleted <= spell.persistence.checkpointCompleted) {
    failures.push("public checkpoint action did not complete");
  }
  if (checkpoint.persistence.checkpointFailed > spell.persistence.checkpointFailed) failures.push("public checkpoint action failed");
  if (checkpoint.persistence.checkpointInFlight || checkpoint.persistence.dirtyRegions !== 0 || checkpoint.persistence.lastError !== 0) {
    failures.push("checkpoint returned before persistence converged");
  }
  if (checkpoint.persistence.voxelDeltaCount < spell.terrain.voxelDeltaCount) {
    failures.push("checkpoint did not persist all authoritative voxel edits");
  }
  if (!reloaded.persistence.loaded || reloaded.persistence.lastError !== 0) failures.push("saved world did not reload cleanly");
  if (reloaded.persistence.voxelDeltaCount < checkpoint.persistence.voxelDeltaCount) {
    failures.push("reloaded save lost checkpointed voxel edits");
  }
  if (reloaded.terrain.voxelDeltaCount < checkpoint.persistence.voxelDeltaCount
    || reloaded.terrain.voxelDeltaCount < spell.terrain.voxelDeltaCount) {
    failures.push("reloaded terrain authority did not restore checkpointed voxel edits");
  }
  if (reloaded.construction.placedPieces !== broken.construction.placedPieces
    || reloaded.construction.colliders !== broken.construction.colliders) {
    failures.push("reloaded construction state does not match the post-break world");
  }
  if (continued.terrain.voxelDeltaCount < reloaded.terrain.voxelDeltaCount) {
    failures.push("continued gameplay lost reloaded terrain authority");
  }
  if (continued.construction.placedPieces !== reloaded.construction.placedPieces
    || continued.construction.colliders !== reloaded.construction.colliders) {
    failures.push("continued gameplay changed reloaded construction state");
  }
  if (report.travelledAfterReloadM < 1) failures.push("gameplay did not continue after reload");
  if (continued.frame <= reloaded.frame) failures.push("render loop did not advance after reload");

  const safetyDeltas = {
    coverage: increaseAcrossCounterResets(snapshots, (snapshot) => snapshot.safety.colliderCoverageMissing),
    recoveries: increaseAcrossCounterResets(snapshots, (snapshot) => snapshot.safety.recoveries),
    syncBuilds: increaseAcrossCounterResets(snapshots, (snapshot) => snapshot.safety.syncFrameBuilds),
    workerFaults: increaseAcrossCounterResets(snapshots, (snapshot) => snapshot.safety.colliderWorkerFaults),
    barriers: increaseAcrossCounterResets(snapshots, (snapshot) => snapshot.safety.frontierBarrierEngagements),
    expired: increaseAcrossCounterResets(snapshots, (snapshot) => snapshot.safety.editCommandsExpired),
    deniedNotReady: increaseAcrossCounterResets(snapshots, (snapshot) => snapshot.safety.editsDeniedNotReady),
    commandDenials: increaseAcrossCounterResets(snapshots, (snapshot) => snapshot.safety.editCommandDenials),
  };
  if (safetyDeltas.coverage !== 0) failures.push(`collider coverage was missing ${safetyDeltas.coverage} times`);
  if (safetyDeltas.recoveries !== 0) failures.push(`player recovery fired ${safetyDeltas.recoveries} times`);
  if (safetyDeltas.syncBuilds !== 0) failures.push(`synchronous frame collider builds increased by ${safetyDeltas.syncBuilds}`);
  if (safetyDeltas.workerFaults !== 0) failures.push(`collider worker faults increased by ${safetyDeltas.workerFaults}`);
  if (safetyDeltas.barriers > thresholds.maxFrontierBarrierEngagements) {
    failures.push(`frontier barrier engagements ${safetyDeltas.barriers} exceed ${thresholds.maxFrontierBarrierEngagements}`);
  }
  if (safetyDeltas.expired !== 0) failures.push(`edit commands expired ${safetyDeltas.expired} times`);
  if (safetyDeltas.deniedNotReady !== 0) failures.push(`edits were denied as not-ready ${safetyDeltas.deniedNotReady} times`);
  if (safetyDeltas.commandDenials !== 0) failures.push(`edit command denials increased by ${safetyDeltas.commandDenials}`);
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
