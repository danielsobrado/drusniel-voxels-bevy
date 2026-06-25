import type { ClodPageNode } from "../types.js";
import type { AcceptanceGateResult, AcceptanceConfig, AcceptanceFailure } from "./acceptanceTypes.js";

export interface TriangleReductionMetrics {
  lod0Triangles: number;
  lod1Triangles: number;
  lod2Triangles: number;
  lod3Triangles: number;
  lod1Ratio: number;
  lod2Ratio: number;
  lod3Ratio: number;
  lockedBorderOverheadEstimate: number;
}

function triangleCount(mesh: { indices: { length: number } }): number {
  return mesh.indices.length / 3;
}

export function computeTriangleReduction(
  nodesByLevel: Map<number, ClodPageNode[]>,
): TriangleReductionMetrics {
  let lod0Triangles = 0;
  let lod1Triangles = 0;
  let lod2Triangles = 0;
  let lod3Triangles = 0;

  for (const [level, nodes] of nodesByLevel) {
    const total = nodes.reduce((s, n) => s + triangleCount(n.mesh), 0);
    if (level === 0) lod0Triangles = total;
    else if (level === 1) lod1Triangles = total;
    else if (level === 2) lod2Triangles = total;
    else if (level === 3) lod3Triangles = total;
  }

  const lod1Ratio = lod0Triangles > 0 ? lod1Triangles / lod0Triangles : 1;
  const lod2Ratio = lod0Triangles > 0 ? lod2Triangles / lod0Triangles : 1;
  const lod3Ratio = lod0Triangles > 0 ? lod3Triangles / lod0Triangles : 1;
  const lockedBorderOverheadEstimate = 0;

  return {
    lod0Triangles,
    lod1Triangles,
    lod2Triangles,
    lod3Triangles,
    lod1Ratio,
    lod2Ratio,
    lod3Ratio,
    lockedBorderOverheadEstimate,
  };
}

export function runGateA4(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  _fixtureName: string,
): AcceptanceGateResult {
  const metrics = computeTriangleReduction(nodesByLevel);
  const threshold = config.thresholds.lod3TriangleRatioMax;

  const passes = metrics.lod3Ratio <= threshold;
  const failures: AcceptanceFailure[] = [];

  if (!passes) {
    failures.push({
      code: "LOD3_TRIANGLE_RATIO_EXCEEDED",
      message: `LOD3 triangle ratio ${metrics.lod3Ratio.toFixed(4)} exceeds threshold ${threshold}`,
      value: metrics.lod3Ratio,
      threshold,
      level: 3,
    });
  }

  if (nodesByLevel.size < 4) {
    failures.push({
      code: "MISSING_LOD3",
      message: `Expected at least 4 LOD levels, got ${nodesByLevel.size}`,
      value: nodesByLevel.size,
      threshold: 4,
    });
  }

  const status = failures.length > 0 ? "fail" : "pass";
  const message = passes
    ? `LOD3 ratio ${metrics.lod3Ratio.toFixed(4)} / ${threshold}`
    : `LOD3 ratio ${metrics.lod3Ratio.toFixed(4)} exceeds max ${threshold}`;

  return {
    id: "A4",
    name: "Triangle reduction",
    status,
    message,
    measurements: {
      lod0Triangles: metrics.lod0Triangles,
      lod1Triangles: metrics.lod1Triangles,
      lod2Triangles: metrics.lod2Triangles,
      lod3Triangles: metrics.lod3Triangles,
      lod1Ratio: metrics.lod1Ratio,
      lod2Ratio: metrics.lod2Ratio,
      lod3Ratio: metrics.lod3Ratio,
      lod3RatioThreshold: threshold,
      lockedBorderOverheadEstimate: metrics.lockedBorderOverheadEstimate,
    },
    failures,
  };
}
