import {
  PROBE_GI_RELOCATION_AXIS_SAMPLE_FRACTION,
  PROBE_GI_VALIDITY_EPSILON,
} from "./constants.js";
import type { ProbeGiConfig, ProbeGiRelocationResult, ProbeGiSolidProvider, ProbeGiVec3 } from "./types.js";

const AXES: readonly ProbeGiVec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function relocateProbeGiPosition(
  desired: ProbeGiVec3,
  spacingM: number,
  provider: ProbeGiSolidProvider,
  config: ProbeGiConfig["relocation"],
): ProbeGiRelocationResult {
  if (!config.enabled) return validResult(desired, [0, 0, 0], false, 1, 0);
  const centerDensity = provider.densityAt(desired[0], desired[1], desired[2], spacingM);
  if (centerDensity === null || !Number.isFinite(centerDensity)) return invalidResult(desired, 6, true);
  if (centerDensity <= PROBE_GI_VALIDITY_EPSILON) return validResult(desired, [0, 0, 0], false, 1, 0);

  const sampleDistance = spacingM * PROBE_GI_RELOCATION_AXIS_SAMPLE_FRACTION;
  const maximumMove = spacingM * config.maximumSpacingFraction;
  let bestAxis: ProbeGiVec3 | null = null;
  let bestDensity = Number.POSITIVE_INFINITY;
  let failedAxes = 0;

  for (const axis of AXES) {
    const density = provider.densityAt(
      desired[0] + axis[0] * sampleDistance,
      desired[1] + axis[1] * sampleDistance,
      desired[2] + axis[2] * sampleDistance,
      spacingM,
    );
    if (density === null || !Number.isFinite(density)) {
      failedAxes++;
      continue;
    }
    if (density < bestDensity) {
      bestDensity = density;
      bestAxis = axis;
    }
  }

  if (!bestAxis || failedAxes >= config.invalidAfterFailedAxes) return invalidResult(desired, failedAxes, true);
  const moved: ProbeGiVec3 = [
    desired[0] + bestAxis[0] * maximumMove,
    desired[1] + bestAxis[1] * maximumMove,
    desired[2] + bestAxis[2] * maximumMove,
  ];
  const movedDensity = provider.densityAt(moved[0], moved[1], moved[2], spacingM);
  if (movedDensity === null || !Number.isFinite(movedDensity)) return invalidResult(desired, failedAxes, true);
  if (movedDensity > PROBE_GI_VALIDITY_EPSILON) return invalidResult(desired, failedAxes, failedAxes > 0);

  const confidence = clamp01(1 - Math.max(0, movedDensity) / Math.max(PROBE_GI_VALIDITY_EPSILON, centerDensity));
  return validResult(
    moved,
    [bestAxis[0] * maximumMove, bestAxis[1] * maximumMove, bestAxis[2] * maximumMove],
    true,
    confidence,
    failedAxes,
  );
}

function validResult(
  position: ProbeGiVec3,
  offset: ProbeGiVec3,
  relocated: boolean,
  confidence: number,
  failedAxes: number,
): ProbeGiRelocationResult {
  return { position, offset, valid: true, relocated, unknown: false, confidence: clamp01(confidence), failedAxes };
}

function invalidResult(position: ProbeGiVec3, failedAxes: number, unknown: boolean): ProbeGiRelocationResult {
  return { position, offset: [0, 0, 0], valid: false, relocated: false, unknown, confidence: 0, failedAxes };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
