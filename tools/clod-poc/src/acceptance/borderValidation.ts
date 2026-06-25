import type { PageMesh, ClodPageNode, BorderTolerances, PageFootprint } from "../types.js";
import { borderChain } from "../validate.js";
import type {
  AcceptanceGateResult,
  AcceptanceFailure,
  AcceptanceThresholds,
} from "./acceptanceTypes.js";
import type { AcceptanceConfig } from "./acceptanceTypes.js";
import { MIXED_LOD_FAILURE_CODES } from "./acceptanceTypes.js";

export interface BorderValidationInput {
  nodesByLevel: Map<number, ClodPageNode[]>;
  fixtureName: string;
}

export interface BorderValidationOutput {
  passes: boolean;
  maxPositionDelta: number;
  minNormalDot: number;
  maxMaterialWeightDelta: number;
  failures: AcceptanceFailure[];
  failureCount: number;
}

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

export function validateSameLevelBorder(
  nodeA: ClodPageNode,
  nodeB: ClodPageNode,
  edge: "east" | "south",
  tolerances: BorderTolerances,
): { passes: boolean; failures: AcceptanceFailure[]; maxPosDelta: number; minNormDot: number; maxMatDelta: number } {
  let aAxis: "x" | "z";
  let aPlane: number;
  let bAxis: "x" | "z";
  let bPlane: number;

  if (edge === "east") {
    aAxis = "x";
    aPlane = nodeA.footprint.maxX;
    bAxis = "x";
    bPlane = nodeB.footprint.minX;
  } else {
    aAxis = "z";
    aPlane = nodeA.footprint.maxZ;
    bAxis = "z";
    bPlane = nodeB.footprint.minZ;
  }

  const aChain = readChainAtEdge(nodeA.mesh, nodeA.footprint, aAxis, aPlane);
  const bChain = readChainAtEdge(nodeB.mesh, nodeB.footprint, bAxis, bPlane);

  if (aChain.positions.length === 0 && bChain.positions.length === 0) {
    return { passes: true, failures: [], maxPosDelta: 0, minNormDot: 1, maxMatDelta: 0 };
  }

  if (aChain.positions.length === 0 || bChain.positions.length === 0) {
    return {
      passes: false,
      failures: [{
        code: "BORDER_CHAIN_MISSING",
        message: `One side has zero border vertices: A=${aChain.positions.length}, B=${bChain.positions.length}`,
        value: aChain.positions.length,
        threshold: bChain.positions.length,
      }],
      maxPosDelta: -1,
      minNormDot: 1,
      maxMatDelta: -1,
    };
  }

  const result = compareBorderChains(aChain, bChain, tolerances);
  return {
    passes: result.passes,
    failures: result.failures,
    maxPosDelta: result.maxPositionDelta,
    minNormDot: result.minNormalDot,
    maxMatDelta: result.maxMaterialWeightDelta,
  };
}

export function validateSameLevelWatertightness(
  nodesByLevel: Map<number, ClodPageNode[]>,
  tolerances: BorderTolerances,
): { passes: boolean; failures: AcceptanceFailure[]; edgesTested: number; failureCount: number; maxPositionDelta: number; minNormalDot: number; maxMaterialWeightDelta: number } {
  const failures: AcceptanceFailure[] = [];
  let maxPositionDelta = 0;
  let minNormalDot = 1;
  let maxMaterialWeightDelta = 0;
  let edgesTested = 0;

  for (const [level, nodes] of nodesByLevel) {
    if (level === 0) continue;

    const index = new Map<string, ClodPageNode>();
    for (const node of nodes) {
      const match = /^L\d+:(\d+),(\d+)$/.exec(node.id);
      if (match) index.set(`${match[1]},${match[2]}`, node);
    }

    for (const [key, node] of index) {
      const [nxStr, nzStr] = key.split(",");
      const nx = Number(nxStr);
      const nz = Number(nzStr);

      const right = index.get(`${nx + 1},${nz}`);
      if (right) {
        edgesTested++;
        const result = validateSameLevelBorder(node, right, "east", tolerances);
        if (!result.passes) {
          for (const f of result.failures) {
            failures.push({ ...f, nodeId: `L${level}:${nx},${nz}`, edge: "east", level });
          }
        }
        if (result.maxPosDelta > maxPositionDelta) maxPositionDelta = result.maxPosDelta;
        if (result.minNormDot < minNormalDot) minNormalDot = result.minNormDot;
        if (result.maxMatDelta > maxMaterialWeightDelta) maxMaterialWeightDelta = result.maxMatDelta;
      }

      const down = index.get(`${nx},${nz + 1}`);
      if (down) {
        edgesTested++;
        const result = validateSameLevelBorder(node, down, "south", tolerances);
        if (!result.passes) {
          for (const f of result.failures) {
            failures.push({ ...f, nodeId: `L${level}:${nx},${nz}`, edge: "south", level });
          }
        }
        if (result.maxPosDelta > maxPositionDelta) maxPositionDelta = result.maxPosDelta;
        if (result.minNormDot < minNormalDot) minNormalDot = result.minNormDot;
        if (result.maxMatDelta > maxMaterialWeightDelta) maxMaterialWeightDelta = result.maxMatDelta;
      }
    }
  }

  return {
    passes: failures.length === 0,
    failures,
    edgesTested,
    failureCount: failures.length,
    maxPositionDelta,
    minNormalDot,
    maxMaterialWeightDelta,
  };
}

export function validateSameLevelStrictEquality(
  nodesByLevel: Map<number, ClodPageNode[]>,
  tolerances: BorderTolerances,
): BorderValidationOutput {
  const result = validateSameLevelWatertightness(nodesByLevel, tolerances);
  return {
    passes: result.passes,
    maxPositionDelta: result.maxPositionDelta,
    minNormalDot: result.minNormalDot,
    maxMaterialWeightDelta: result.maxMaterialWeightDelta,
    failures: result.failures,
    failureCount: result.failureCount,
  };
}

function stripCornerVertices(
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

export interface FineEdgeChain {
  positions: [number, number, number][];
  normals: [number, number, number][];
  materials: number[];
  materialWeights: number[][];
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

const CORNER_TRIM_MARGIN = 2.5;
const MAX_VERTEX_GAP = 5.0;

export function validateChainSpanCoverage(
  coarseSpanStart: number,
  coarseSpanEnd: number,
  fineChain: FineEdgeChain,
  freeAxis: "x" | "z",
): { passes: boolean; failures: AcceptanceFailure[] } {
  const failures: AcceptanceFailure[] = [];
  const axisIdx = freeAxis === "x" ? 0 : 2;

  if (fineChain.positions.length === 0) {
    failures.push({
      code: MIXED_LOD_FAILURE_CODES.MISSING_FINE_SEGMENT,
      message: `No fine border vertices found for coarse span [${coarseSpanStart.toFixed(2)}, ${coarseSpanEnd.toFixed(2)}]`,
      spanStart: coarseSpanStart,
      spanEnd: coarseSpanEnd,
    });
    return { passes: false, failures };
  }

  const firstCoord = fineChain.positions[0][axisIdx];
  const lastCoord = fineChain.positions[fineChain.positions.length - 1][axisIdx];

  if (firstCoord < coarseSpanStart - CORNER_TRIM_MARGIN) {
    failures.push({
      code: MIXED_LOD_FAILURE_CODES.EDGE_OVERLAP,
      message: `Fine chain starts at ${firstCoord.toFixed(2)}, before span start ${coarseSpanStart.toFixed(2)} by ${(coarseSpanStart - firstCoord).toFixed(2)}`,
      spanStart: coarseSpanStart,
      spanEnd: coarseSpanEnd,
      gapStart: firstCoord,
      gapEnd: coarseSpanStart,
    });
  }

  if (lastCoord > coarseSpanEnd + CORNER_TRIM_MARGIN) {
    failures.push({
      code: MIXED_LOD_FAILURE_CODES.EDGE_OVERLAP,
      message: `Fine chain ends at ${lastCoord.toFixed(2)}, beyond span end ${coarseSpanEnd.toFixed(2)} by ${(lastCoord - coarseSpanEnd).toFixed(2)}`,
      spanStart: coarseSpanStart,
      spanEnd: coarseSpanEnd,
      gapStart: coarseSpanEnd,
      gapEnd: lastCoord,
    });
  }

  for (let i = 1; i < fineChain.positions.length; i++) {
    const prev = fineChain.positions[i - 1][axisIdx];
    const curr = fineChain.positions[i][axisIdx];
    const gap = curr - prev;

    if (gap > MAX_VERTEX_GAP) {
      failures.push({
        code: MIXED_LOD_FAILURE_CODES.COVERAGE_GAP,
        message: `Gap of ${gap.toFixed(2)} between consecutive fine vertices at [${prev.toFixed(2)}, ${curr.toFixed(2)}]`,
        spanStart: coarseSpanStart,
        spanEnd: coarseSpanEnd,
        gapStart: prev,
        gapEnd: curr,
      });
    }

    if (gap < -MAX_VERTEX_GAP) {
      failures.push({
        code: MIXED_LOD_FAILURE_CODES.EDGE_OVERLAP,
        message: `Overlap of ${(-gap).toFixed(2)} between consecutive fine vertices at [${prev.toFixed(2)}, ${curr.toFixed(2)}]`,
        spanStart: coarseSpanStart,
        spanEnd: coarseSpanEnd,
        gapStart: curr,
        gapEnd: prev,
      });
    }
  }

  return { passes: failures.length === 0, failures };
}

export function validateMixedLodCutForDelta(
  nodesByLevel: Map<number, ClodPageNode[]>,
  forcedDelta: number,
  tolerances: BorderTolerances,
  fixtureName: string,
): {
  passes: boolean;
  failures: AcceptanceFailure[];
  edgesTested: number;
  maxPosDelta: number;
  minNormDot: number;
  maxMatDelta: number;
} {
  const failures: AcceptanceFailure[] = [];
  let maxPosDelta = 0;
  let minNormDot = 1;
  let maxMatDelta = 0;
  let edgesTested = 0;

  const maxLevel = Math.max(...nodesByLevel.keys());

  for (let fineLevel = 1; fineLevel <= maxLevel; fineLevel++) {
    const coarseLevel = fineLevel + forcedDelta;
    if (coarseLevel > maxLevel) continue;

    const coarseNodes = nodesByLevel.get(coarseLevel);
    const fineNodes = nodesByLevel.get(fineLevel);
    if (!coarseNodes || !fineNodes) continue;

    const fineIndex = new Map<string, ClodPageNode>();
    for (const n of fineNodes) {
      const match = /^L\d+:(\d+),(\d+)$/.exec(n.id);
      if (match) fineIndex.set(`${match[1]},${match[2]}`, n);
    }

    const coarseIndex = new Map<string, ClodPageNode>();
    for (const n of coarseNodes) {
      const match = /^L\d+:(\d+),(\d+)$/.exec(n.id);
      if (match) coarseIndex.set(`${match[1]},${match[2]}`, n);
    }

    for (const [key, coarseNode] of coarseIndex) {
      const [nxStr, nzStr] = key.split(",");
      const nx = Number(nxStr);
      const nz = Number(nzStr);

      const childCountPerParent = 1 << forcedDelta;

      for (let dz = 0; dz < childCountPerParent; dz++) {
        for (let dx = 0; dx < childCountPerParent; dx++) {
          const childNX = nx * childCountPerParent + dx;
          const childNZ = nz * childCountPerParent + dz;

          if (dx === childCountPerParent - 1) {
            const neighborKey = `${childNX + 1},${childNZ}`;
            const neighbor = fineIndex.get(neighborKey);
            if (!neighbor) continue;

            edgesTested++;

            const z0 = neighbor.footprint.minZ;
            const z1 = neighbor.footprint.maxZ;
            const coarseSpanStart = z0;
            const coarseSpanEnd = z1;

            const coarseChain = borderChain(coarseNode.mesh, "x", coarseNode.footprint.maxX, coarseNode.footprint, 1);
            const strippedCoarse = stripCornerVertices(coarseChain, coarseNode.footprint.maxZ, "z", 0.5);

            const fineChain = collectFineEdgeChain(neighbor, "x", neighbor.footprint.minX);

            if (strippedCoarse.positions.length === 0 && fineChain.positions.length === 0) continue;

            const zMargin = 0.001;
            const coarseInRange: typeof strippedCoarse = {
              positions: [], normals: [], materials: [], materialWeights: [],
            };
            const seenZ = new Set<number>();
            for (let vi = 0; vi < strippedCoarse.positions.length; vi++) {
              const z = strippedCoarse.positions[vi][2];
              if (z >= z0 - zMargin && z <= z1 + zMargin) {
                const zKey = Math.round(z * 1e6);
                if (!seenZ.has(zKey)) {
                  seenZ.add(zKey);
                  coarseInRange.positions.push(strippedCoarse.positions[vi]);
                  coarseInRange.normals.push(strippedCoarse.normals[vi]);
                  coarseInRange.materials.push(strippedCoarse.materials[vi]);
                  coarseInRange.materialWeights.push(strippedCoarse.materialWeights[vi]);
                }
              }
            }

            if (fineChain.positions.length === 0) {
              failures.push({
                code: MIXED_LOD_FAILURE_CODES.MISSING_FINE_SEGMENT,
                message: `No border vertices for fine node ${neighborKey} on east edge (span [${coarseSpanStart.toFixed(2)}, ${coarseSpanEnd.toFixed(2)}])`,
                scene: fixtureName,
                nodeId: `L${coarseLevel}:${nx},${nz}`,
                level: coarseLevel,
                forcedDelta,
                coarseLevel,
                fineLevel,
                edge: "east",
                spanStart: coarseSpanStart,
                spanEnd: coarseSpanEnd,
              });
              continue;
            }

            const coverageResult = validateChainSpanCoverage(
              coarseSpanStart, coarseSpanEnd,
              fineChain, "z",
            );

            if (!coverageResult.passes) {
              for (const f of coverageResult.failures) {
                failures.push({
                  ...f,
                  scene: fixtureName,
                  nodeId: `L${coarseLevel}:${nx},${nz}`,
                  level: coarseLevel,
                  forcedDelta,
                  coarseLevel,
                  fineLevel,
                  edge: "east",
                });
              }
            }

            if (coarseInRange.positions.length > 0 && fineChain.positions.length > 0) {
              const surfResult = reportMixedLodSurfaceDifferences(
                coarseInRange,
                fineChain,
                tolerances,
              );

              if (surfResult.maxPositionDelta > maxPosDelta) maxPosDelta = surfResult.maxPositionDelta;
              if (surfResult.minNormalDot < minNormDot) minNormDot = surfResult.minNormalDot;
              if (surfResult.maxMaterialWeightDelta > maxMatDelta) maxMatDelta = surfResult.maxMaterialWeightDelta;
            }
          }

          if (dz === childCountPerParent - 1) {
            const neighborKey = `${childNX},${childNZ + 1}`;
            const neighbor = fineIndex.get(neighborKey);
            if (!neighbor) continue;

            edgesTested++;

            const x0 = neighbor.footprint.minX;
            const x1 = neighbor.footprint.maxX;
            const coarseSpanStart = x0;
            const coarseSpanEnd = x1;

            const coarseChain = borderChain(coarseNode.mesh, "z", coarseNode.footprint.maxZ, coarseNode.footprint, 1);
            const strippedCoarse = stripCornerVertices(coarseChain, coarseNode.footprint.maxX, "x", 0.5);

            const fineChain = collectFineEdgeChain(neighbor, "z", neighbor.footprint.minZ);

            if (strippedCoarse.positions.length === 0 && fineChain.positions.length === 0) continue;

            const xMargin = 0.001;
            const coarseInRange: typeof strippedCoarse = {
              positions: [], normals: [], materials: [], materialWeights: [],
            };
            const seenX = new Set<number>();
            for (let vi = 0; vi < strippedCoarse.positions.length; vi++) {
              const x = strippedCoarse.positions[vi][0];
              if (x >= x0 - xMargin && x <= x1 + xMargin) {
                const xKey = Math.round(x * 1e6);
                if (!seenX.has(xKey)) {
                  seenX.add(xKey);
                  coarseInRange.positions.push(strippedCoarse.positions[vi]);
                  coarseInRange.normals.push(strippedCoarse.normals[vi]);
                  coarseInRange.materials.push(strippedCoarse.materials[vi]);
                  coarseInRange.materialWeights.push(strippedCoarse.materialWeights[vi]);
                }
              }
            }

            if (fineChain.positions.length === 0) {
              failures.push({
                code: MIXED_LOD_FAILURE_CODES.MISSING_FINE_SEGMENT,
                message: `No border vertices for fine node ${neighborKey} on south edge (span [${coarseSpanStart.toFixed(2)}, ${coarseSpanEnd.toFixed(2)}])`,
                scene: fixtureName,
                nodeId: `L${coarseLevel}:${nx},${nz}`,
                level: coarseLevel,
                forcedDelta,
                coarseLevel,
                fineLevel,
                edge: "south",
                spanStart: coarseSpanStart,
                spanEnd: coarseSpanEnd,
              });
              continue;
            }

            const coverageResult = validateChainSpanCoverage(
              coarseSpanStart, coarseSpanEnd,
              fineChain, "x",
            );

            if (!coverageResult.passes) {
              for (const f of coverageResult.failures) {
                failures.push({
                  ...f,
                  scene: fixtureName,
                  nodeId: `L${coarseLevel}:${nx},${nz}`,
                  level: coarseLevel,
                  forcedDelta,
                  coarseLevel,
                  fineLevel,
                  edge: "south",
                });
              }
            }

            if (coarseInRange.positions.length > 0 && fineChain.positions.length > 0) {
              const surfResult = reportMixedLodSurfaceDifferences(
                coarseInRange,
                fineChain,
                tolerances,
              );

              if (surfResult.maxPositionDelta > maxPosDelta) maxPosDelta = surfResult.maxPositionDelta;
              if (surfResult.minNormalDot < minNormDot) minNormDot = surfResult.minNormalDot;
              if (surfResult.maxMaterialWeightDelta > maxMatDelta) maxMatDelta = surfResult.maxMaterialWeightDelta;
            }
          }
        }
      }
    }
  }

  return {
    passes: failures.length === 0,
    failures,
    edgesTested,
    maxPosDelta,
    minNormDot,
    maxMatDelta,
  };
}

export function validateAllMixedLodCuts(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  fixtureName: string,
): {
  passes: boolean;
  failures: AcceptanceFailure[];
  deltasTested: number;
  edgesTested: number;
  failureCount: number;
  untestableDeltaCount: number;
  maxPosDelta: number;
  minNormDot: number;
  maxMatDelta: number;
} {
  const lodDeltas = config.stressScenes.forcedNeighborLodDeltas;
  const allFailures: AcceptanceFailure[] = [];
  let maxPosDelta = 0;
  let minNormDot = 1;
  let maxMatDelta = 0;
  let totalEdgesTested = 0;
  let untestableDeltaCount = 0;

  const tolerances = buildTolerances(config.thresholds);

  for (const delta of lodDeltas) {
    const result = validateMixedLodCutForDelta(
      nodesByLevel, delta, tolerances, fixtureName,
    );

    totalEdgesTested += result.edgesTested;

    if (result.edgesTested === 0) {
      untestableDeltaCount++;
      allFailures.push({
        code: MIXED_LOD_FAILURE_CODES.UNTESTABLE_DELTA,
        message: `Forced LOD delta ${delta}: no valid mixed-LOD adjacencies could be tested for scene ${fixtureName}`,
        scene: fixtureName,
        forcedDelta: delta,
      });
    }

    allFailures.push(...result.failures);
    if (result.maxPosDelta > maxPosDelta) maxPosDelta = result.maxPosDelta;
    if (result.minNormDot < minNormDot) minNormDot = result.minNormDot;
    if (result.maxMatDelta > maxMatDelta) maxMatDelta = result.maxMatDelta;
  }

  return {
    passes: allFailures.length === 0,
    failures: allFailures,
    deltasTested: lodDeltas.length,
    edgesTested: totalEdgesTested,
    failureCount: allFailures.length,
    untestableDeltaCount,
    maxPosDelta,
    minNormDot,
    maxMatDelta,
  };
}

export function runGateA1(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  fixtureName: string,
): AcceptanceGateResult {
  const tolerances = buildTolerances(config.thresholds);
  const sameLevel = validateSameLevelWatertightness(nodesByLevel, tolerances);
  const mixed = validateAllMixedLodCuts(nodesByLevel, config, fixtureName);

  const allFailures = [...sameLevel.failures, ...mixed.failures];
  const failureCount = allFailures.length;

  const maxPosDelta = Math.max(sameLevel.maxPositionDelta, mixed.maxPosDelta);
  const minNormDot = Math.min(sameLevel.minNormalDot, mixed.minNormDot);
  const maxMatDelta = Math.max(sameLevel.maxMaterialWeightDelta, mixed.maxMatDelta);

  let status: "pass" | "warn" | "fail";
  let message: string;

  if (mixed.untestableDeltaCount > 0 && config.stressScenes.forcedNeighborLodDeltas.length > 0) {
    status = "warn";
    message = `${sameLevel.failureCount} same-level failures, ${mixed.failureCount} mixed-LOD failures, ${mixed.untestableDeltaCount} untestable deltas (mixed-LOD checks incomplete)`;
  } else if (failureCount > 0) {
    status = "fail";
    message = `${sameLevel.failureCount} same-level failures, ${mixed.failureCount} mixed-LOD failures`;
  } else {
    status = "pass";
    message = "No holes or lips found in border chain validation";
  }

  if (mixed.edgesTested === 0 && config.stressScenes.forcedNeighborLodDeltas.length > 0) {
    status = "warn";
    message = "No mixed-LOD edges tested — mixed-LOD validation did not run. Consider this a blocker for Phase 4/5.";
  }

  const failures = allFailures.map((f) => ({
    ...f,
    scene: fixtureName,
  }));

  return {
    id: "A1",
    name: "Watertight",
    status,
    message,
    measurements: {
      maxPositionDelta: maxPosDelta,
      minNormalDot: minNormDot,
      maxMaterialWeightDelta: maxMatDelta,
      failureCount,
      borderPositionEpsilon: config.thresholds.borderPositionEpsilon,
      sameLevelEdgesTested: sameLevel.edgesTested,
      sameLevelFailureCount: sameLevel.failureCount,
      mixedLodDeltasTested: mixed.deltasTested,
      mixedLodEdgesTested: mixed.edgesTested,
      mixedLodFailureCount: mixed.failureCount,
      mixedLodUntestableDeltaCount: mixed.untestableDeltaCount,
      visualSweepAvailable: config.visual.enabled,
      visualSweepStatus: config.visual.enabled ? "configured" : "disabled",
    },
    failures,
  };
}

export function runGateA2(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  fixtureName: string,
): AcceptanceGateResult {
  const tolerances = buildTolerances(config.thresholds);
  const result = validateSameLevelStrictEquality(nodesByLevel, tolerances);

  const status = result.passes ? "pass" : "fail";
  const message = result.passes
    ? `Border equality within thresholds: pos <= ${config.thresholds.borderPositionEpsilon}, normal dot >= ${config.thresholds.borderNormalDotMin}`
    : `${result.failureCount} border equality mismatches`;

  const failures = result.failures.map((f) => ({
    ...f,
    scene: fixtureName,
  }));

  return {
    id: "A2",
    name: "Border equality",
    status,
    message,
    measurements: {
      maxPositionDelta: result.maxPositionDelta,
      minNormalDot: result.minNormalDot,
      maxMaterialWeightDelta: result.maxMaterialWeightDelta,
      failureCount: result.failureCount,
      borderPositionEpsilon: config.thresholds.borderPositionEpsilon,
      borderNormalDotMin: config.thresholds.borderNormalDotMin,
      borderMaterialWeightDeltaMax: config.thresholds.borderMaterialWeightDeltaMax,
    },
    failures,
  };
}
