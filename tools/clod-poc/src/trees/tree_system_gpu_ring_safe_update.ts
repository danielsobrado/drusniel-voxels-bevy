import * as THREE from "three";
import { treeGpuRingKey } from "../gpu/tree_ring_compute.js";
import {
  clearTreeGpuRing,
  updateTreeGpuRingTrees,
  type TreeGpuRingRuntimeInput,
} from "./tree_system_gpu_ring_runtime.js";

const DEFAULT_EXECUTION_ERROR = "tree GPU ring execution failed";

export function updateTreeGpuRingTreesSafely(
  input: TreeGpuRingRuntimeInput,
  center: THREE.Vector3,
  camera?: THREE.Camera,
): boolean {
  const key = treeGpuRingKey(input.settings, input.worldCells);
  if (input.state.failedKey === key) {
    input.state.status = input.settings.gpu.fallbackToCpu ? "fallback-cpu" : "error";
    return false;
  }

  try {
    const updated = updateTreeGpuRingTrees(input, center, camera);
    if (!updated || input.state.stats.status !== "failed") return updated;
    return failTreeGpuRingExecution(input, key, input.state.stats.reason ?? DEFAULT_EXECUTION_ERROR);
  } catch (error) {
    return failTreeGpuRingExecution(input, key, error);
  }
}

function failTreeGpuRingExecution(
  input: TreeGpuRingRuntimeInput,
  key: string,
  error: unknown,
): false {
  const reason = error instanceof Error ? error.message : String(error);
  clearTreeGpuRing(input);
  input.state.failedKey = key;
  input.state.loggedError = reason;
  input.state.stats = {
    ...input.state.stats,
    status: "failed",
    reason,
  };
  input.state.status = input.settings.gpu.fallbackToCpu ? "fallback-cpu" : "error";
  const action = input.settings.gpu.fallbackToCpu ? "falling back to CPU" : "GPU ring disabled";
  console.warn(`[trees-gpu-ring] ${action}: ${reason}`);
  return false;
}
