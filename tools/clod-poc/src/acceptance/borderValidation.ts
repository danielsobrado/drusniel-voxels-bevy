import type { PageMesh, ClodPageNode, BorderTolerances, PageFootprint } from "../types.js";
import { borderChain } from "../clod/validate.js";
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



export interface FootprintInterval {
  start: number;
  end: number;
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

export function validateMixedLodCutForDelta(
  nodesByLevel: Map<number, ClodPageNode[]>,
  forcedDelta: number,
  tolerances: BorderTolerances,
  fixtureName: string,
): {
  passes: boolean;
  failures: AcceptanceFailure[];
  surfaceFindings: AcceptanceFailure[];
  edgesTested: number;
  maxPosDelta: number;
  minNormDot: number;
  maxMatDelta: number;
} {
  const failures: AcceptanceFailure[] = [];
  const surfaceFindings: AcceptanceFailure[] = [];
  let maxPosDelta = 0;
  let minNormDot = 1;
  let maxMatDelta = 0;
  let edgesTested = 0;

  const maxLevel = Math.max(...nodesByLevel.keys());

  for (let fineLevel = 0; fineLevel <= maxLevel; fineLevel++) {
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

      for (const edgeDir of ["east", "south"] as const) {
        const isEast = edgeDir === "east";
        const coarseAxis: "x" | "z" = isEast ? "x" : "z";
        const freeAxis: "x" | "z" = isEast ? "z" : "x";

        const intervals: { start: number; end: number; neighbor: ClodPageNode }[] = [];
        const missingNeighborKeys: string[] = [];

        for (let dz = 0; dz < childCountPerParent; dz++) {
          for (let dx = 0; dx < childCountPerParent; dx++) {
            const isEdge = isEast ? dx === childCountPerParent - 1 : dz === childCountPerParent - 1;
            if (!isEdge) continue;

            const neighborKey = isEast
              ? `${nx * childCountPerParent + dx + 1},${nz * childCountPerParent + dz}`
              : `${nx * childCountPerParent + dx},${nz * childCountPerParent + dz + 1}`;

            const neighbor = fineIndex.get(neighborKey);
            if (!neighbor) {
              missingNeighborKeys.push(neighborKey);
              continue;
            }

            const spanCoord = freeAxis === "x" ? "minX" as const : "minZ" as const;
            const spanEnd = freeAxis === "x" ? "maxX" as const : "maxZ" as const;
            intervals.push({ start: neighbor.footprint[spanCoord], end: neighbor.footprint[spanEnd], neighbor });
          }
        }

        if (intervals.length === 0 && missingNeighborKeys.length === 0) continue;
        if (intervals.length === 0 && missingNeighborKeys.length > 0) continue;

        for (const neighborKey of missingNeighborKeys) {
          failures.push({
            code: MIXED_LOD_FAILURE_CODES.MISSING_FINE_SEGMENT,
            message: `Missing fine node ${neighborKey} for ${edgeDir} edge of coarse L${coarseLevel}:${nx},${nz} (delta ${forcedDelta})`,
            scene: fixtureName,
            nodeId: `L${coarseLevel}:${nx},${nz}`,
            level: coarseLevel,
            forcedDelta,
            coarseLevel,
            fineLevel,
            edge: edgeDir,
            spanStart: isEast ? coarseNode.footprint.minZ : coarseNode.footprint.minX,
            spanEnd: isEast ? coarseNode.footprint.maxZ : coarseNode.footprint.maxX,
          });
        }

        edgesTested++;

        const coarseSpanStart = isEast ? coarseNode.footprint.minZ : coarseNode.footprint.minX;
        const coarseSpanEnd = isEast ? coarseNode.footprint.maxZ : coarseNode.footprint.maxX;

        const intervalData = intervals.map((i) => ({ start: i.start, end: i.end }));
        const ivResult = validateIntervalCoverage(intervalData, coarseSpanStart, coarseSpanEnd);
        if (!ivResult.passes) {
          for (const f of ivResult.failures) {
            failures.push({
              ...f,
              scene: fixtureName,
              nodeId: `L${coarseLevel}:${nx},${nz}`,
              level: coarseLevel,
              forcedDelta,
              coarseLevel,
              fineLevel,
              edge: edgeDir,
            });
          }
        }

        if (missingNeighborKeys.length === 0) {
          const planeKey = coarseAxis === "x" ? "maxX" as const : "maxZ" as const;
          const coarseChain = borderChain(coarseNode.mesh, coarseAxis, coarseNode.footprint[planeKey], coarseNode.footprint, 1);
          const cornerBoundary = isEast ? coarseNode.footprint.maxZ : coarseNode.footprint.maxX;
          const strippedCoarse = stripCornerVertices(coarseChain, cornerBoundary, freeAxis, 0.5);

          const margin = 0.001;
          const coarseInRange: typeof strippedCoarse = {
            positions: [], normals: [], materials: [], materialWeights: [],
          };
          const seen = new Set<number>();
          const axisIdx = freeAxis === "x" ? 0 : 2;
          for (let vi = 0; vi < strippedCoarse.positions.length; vi++) {
            const coord = strippedCoarse.positions[vi][axisIdx];
            if (coord >= coarseSpanStart - margin && coord <= coarseSpanEnd + margin) {
              const key = Math.round(coord * 1e6);
              if (!seen.has(key)) {
                seen.add(key);
                coarseInRange.positions.push(strippedCoarse.positions[vi]);
                coarseInRange.normals.push(strippedCoarse.normals[vi]);
                coarseInRange.materials.push(strippedCoarse.materials[vi]);
                coarseInRange.materialWeights.push(strippedCoarse.materialWeights[vi]);
              }
            }
          }

          for (const { neighbor } of intervals) {
            const minKey = coarseAxis === "x" ? "minX" as const : "minZ" as const;
            const fineChain = collectFineEdgeChain(neighbor, coarseAxis, neighbor.footprint[minKey]);
            if (fineChain.positions.length > 0 && coarseInRange.positions.length > 0) {
              const surfResult = reportMixedLodSurfaceDifferences(coarseInRange, fineChain, tolerances);
              if (surfResult.maxPositionDelta > maxPosDelta) maxPosDelta = surfResult.maxPositionDelta;
              if (surfResult.minNormalDot < minNormDot) minNormDot = surfResult.minNormalDot;
              if (surfResult.maxMaterialWeightDelta > maxMatDelta) maxMatDelta = surfResult.maxMaterialWeightDelta;
              for (const finding of surfResult.findings) {
                surfaceFindings.push({
                  ...finding,
                  scene: fixtureName,
                  nodeId: `L${coarseLevel}:${nx},${nz}`,
                  level: coarseLevel,
                  forcedDelta,
                  coarseLevel,
                  fineLevel,
                  edge: edgeDir,
                });
              }
            }
          }
        }
      }
    }
  }

  return {
    passes: failures.length === 0,
    failures,
    surfaceFindings,
    edgesTested,
    maxPosDelta,
    minNormDot,
    maxMatDelta,
  };
}

export interface AllMixedLodResult {
  passes: boolean;
  failures: AcceptanceFailure[];
  surfaceFindings: AcceptanceFailure[];
  deltasTested: number;
  edgesTested: number;
  failureCount: number;
  untestableDeltaCount: number;
  maxPosDelta: number;
  minNormDot: number;
  maxMatDelta: number;
}

export function validateAllMixedLodCuts(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  fixtureName: string,
): AllMixedLodResult {
  const lodDeltas = config.stressScenes.forcedNeighborLodDeltas;
  const allFailures: AcceptanceFailure[] = [];
  const allSurfaceFindings: AcceptanceFailure[] = [];
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
    allSurfaceFindings.push(...result.surfaceFindings);
    if (result.maxPosDelta > maxPosDelta) maxPosDelta = result.maxPosDelta;
    if (result.minNormDot < minNormDot) minNormDot = result.minNormDot;
    if (result.maxMatDelta > maxMatDelta) maxMatDelta = result.maxMatDelta;
  }

  return {
    passes: allFailures.length === 0,
    failures: allFailures,
    surfaceFindings: allSurfaceFindings,
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

  const realMixedFailures = mixed.failures.filter(
    (f) => f.code !== MIXED_LOD_FAILURE_CODES.UNTESTABLE_DELTA,
  );
  const allFailures = [
    ...sameLevel.failures,
    ...realMixedFailures,
  ];
  const failureCount = allFailures.length;

  const mixedEqualityCount = mixed.surfaceFindings.length;

  const maxPosDelta = Math.max(sameLevel.maxPositionDelta, mixed.maxPosDelta);
  const minNormDot = Math.min(sameLevel.minNormalDot, mixed.minNormDot);
  const maxMatDelta = Math.max(sameLevel.maxMaterialWeightDelta, mixed.maxMatDelta);

  let status: "pass" | "warn" | "fail";
  let message: string;

  if (sameLevel.failureCount > 0 || realMixedFailures.length > 0) {
    status = "fail";
    message = `${sameLevel.failureCount} same-level failures, ${realMixedFailures.length} mixed-LOD failures`;
  } else if (mixed.untestableDeltaCount > 0) {
    status = "warn";
    message = `No topology gaps found, but ${mixed.untestableDeltaCount} of ${config.stressScenes.forcedNeighborLodDeltas.length} configured deltas are untestable with the current hierarchy depth`;
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
      mixedLodSurfaceFindingsCount: mixedEqualityCount,
      visualSweepAvailable: false,
      visualSweepStatus: "disabled",
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
