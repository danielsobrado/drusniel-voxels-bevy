import type { TreeSettings } from "./tree_config.js";
import { treeSystemUsesGpuRingDraw } from "./tree_system_gpu_policy.js";

export type TreeImpostorBakeHandoffAction = "none" | "swap-live" | "rebuild-gpu" | "rebuild-cpu";

export function treeImpostorBakeHandoffAction(
  settings: TreeSettings,
  supported: boolean,
): TreeImpostorBakeHandoffAction {
  if (!supported) return "none";
  if (settings.impostors.swapOnBake) return "swap-live";
  return treeSystemUsesGpuRingDraw(settings) ? "rebuild-gpu" : "rebuild-cpu";
}
