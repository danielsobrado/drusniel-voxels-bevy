import type { DressingClassId } from "./class_registry.js";
import type { DressingEnvironmentSample } from "./types.js";

export interface HydrologyAffinityResult {
  readonly accepted: boolean;
  readonly orientationRad: number | null;
}

function flowSpeed(sample: DressingEnvironmentSample): number {
  return Math.hypot(sample.flow[0], sample.flow[1]);
}

/** Bank classes sit on dry cells whose own flow is zero; fall back to the strongest
 *  adjacent water flow so a candidate can still see the river it borders. */
function nearbyFlow(sample: DressingEnvironmentSample): readonly [number, number] {
  if (flowSpeed(sample) > 1e-6) return sample.flow;
  return sample.bankFlow ?? [0, 0];
}

function nearbyFlowSpeed(sample: DressingEnvironmentSample): number {
  const flow = nearbyFlow(sample);
  return Math.hypot(flow[0], flow[1]);
}

function nearbyFlowAngle(sample: DressingEnvironmentSample): number | null {
  const flow = nearbyFlow(sample);
  return Math.hypot(flow[0], flow[1]) > 1e-6 ? Math.atan2(flow[1], flow[0]) : null;
}

export function evaluateHydrologyAffinity(
  classId: DressingClassId,
  sample: DressingEnvironmentSample,
  orientationRoll = 0,
): HydrologyAffinityResult {
  const shore = sample.shoreDistanceM;
  if (classId === "river_cobbles") {
    const compatibleBed = sample.sediment >= 0.2 || sample.deposition <= 0.75;
    return { accepted: shore >= -2 && shore <= 4 && nearbyFlowSpeed(sample) >= 0.15 && compatibleBed, orientationRad: null };
  }
  if (classId === "wet_stone_cluster") {
    return { accepted: (shore >= -1 && shore <= 2) || sample.wetness >= 0.7, orientationRad: null };
  }
  if (classId === "large_driftwood" || classId === "small_driftwood") {
    const angle = nearbyFlowAngle(sample);
    return {
      accepted: shore >= 0 && shore <= 3 && angle !== null && sample.normal[1] >= Math.cos(30 * Math.PI / 180),
      orientationRad: angle === null ? null : angle + (orientationRoll < 0.7 ? 0 : Math.PI / 2),
    };
  }
  if (classId === "bank_fern") {
    return { accepted: shore >= 0 && shore <= 4 && sample.moisture >= 0.5 && sample.waterDepthM === 0, orientationRad: null };
  }
  return { accepted: true, orientationRad: null };
}
