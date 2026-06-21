import type { UnderstoryStats } from "./understory_system.js";

export function formatUnderstoryInfoLine(
  enabled: boolean,
  total: number,
  stats: UnderstoryStats | null | undefined,
): string {
  if (!enabled) return "understory: disabled";
  if (!stats) return `understory: enabled ${total.toLocaleString()} props`;
  return `understory: enabled ${total.toLocaleString()} props patches=${stats.visiblePatches}/${stats.patches} ` +
    `shrub/fern/sap/flower/log/stump=${stats.shrub}/${stats.fern}/${stats.sapling}/${stats.flower}/${stats.deadLog}/${stats.stump}`;
}
