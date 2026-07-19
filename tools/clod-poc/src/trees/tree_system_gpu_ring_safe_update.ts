import * as THREE from "three";
import { treeGpuRingKey } from "../gpu/tree_ring_compute.js";
import {
  clearTreeGpuRing,
  updateTreeGpuRingTrees,
  type TreeGpuRingRuntimeInput,
} from "./tree_system_gpu_ring_runtime.js";

const DEFAULT_EXECUTION_ERROR = "tree GPU ring execution failed";
const DEFAULT_FALLBACK_ERROR = "tree GPU ring is unavailable";

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

  const previousLoggedError = input.state.loggedError;
  try {
    const updated = updateTreeGpuRingTrees(input, center, camera);
    if (!updated) {
      logCpuFallbackError(input, previousLoggedError);
      return false;
    }
    if (input.state.stats.status !== "failed") return true;
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
  console.error(`[trees-gpu-ring] ${action}: ${reason}`);
  return false;
}

function logCpuFallbackError(
  input: TreeGpuRingRuntimeInput,
  previousLoggedError: string | null,
): void {
  if (input.state.status !== "fallback-cpu") return;
  const reason = resolveCpuFallbackReason(input);
  if (reason === previousLoggedError) return;
  input.state.loggedError = reason;
  console.error(`[trees-gpu-ring] falling back to CPU: ${reason}`);
}

function resolveCpuFallbackReason(input: TreeGpuRingRuntimeInput): string {
  if (input.state.loggedError) return input.state.loggedError;
  if (input.state.stats.reason) return input.state.stats.reason;
  if (input.unsupportedReason) return input.unsupportedReason;
  if (!input.gpuDevice) return "WebGPU device is unavailable";
  if (!input.gpuBackend) return "WebGPU tree backend is unavailable";
  if (!input.supportsGpuTrees) return "GPU tree rendering is unsupported";
  return DEFAULT_FALLBACK_ERROR;
}
