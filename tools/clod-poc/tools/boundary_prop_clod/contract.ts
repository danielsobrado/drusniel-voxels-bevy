export const BOUNDARY_PROP_MAX_VERTICAL_DELTA_M = 2;

export const BOUNDARY_GAP_COUNTERS = [
  "live_clod_gap_holes",
  "clod_far_gap_holes",
  "far_clipmap_ownership_holes",
  "priority_unowned_cells",
  "live_clod_stream_parent_coverage_violations",
] as const;

export interface BoundaryPropProbe {
  assetId: string;
  x: number;
  z: number;
  propY: number;
  clodY: number | null;
  coverageHeights: readonly (number | null)[];
}

export interface BoundaryPropClodEvidence {
  props: readonly BoundaryPropProbe[];
  counters: Readonly<Record<string, number>>;
  stream: {
    required: number;
    pending: number;
    inflight: number;
    failed: number;
    safetyPending: number;
    safetyInflight: number;
    activeRoots: number;
  };
}

export interface BoundaryPropClodEvaluation {
  passed: boolean;
  failures: string[];
  maxVerticalDeltaM: number;
  uncoveredProbeCount: number;
}

export function evaluateBoundaryPropClodEvidence(
  evidence: BoundaryPropClodEvidence,
  maxVerticalDeltaM = BOUNDARY_PROP_MAX_VERTICAL_DELTA_M,
): BoundaryPropClodEvaluation {
  const failures: string[] = [];
  let measuredMaxVerticalDeltaM = 0;
  let uncoveredProbeCount = 0;

  if (evidence.props.length === 0) failures.push("no boundary props were reported");

  for (const prop of evidence.props) {
    if (prop.clodY === null || !Number.isFinite(prop.clodY)) {
      failures.push(`${prop.assetId}@${prop.x},${prop.z}: no rendered CLOD height`);
      uncoveredProbeCount++;
    } else {
      const delta = Math.abs(prop.propY - prop.clodY);
      measuredMaxVerticalDeltaM = Math.max(measuredMaxVerticalDeltaM, delta);
      if (delta > maxVerticalDeltaM) {
        failures.push(
          `${prop.assetId}@${prop.x},${prop.z}: prop/CLOD delta ${delta.toFixed(3)} m exceeds ${maxVerticalDeltaM.toFixed(3)} m`,
        );
      }
    }

    for (const height of prop.coverageHeights) {
      if (height === null || !Number.isFinite(height)) uncoveredProbeCount++;
    }
    if (prop.coverageHeights.some((height) => height === null || !Number.isFinite(height))) {
      failures.push(`${prop.assetId}@${prop.x},${prop.z}: rendered CLOD coverage gap around prop footprint`);
    }
  }

  for (const key of BOUNDARY_GAP_COUNTERS) {
    const value = evidence.counters[key];
    if (!Number.isFinite(value)) failures.push(`missing gap counter: ${key}`);
    else if (value !== 0) failures.push(`${key}=${value}`);
  }

  if (evidence.stream.required <= 0) failures.push("streamed CLOD was not required at the boundary pose");
  if (evidence.stream.pending !== 0) failures.push(`stream pending=${evidence.stream.pending}`);
  if (evidence.stream.inflight !== 0) failures.push(`stream inflight=${evidence.stream.inflight}`);
  if (evidence.stream.failed !== 0) failures.push(`stream failed=${evidence.stream.failed}`);
  if (evidence.stream.safetyPending !== 0) failures.push(`stream safety pending=${evidence.stream.safetyPending}`);
  if (evidence.stream.safetyInflight !== 0) failures.push(`stream safety inflight=${evidence.stream.safetyInflight}`);
  if (evidence.stream.activeRoots <= 0) failures.push("no active streamed CLOD roots after convergence");

  return {
    passed: failures.length === 0,
    failures,
    maxVerticalDeltaM: measuredMaxVerticalDeltaM,
    uncoveredProbeCount,
  };
}
