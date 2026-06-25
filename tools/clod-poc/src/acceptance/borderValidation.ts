import type { PageMesh, ClodPageNode, BorderTolerances, PageFootprint } from "../types.js";
import { borderChain } from "../validate.js";
import type {
  AcceptanceGateResult,
  AcceptanceFailure,
  AcceptanceThresholds,
} from "./acceptanceTypes.js";
import type { AcceptanceConfig } from "./acceptanceTypes.js";

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

  for (let i = 0; i < left.positions.length; i++) {
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

  const result = compareBorderChains(aChain, bChain, tolerances);
  return result;
}

export function validateWatertightCut(
  nodesByLevel: Map<number, ClodPageNode[]>,
  tolerances: BorderTolerances,
): BorderValidationOutput {
  const failures: AcceptanceFailure[] = [];
  let maxPositionDelta = 0;
  let minNormalDot = 1;
  let maxMaterialWeightDelta = 0;

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
    maxPositionDelta,
    minNormalDot,
    maxMaterialWeightDelta,
    failures,
    failureCount: failures.length,
  };
}

export function validateBorderEquality(
  nodesByLevel: Map<number, ClodPageNode[]>,
  tolerances: BorderTolerances,
): BorderValidationOutput {
  return validateWatertightCut(nodesByLevel, tolerances);
}

export function runGateA1(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  fixtureName: string,
): AcceptanceGateResult {
  const tolerances = buildTolerances(config.thresholds);
  const result = validateWatertightCut(nodesByLevel, tolerances);

  const status = result.passes ? "pass" : "fail";
  const message = result.passes
    ? "No holes or lips found in border chain validation"
    : `${result.failureCount} border failures detected`;

  const failures = result.failures.map((f) => ({
    ...f,
    scene: fixtureName,
  }));

  return {
    id: "A1",
    name: "Watertight",
    status,
    message,
    measurements: {
      maxPositionDelta: result.maxPositionDelta,
      minNormalDot: result.minNormalDot,
      maxMaterialWeightDelta: result.maxMaterialWeightDelta,
      failureCount: result.failureCount,
      borderPositionEpsilon: config.thresholds.borderPositionEpsilon,
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
  const result = validateBorderEquality(nodesByLevel, tolerances);

  const status = result.passes ? "pass" : "fail";
  const message = result.passes
    ? "Border equality within thresholds"
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

export function validateHighVsLowDetailChain(
  highDetail: ReturnType<typeof borderChain>,
  lowDetailChains: ReturnType<typeof borderChain>[],
  tolerances: BorderTolerances,
): { passes: boolean; failures: AcceptanceFailure[] } {
  const failures: AcceptanceFailure[] = [];

  const lowVertices = lowDetailChains.reduce((s, c) => s + c.positions.length, 0);
  if (highDetail.positions.length < lowVertices) {
    failures.push({
      code: "BORDER_CHAIN_COVERAGE_GAP",
      message: `High-detail chain has ${highDetail.positions.length} vertices but low-detail chain union has ${lowVertices}`,
      value: highDetail.positions.length,
      threshold: lowVertices,
    });
    return { passes: false, failures };
  }

  return { passes: failures.length === 0, failures };
}
