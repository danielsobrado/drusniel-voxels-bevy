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
