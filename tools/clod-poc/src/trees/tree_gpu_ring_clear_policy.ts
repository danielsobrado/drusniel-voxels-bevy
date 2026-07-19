import type { TreeGpuRingRuntimeState } from "./tree_system_gpu_ring_runtime.js";

export function treeGpuRingRequiresClear(state: TreeGpuRingRuntimeState): boolean {
  return !!state.compute
    || !!state.init
    || !!state.draw
    || state.ringMeshes.length > 0
    || state.prepassTwins.length > 0
    || state.key !== ""
    || state.failedKey !== ""
    || state.visibleCount !== 0
    || state.overflowed
    || state.dispatchMs !== null
    || state.lastValidationSignature !== ""
    || (state.stats.status !== "idle" && state.stats.status !== "disabled");
}
