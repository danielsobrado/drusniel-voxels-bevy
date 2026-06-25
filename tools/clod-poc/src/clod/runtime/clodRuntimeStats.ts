import type { ClodCut, ClodRuntimeStats } from "./clodRuntimeTypes.js";
import type { ClodTransition } from "./clodCrossfade.js";

export function createRuntimeStats(): ClodRuntimeStats {
  return {
    frame: 0,
    selectedNodeCount: 0,
    nodesPerLevel: new Map(),
    trianglesRendered: 0,
    errorThresholdPx: 1,
    forcedRestrictedSplits: 0,
    blockedRestrictedSplits: 0,
    activeTransitions: 0,
    crossfadeProgress: 0,
    freezeEnabled: false,
    enforce21Enabled: true,
    nearFieldMaskEnabled: false,
  };
}

export function updateRuntimeStats(
  stats: ClodRuntimeStats,
  cut: ClodCut,
  activeTransition: ClodTransition | null,
  currentFrame: number,
  nodeTriangleCounts: Map<string, number>,
): void {
  stats.frame = cut.frame;
  stats.selectedNodeCount = cut.nodes.size;

  const nodesPerLevel = new Map<number, number>();
  let totalTriangles = 0;

  for (const [, selected] of cut.nodes) {
    const count = nodesPerLevel.get(selected.level) ?? 0;
    nodesPerLevel.set(selected.level, count + 1);
    const tris = nodeTriangleCounts.get(selected.nodeId) ?? 0;
    totalTriangles += tris;
  }

  stats.nodesPerLevel = nodesPerLevel;
  stats.trianglesRendered = totalTriangles;

  if (activeTransition) {
    stats.activeTransitions = 1;
    const elapsed = currentFrame - activeTransition.startFrame;
    stats.crossfadeProgress = Math.min(1, Math.max(0, elapsed / activeTransition.durationFrames));
  } else {
    stats.activeTransitions = 0;
    stats.crossfadeProgress = 0;
  }
}

export function formatStatsText(stats: ClodRuntimeStats): string[] {
  const lines: string[] = [];
  lines.push(`Frame: ${stats.frame}`);
  lines.push(`Selected nodes: ${stats.selectedNodeCount}`);
  const lodParts: string[] = [];
  for (const [level, count] of stats.nodesPerLevel) {
    lodParts.push(`L${level}:${count}`);
  }
  lines.push(`LOD cut: ${lodParts.join("  ")}`);
  lines.push(`Triangles: ${stats.trianglesRendered.toLocaleString()}`);
  lines.push(`Err thresh: ${stats.errorThresholdPx.toFixed(2)}px`);
  lines.push(`2:1 forced: ${stats.forcedRestrictedSplits}`);
  lines.push(`2:1 blocked: ${stats.blockedRestrictedSplits}`);
  lines.push(`Transitions: ${stats.activeTransitions} (${(stats.crossfadeProgress * 100).toFixed(0)}%)`);
  if (stats.freezeEnabled) lines.push("FREEZE ON");
  if (!stats.enforce21Enabled) lines.push("2:1 OFF");
  if (stats.nearFieldMaskEnabled) lines.push("NF MASK ON");
  return lines;
}
