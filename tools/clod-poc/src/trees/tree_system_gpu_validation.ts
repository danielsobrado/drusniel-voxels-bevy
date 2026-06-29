import type { TreeLod } from "./tree_config.js";
import { TREE_LODS } from "./tree_config.js";
import { formatTreeLodCounts, visibleTreeLodCount } from "./tree_system_math.js";

export interface TreeGpuValidationCounts {
  counts: Record<TreeLod, number>;
  overflowed: boolean;
}

export interface TreeGpuValidationResult {
  maxDelta: number;
  tolerance: number;
  overflowMismatch: boolean;
  valid: boolean;
  message: string | null;
}

export function validateTreeGpuRingCounts(
  gpu: TreeGpuValidationCounts,
  cpu: TreeGpuValidationCounts,
): TreeGpuValidationResult {
  const deltas = TREE_LODS.map((lod) => Math.abs((gpu.counts[lod] ?? 0) - (cpu.counts[lod] ?? 0)));
  const maxDelta = Math.max(...deltas);
  const tolerance = treeGpuValidationTolerance(gpu.counts, cpu.counts);
  const overflowMismatch = gpu.overflowed !== cpu.overflowed;
  const valid = maxDelta <= tolerance && !overflowMismatch;
  return {
    maxDelta,
    tolerance,
    overflowMismatch,
    valid,
    message: valid ? null : treeGpuValidationMessage(gpu, cpu, maxDelta, tolerance),
  };
}

export function treeGpuValidationTolerance(
  gpuCounts: Record<TreeLod, number>,
  cpuCounts: Record<TreeLod, number>,
): number {
  return Math.max(4, Math.ceil(Math.max(visibleTreeLodCount(cpuCounts), visibleTreeLodCount(gpuCounts)) * 0.02));
}

export function treeGpuValidationMessage(
  gpu: TreeGpuValidationCounts,
  cpu: TreeGpuValidationCounts,
  maxDelta: number,
  tolerance: number,
): string {
  return "[trees-gpu-ring] CPU/GPU count parity failed " +
    `gpu=${formatTreeLodCounts(gpu.counts)} cpu=${formatTreeLodCounts(cpu.counts)} ` +
    `maxDelta=${maxDelta} tolerance=${tolerance} ` +
    `overflow gpu=${gpu.overflowed} cpu=${cpu.overflowed}`;
}
