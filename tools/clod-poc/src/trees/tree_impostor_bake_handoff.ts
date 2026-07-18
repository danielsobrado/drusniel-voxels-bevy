import type { TreeSettings } from "./tree_config.js";
import { treeSystemUsesGpuRingDraw } from "./tree_system_gpu_policy.js";

export type TreeImpostorBakeHandoffAction = "none" | "swap-live" | "rebuild-gpu" | "rebuild-cpu";

export interface TreeImpostorBakeHandoffOperations {
  swapLive(): void;
  rebuildGpu(): void;
  rebuildCpu(): void;
  resetGpuConsumers(): void;
  resetCpuConsumers(): void;
}

export function treeImpostorBakeHandoffAction(
  settings: TreeSettings,
  supported: boolean,
): TreeImpostorBakeHandoffAction {
  if (!supported) return "none";
  if (settings.impostors.swapOnBake) return "swap-live";
  return treeSystemUsesGpuRingDraw(settings) ? "rebuild-gpu" : "rebuild-cpu";
}

export function executeTreeImpostorBakeHandoff(
  action: TreeImpostorBakeHandoffAction,
  operations: TreeImpostorBakeHandoffOperations,
): void {
  switch (action) {
    case "swap-live":
      try {
        operations.swapLive();
      } catch (error) {
        operations.resetGpuConsumers();
        operations.resetCpuConsumers();
        throw error;
      }
      break;
    case "rebuild-gpu":
      operations.rebuildGpu();
      break;
    case "rebuild-cpu":
      operations.rebuildCpu();
      break;
    case "none":
      break;
  }
}
