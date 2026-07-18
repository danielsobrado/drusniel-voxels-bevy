import {
  DEFAULT_PLAYABLE_SLICE_THRESHOLDS,
  type PlayableSliceRunReport,
} from "./playable_slice_contract.js";
import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";

const CANONICAL_WATER_BODY_ID = /^hydrology:[1-9][0-9]*$/;

function totalAcrossCounterResets(
  snapshots: readonly PlayableSliceSnapshot[],
  read: (snapshot: PlayableSliceSnapshot) => number,
): number {
  if (snapshots.length === 0) return 0;
  let previous = read(snapshots[0]!);
  let total = previous;
  for (let index = 1; index < snapshots.length; index += 1) {
    const current = read(snapshots[index]!);
    total += current >= previous ? current - previous : current;
    previous = current;
  }
  return total;
}

export function playableSliceCertificationIntegrityFailures(
  report: PlayableSliceRunReport,
): string[] {
  const failures: string[] = [];
  const parsedStartedAt = Date.parse(report.startedAt);
  if (!Number.isFinite(parsedStartedAt) || new Date(parsedStartedAt).toISOString() !== report.startedAt) {
    failures.push("startedAt must use canonical ISO-8601 UTC format");
  }
  if (!CANONICAL_WATER_BODY_ID.test(report.expectedWaterBodyId)) {
    failures.push("expected water body id must be canonical hydrology authority");
  }

  let previousActionAtMs = Number.NEGATIVE_INFINITY;
  for (const action of report.actions) {
    if (action.atMs < previousActionAtMs) {
      failures.push(`public action timestamp moved backwards at ${action.action}`);
      break;
    }
    previousActionAtMs = action.atMs;
  }

  const start = report.steps.find((evidence) => evidence.step === "spawn_ready")?.snapshot;
  if (!start) return failures;
  const zeroBaselineCounters: readonly [string, number][] = [
    ["collider coverage missing", start.safety.colliderCoverageMissing],
    ["player recoveries", start.safety.recoveries],
    ["synchronous collider builds", start.safety.syncFrameBuilds],
    ["collider worker faults", start.safety.colliderWorkerFaults],
    ["not-ready edit denials", start.safety.editsDeniedNotReady],
    ["expired edit commands", start.safety.editCommandsExpired],
    ["edit command denials", start.safety.editCommandDenials],
  ];
  for (const [label, value] of zeroBaselineCounters) {
    if (value !== 0) failures.push(`spawn readiness inherited ${label}: ${value}`);
  }

  const snapshots = report.steps.map((evidence) => evidence.snapshot);
  const frontierBarrierTotal = totalAcrossCounterResets(
    snapshots,
    (snapshot) => snapshot.safety.frontierBarrierEngagements,
  );
  if (frontierBarrierTotal > DEFAULT_PLAYABLE_SLICE_THRESHOLDS.maxFrontierBarrierEngagements) {
    failures.push(
      `frontier barrier engagements including startup ${frontierBarrierTotal} exceed `
        + `${DEFAULT_PLAYABLE_SLICE_THRESHOLDS.maxFrontierBarrierEngagements}`,
    );
  }
  return failures;
}
