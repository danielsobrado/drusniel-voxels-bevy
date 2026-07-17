// Session-cumulative WebGPU uncaptured-error count.
//
// Dawn error scopes make one bad submit poison unrelated async pipeline creation
// (observed: a stale stone-scatter binding killed water/spell material pipelines), so
// silent uncaptured errors must be visible to stats consumers and acceptance gates.
let uncapturedErrorCount = 0;

export function recordWebGpuUncapturedError(): void {
  uncapturedErrorCount++;
}

export function webGpuUncapturedErrorCount(): number {
  return uncapturedErrorCount;
}
