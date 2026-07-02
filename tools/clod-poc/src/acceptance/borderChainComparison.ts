import type { PageMesh, BorderTolerances, PageFootprint } from "../types.js";
import { borderChain } from "../clod/validate.js";
import type { AcceptanceFailure, AcceptanceThresholds } from "./acceptanceTypes.js";
import { MIXED_LOD_FAILURE_CODES } from "./acceptanceTypes.js";
import type { FineEdgeChain, FootprintInterval } from "./borderValidationTypes.js";
import type { ClodPageNode } from "../types.js";

export function buildTolerances(thresholds: AcceptanceThresholds): BorderTolerances {
  return {
    position: thresholds.borderPositionEpsilon,
    normalDot: thresholds.borderNormalDotMin,
    material: thresholds.borderMaterialWeightDeltaMax,
  };
}

export function readChainAtEdge(
  mesh: PageMesh,
  footprint: PageFootprint,
  axis: "x" | "z",
  plane: number,
): ReturnType<typeof borderChain> {
  return borderChain(mesh, axis, plane, footprint, 1);
}

export function compareBorderChains(
  left: ReturnType<typeof borderChain>,
  right: ReturnType<typeof borderChain>,
  tolerances: BorderTolerances,
): { passes: boolean; maxPositionDelta: number; minNormalDot: number; maxMaterialWeightDelta: number; failures: AcceptanceFailure[] } {
  const failures: AcceptanceFailure[] = [];

  if (left.positions.length !== right.positions.length) {
    failures.push({
      code: "BORDER_CHAIN_LENGTH_MISMATCH",
      message: `Border chain length mismatch: ${left.positions.length} vs ${right.positions.length}`,
      value: left.positions.length,
      threshold: right.positions.length,
    });
    return { passes: false, maxPositionDelta: -1, minNormalDot: 1, maxMaterialWeightDelta: -1, failures };
  }

  let maxPosDelta = 0;
  let minNormDot = 1;
  let maxMatDelta = 0;

  const matchLen = Math.min(left.positions.length, right.positions.length);
  for (let i = 0; i < matchLen; i++) {
    const dp = Math.hypot(
      left.positions[i][0] - right.positions[i][0],
      left.positions[i][1] - right.positions[i][1],
      left.positions[i][2] - right.positions[i][2],
    );
    if (dp > maxPosDelta) maxPosDelta = dp;
    if (dp > tolerances.position) {
      failures.push({
        code: "BORDER_POSITION_MISMATCH",
        message: `Position delta ${dp.toExponential(2)} at border vertex ${i}`,
        value: dp,
        threshold: tolerances.position,
      });
    }

    const dot =
      left.normals[i][0] * right.normals[i][0] +
      left.normals[i][1] * right.normals[i][1] +
      left.normals[i][2] * right.normals[i][2];
    if (dot < minNormDot) minNormDot = dot;
    if (dot < tolerances.normalDot) {
      failures.push({
        code: "BORDER_NORMAL_MISMATCH",
        message: `Normal dot ${dot.toFixed(6)} at border vertex ${i}`,
        value: dot,
        threshold: tolerances.normalDot,
      });
    }

    if (left.materials[i] !== undefined && right.materials[i] !== undefined) {
      const md = Math.abs(left.materials[i] - right.materials[i]);
      if (md > maxMatDelta) maxMatDelta = md;
      if (md > tolerances.material) {
        failures.push({
          code: "BORDER_MATERIAL_MISMATCH",
          message: `Material paint delta ${md.toExponential(2)} at border vertex ${i}`,
          value: md,
          threshold: tolerances.material,
        });
      }
    }

    if (left.materialWeights[i] && right.materialWeights[i] && left.materialWeights[i].length > 0) {
      const ws = Math.min(left.materialWeights[i].length, right.materialWeights[i].length);
      for (let j = 0; j < ws; j++) {
        const wd = Math.abs(left.materialWeights[i][j] - right.materialWeights[i][j]);
        if (wd > maxMatDelta) maxMatDelta = wd;
        if (wd > tolerances.material) {
          failures.push({
            code: "BORDER_MATERIAL_MISMATCH",
            message: `Material weight channel ${j} delta ${wd.toExponential(2)} at border vertex ${i}`,
            value: wd,
            threshold: tolerances.material,
          });
        }
      }
    }
  }

  return {
    passes: failures.length === 0,
    maxPositionDelta: maxPosDelta,
    minNormalDot: minNormDot,
    maxMaterialWeightDelta: maxMatDelta,
    failures,
  };
}

export function reportMixedLodSurfaceDifferences(
  coarse: ReturnType<typeof borderChain>,
  fine: ReturnType<typeof borderChain>,
  tolerances: BorderTolerances,
): { maxPositionDelta: number; minNormalDot: number; maxMaterialWeightDelta: number; findings: AcceptanceFailure[] } {
  const findings: AcceptanceFailure[] = [];
  let maxPosDelta = 0;
  let minNormDot = 1;
  let maxMatDelta = 0;

  for (let ci = 0; ci < coarse.positions.length; ci++) {
    const cPos = coarse.positions[ci];

    let nearestFi = -1;
    let nearestDist = Infinity;
    for (let fi = 0; fi < fine.positions.length; fi++) {
      const fPos = fine.positions[fi];
      const d = Math.hypot(
        cPos[0] - fPos[0],
        cPos[1] - fPos[1],
        cPos[2] - fPos[2],
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearestFi = fi;
      }
    }

    if (nearestFi < 0) continue;

    if (nearestDist > maxPosDelta) maxPosDelta = nearestDist;
    if (nearestDist > tolerances.position) {
      findings.push({
        code: MIXED_LOD_FAILURE_CODES.POSITION_MISMATCH,
        message: `Position delta ${nearestDist.toExponential(2)} at coarse vertex ${ci} vs fine vertex ${nearestFi}`,
        value: nearestDist,
        threshold: tolerances.position,
      });
    }

    const dot =
      coarse.normals[ci][0] * fine.normals[nearestFi][0] +
      coarse.normals[ci][1] * fine.normals[nearestFi][1] +
      coarse.normals[ci][2] * fine.normals[nearestFi][2];
    if (dot < minNormDot) minNormDot = dot;
    if (dot < tolerances.normalDot) {
      findings.push({
        code: MIXED_LOD_FAILURE_CODES.NORMAL_MISMATCH,
        message: `Normal dot ${dot.toFixed(6)} at coarse vertex ${ci} vs fine vertex ${nearestFi}`,
        value: dot,
        threshold: tolerances.normalDot,
      });
    }

    if (coarse.materials[ci] !== undefined && fine.materials[nearestFi] !== undefined) {
      const md = Math.abs(coarse.materials[ci] - fine.materials[nearestFi]);
      if (md > maxMatDelta) maxMatDelta = md;
      if (md > tolerances.material) {
        findings.push({
          code: MIXED_LOD_FAILURE_CODES.MATERIAL_MISMATCH,
          message: `Material paint delta ${md.toExponential(2)} at coarse vertex ${ci} vs fine vertex ${nearestFi}`,
          value: md,
          threshold: tolerances.material,
        });
      }
    }
  }

  return { maxPositionDelta: maxPosDelta, minNormalDot: minNormDot, maxMaterialWeightDelta: maxMatDelta, findings };
}

export function stripCornerVertices(
  chain: ReturnType<typeof borderChain>,
  boundaryVal: number,
  axis: "x" | "z",
  epsilon: number,
): ReturnType<typeof borderChain> {
  const outP: [number, number, number][] = [];
  const outN: [number, number, number][] = [];
  const outM: number[] = [];
  const outW: number[][] = [];
  for (let i = 0; i < chain.positions.length; i++) {
    const coord = axis === "x" ? chain.positions[i][0] : chain.positions[i][2];
    const prevCoord = i > 0 ? (axis === "x" ? chain.positions[i - 1][0] : chain.positions[i - 1][2]) : coord;
    const nextCoord = i < chain.positions.length - 1 ? (axis === "x" ? chain.positions[i + 1][0] : chain.positions[i + 1][2]) : coord;
    if (Math.abs(coord - boundaryVal) < epsilon &&
        (Math.abs(coord - prevCoord) > epsilon || Math.abs(coord - nextCoord) > epsilon)) {
      continue;
    }
    outP.push(chain.positions[i]);
    outN.push(chain.normals[i]);
    outM.push(chain.materials[i]);
    outW.push(chain.materialWeights[i]);
  }
  return { positions: outP, normals: outN, materials: outM, materialWeights: outW };
}

export function collectFineEdgeChain(
  fineNode: ClodPageNode,
  axis: "x" | "z",
  plane: number,
): FineEdgeChain {
  const chain = borderChain(fineNode.mesh, axis, plane, fineNode.footprint, 1);
  return {
    positions: chain.positions,
    normals: chain.normals,
    materials: chain.materials,
    materialWeights: chain.materialWeights,
  };
}

export function validateIntervalCoverage(
  expectedIntervals: FootprintInterval[],
  coarseSpanStart: number,
  coarseSpanEnd: number,
): { passes: boolean; failures: AcceptanceFailure[] } {
  const failures: AcceptanceFailure[] = [];

  if (expectedIntervals.length === 0) {
    failures.push({
      code: MIXED_LOD_FAILURE_CODES.MISSING_FINE_SEGMENT,
      message: `No fine-node intervals found for coarse span [${coarseSpanStart.toFixed(2)}, ${coarseSpanEnd.toFixed(2)}]`,
      spanStart: coarseSpanStart,
      spanEnd: coarseSpanEnd,
    });
    return { passes: false, failures };
  }

  const sorted = [...expectedIntervals].sort((a, b) => a.start - b.start);

  if (Math.abs(sorted[0].start - coarseSpanStart) > 0.001) {
    failures.push({
      code: MIXED_LOD_FAILURE_CODES.COVERAGE_GAP,
      message: `First fine interval starts at ${sorted[0].start.toFixed(2)}, expected ~${coarseSpanStart.toFixed(2)}`,
      spanStart: coarseSpanStart,
      spanEnd: coarseSpanEnd,
      gapStart: coarseSpanStart,
      gapEnd: sorted[0].start,
    });
  }

  const lastEnd = sorted[sorted.length - 1].end;
  if (Math.abs(lastEnd - coarseSpanEnd) > 0.001) {
    failures.push({
      code: MIXED_LOD_FAILURE_CODES.COVERAGE_GAP,
      message: `Last fine interval ends at ${lastEnd.toFixed(2)}, expected ~${coarseSpanEnd.toFixed(2)}`,
      spanStart: coarseSpanStart,
      spanEnd: coarseSpanEnd,
      gapStart: lastEnd,
      gapEnd: coarseSpanEnd,
    });
  }

  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].end;
    const currStart = sorted[i].start;
    const gap = currStart - prevEnd;

    if (gap > 0.001) {
      failures.push({
        code: MIXED_LOD_FAILURE_CODES.COVERAGE_GAP,
        message: `Gap of ${gap.toFixed(4)} between fine intervals at [${prevEnd.toFixed(2)}, ${currStart.toFixed(2)}]`,
        spanStart: coarseSpanStart,
        spanEnd: coarseSpanEnd,
        gapStart: prevEnd,
        gapEnd: currStart,
      });
    }

    if (gap < -0.001) {
      failures.push({
        code: MIXED_LOD_FAILURE_CODES.EDGE_OVERLAP,
        message: `Overlap of ${(-gap).toFixed(4)} between fine intervals at [${prevEnd.toFixed(2)}, ${currStart.toFixed(2)}]`,
        spanStart: coarseSpanStart,
        spanEnd: coarseSpanEnd,
        gapStart: currStart,
        gapEnd: prevEnd,
      });
    }
  }

  return { passes: failures.length === 0, failures };
}
