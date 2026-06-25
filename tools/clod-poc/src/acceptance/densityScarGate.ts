import type { ClodPageNode } from "../types.js";
import { buildOuterBorderLocks, countLocks } from "../lock.js";
import type { AcceptanceGateResult, AcceptanceConfig, AcceptanceFailure } from "./acceptanceTypes.js";

export interface DensityScarMetrics {
  densityScarScore: number;
  maxLockedBorderVertexRatio: number;
  avgLockedBorderVertexRatio: number;
  farLodWireDensity: number;
  screenProjectedLockedEdgePxPer1000px: number;
}

export function computeDensityScar(
  nodesByLevel: Map<number, ClodPageNode[]>,
): DensityScarMetrics {
  let totalLockedRatio = 0;
  let maxLockedRatio = 0;
  let totalNodesWithLocks = 0;

  for (const [level, nodes] of nodesByLevel) {
    if (level === 0) continue;
    for (const node of nodes) {
      const locks = buildOuterBorderLocks(node.mesh);
      const lockedCount = countLocks(locks);
      const totalVertices = node.mesh.positions.length / 3;
      const ratio = totalVertices > 0 ? lockedCount / totalVertices : 0;
      totalLockedRatio += ratio;
      totalNodesWithLocks++;
      if (ratio > maxLockedRatio) maxLockedRatio = ratio;
    }
  }

  const avgLockedRatio = totalNodesWithLocks > 0 ? totalLockedRatio / totalNodesWithLocks : 0;

  let weightedScore = 0;
  let totalNodes = 0;
  for (const [level, nodes] of nodesByLevel) {
    if (level === 0) continue;
    for (const node of nodes) {
      const locks = buildOuterBorderLocks(node.mesh);
      const lockedCount = countLocks(locks);
      const totalVertices = node.mesh.positions.length / 3;
      const ratio = totalVertices > 0 ? lockedCount / totalVertices : 0;
      const areaWeight = 1.0 / (1 << level);
      weightedScore += ratio * areaWeight;
      totalNodes++;
    }
  }

  const densityScarScore = totalNodes > 0 ? weightedScore / totalNodes : 0;

  let farLodWireDensity = 0;
  let farNodeCount = 0;
  for (const [level, nodes] of nodesByLevel) {
    if (level < 2) continue;
    for (const node of nodes) {
      farLodWireDensity += node.mesh.indices.length / 3;
      farNodeCount++;
    }
  }
  farLodWireDensity = farNodeCount > 0 ? farLodWireDensity / farNodeCount : 0;

  return {
    densityScarScore,
    maxLockedBorderVertexRatio: maxLockedRatio,
    avgLockedBorderVertexRatio: avgLockedRatio,
    farLodWireDensity,
    screenProjectedLockedEdgePxPer1000px: 0,
  };
}

export function runGateA3(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  _fixtureName: string,
): AcceptanceGateResult {
  const metrics = computeDensityScar(nodesByLevel);
  const threshold = config.thresholds.densityScarScoreMax;
  const margin = threshold * 0.15;

  const exceeds = metrics.densityScarScore > threshold;
  const nearLimit = metrics.densityScarScore > threshold - margin && metrics.densityScarScore <= threshold;

  const failures: AcceptanceFailure[] = [];

  if (exceeds) {
    failures.push({
      code: "DENSITY_SCAR_EXCEEDED",
      message: `Density scar score ${metrics.densityScarScore.toFixed(4)} exceeds max ${threshold}. ` +
        "Locked-border density is too visible. Try increasing page size to 8x8 chunks and rerun Phase 3 before rejecting the approach.",
      value: metrics.densityScarScore,
      threshold,
    });
  }

  let status: "pass" | "warn" | "fail";
  if (exceeds) {
    status = "fail";
  } else if (nearLimit) {
    status = "warn";
  } else {
    status = "pass";
  }

  const message = status === "pass"
    ? `Score ${metrics.densityScarScore.toFixed(4)} / ${threshold}`
    : status === "warn"
      ? `Density scars acceptable but close to threshold (${metrics.densityScarScore.toFixed(4)} / ${threshold})`
      : `Density scars exceed threshold`;

  return {
    id: "A3",
    name: "Density scars",
    status,
    message,
    measurements: {
      densityScarScore: metrics.densityScarScore,
      densityScarScoreMax: threshold,
      maxLockedBorderVertexRatio: metrics.maxLockedBorderVertexRatio,
      avgLockedBorderVertexRatio: metrics.avgLockedBorderVertexRatio,
      farLodWireDensity: metrics.farLodWireDensity,
      screenProjectedLockedEdgePxPer1000px: metrics.screenProjectedLockedEdgePxPer1000px,
    },
    failures,
  };
}
