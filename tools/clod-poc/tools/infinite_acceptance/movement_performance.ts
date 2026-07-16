export interface MovementPerformanceEvidence {
  frameSampleCount: number;
  frameP99Ms: number;
  maxFrameMs: number;
  maxWorkUnitMs: number;
}

export interface MovementPerformanceLimits {
  minFrameSamples: number;
  maxFrameP99Ms: number;
  maxFrameMs: number;
  maxWorkUnitMs: number;
}

export interface MovementCoverageEvidence {
  maxPriorityUnownedCells: number;
  maxClodFarGapHoles: number;
  maxFarClipmapOwnershipHoles: number;
  frontierLagSampleCount: number;
  frontierLagP95M: number;
}

export interface MovementCoverageLimits {
  minFrontierLagSamples: number;
  maxFrontierLagP95M: number;
}

export function evaluateMovementPerformance(
  sceneName: string,
  evidence: MovementPerformanceEvidence,
  limits: MovementPerformanceLimits,
): string[] {
  const failures: string[] = [];
  if (evidence.frameSampleCount < limits.minFrameSamples) failures.push(`${sceneName}: movement route captured only ${evidence.frameSampleCount} frame samples`);
  if (evidence.frameP99Ms > limits.maxFrameP99Ms) failures.push(`${sceneName}: movement frame p99 ${evidence.frameP99Ms.toFixed(2)}ms > ${limits.maxFrameP99Ms}ms`);
  if (evidence.maxFrameMs > limits.maxFrameMs) failures.push(`${sceneName}: movement max frame ${evidence.maxFrameMs.toFixed(2)}ms > ${limits.maxFrameMs}ms`);
  if (evidence.maxWorkUnitMs > limits.maxWorkUnitMs) failures.push(`${sceneName}: movement uninterrupted work unit ${evidence.maxWorkUnitMs.toFixed(2)}ms > ${limits.maxWorkUnitMs}ms`);
  return failures;
}

export function evaluateMovementCoverage(
  sceneName: string,
  evidence: MovementCoverageEvidence,
  limits: MovementCoverageLimits,
): string[] {
  const failures: string[] = [];
  if (evidence.maxPriorityUnownedCells !== 0) failures.push(`${sceneName}: movement priority-unowned cells max ${evidence.maxPriorityUnownedCells} must equal 0`);
  if (evidence.maxClodFarGapHoles !== 0) failures.push(`${sceneName}: movement CLOD/far gap holes max ${evidence.maxClodFarGapHoles} must equal 0`);
  if (evidence.maxFarClipmapOwnershipHoles !== 0) failures.push(`${sceneName}: movement far-clipmap ownership holes max ${evidence.maxFarClipmapOwnershipHoles} must equal 0`);
  if (evidence.frontierLagSampleCount < limits.minFrontierLagSamples) failures.push(`${sceneName}: movement frontier lag captured only ${evidence.frontierLagSampleCount} samples`);
  if (!Number.isFinite(evidence.frontierLagP95M) || evidence.frontierLagP95M > limits.maxFrontierLagP95M) {
    failures.push(`${sceneName}: movement frontier lag p95 ${evidence.frontierLagP95M.toFixed(2)}m > ${limits.maxFrontierLagP95M}m`);
  }
  return failures;
}
