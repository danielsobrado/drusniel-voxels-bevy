import type { BorderTolerances, ClodPageNode } from "../types.js";
import type { AcceptanceFailure } from "./acceptanceTypes.js";
import type { BorderValidationOutput } from "./borderValidationTypes.js";
import { compareBorderChains, readChainAtEdge } from "./borderChainComparison.js";

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
