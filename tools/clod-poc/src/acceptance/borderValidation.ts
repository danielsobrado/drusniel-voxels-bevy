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
  allowLengthMismatch = false,
): { passes: boolean; maxPositionDelta: number; minNormalDot: number; maxMaterialWeightDelta: number; failures: AcceptanceFailure[] } {
  const failures: AcceptanceFailure[] = [];

  if (left.positions.length !== right.positions.length && !allowLengthMismatch) {
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

  if (allowLengthMismatch && left.positions.length !== right.positions.length) {
    const diff = Math.abs(left.positions.length - right.positions.length);
    if (diff > 3) {
      failures.push({
        code: "BORDER_CHAIN_LENGTH_MISMATCH",
        message: `Mixed-LOD chain length mismatch: ${left.positions.length} vs ${right.positions.length} (diff ${diff}, threshold 3)`,
        value: left.positions.length,
        threshold: right.positions.length,
      });
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

export function validateMixedLodCut(
  nodesByLevel: Map<number, ClodPageNode[]>,
  forcedDelta: number,
  tolerances: BorderTolerances,
  fixtureName: string,
): { passes: boolean; failures: AcceptanceFailure[]; maxPosDelta: number; minNormDot: number; maxMatDelta: number } {
  const failures: AcceptanceFailure[] = [];
  let maxPosDelta = 0;
  let minNormDot = 1;
  let maxMatDelta = 0;

  const maxLevel = Math.max(...nodesByLevel.keys());

  for (let lowLevel = 1; lowLevel <= maxLevel; lowLevel++) {
    const highLevel = lowLevel + forcedDelta;
    if (highLevel > maxLevel) continue;

    const highNodes = nodesByLevel.get(highLevel);
    const lowNodes = nodesByLevel.get(lowLevel);
    if (!highNodes || !lowNodes) continue;

    const lowIndex = new Map<string, ClodPageNode>();
    for (const n of lowNodes) {
      const match = /^L\d+:(\d+),(\d+)$/.exec(n.id);
      if (match) lowIndex.set(`${match[1]},${match[2]}`, n);
    }

    const highIndex = new Map<string, ClodPageNode>();
    for (const n of highNodes) {
      const match = /^L\d+:(\d+),(\d+)$/.exec(n.id);
      if (match) highIndex.set(`${match[1]},${match[2]}`, n);
    }

    for (const [key, highNode] of highIndex) {
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
            const neighbor = lowIndex.get(neighborKey);
            if (!neighbor) continue;

            const z0 = neighbor.footprint.minZ;
            const z1 = neighbor.footprint.maxZ;

            const hcChain = borderChain(highNode.mesh, "x", highNode.footprint.maxX, highNode.footprint, 1);
            const nChain = borderChain(neighbor.mesh, "x", neighbor.footprint.minX, neighbor.footprint, 1);

            const strippedHc = stripCornerVertices(hcChain, highNode.footprint.maxZ, "z", 0.5);
            const strippedN = stripCornerVertices(nChain, neighbor.footprint.maxZ, "z", 0.5);

            const zMargin = 0.001;
            const highInRange: typeof hcChain = {
              positions: [], normals: [], materials: [], materialWeights: [],
            };
            const seenZ = new Set<number>();
            for (let vi = 0; vi < strippedHc.positions.length; vi++) {
              const z = strippedHc.positions[vi][2];
              if (z >= z0 - zMargin && z <= z1 + zMargin) {
                const zKey = Math.round(z * 1e6);
                if (!seenZ.has(zKey)) {
                  seenZ.add(zKey);
                  highInRange.positions.push(strippedHc.positions[vi]);
                  highInRange.normals.push(strippedHc.normals[vi]);
                  highInRange.materials.push(strippedHc.materials[vi]);
                  highInRange.materialWeights.push(strippedHc.materialWeights[vi]);
                }
              }
            }

            if (highInRange.positions.length === 0 || strippedN.positions.length === 0) continue;

            const result = compareBorderChains(highInRange, strippedN, tolerances, true);
            if (result.maxPositionDelta > maxPosDelta) maxPosDelta = result.maxPositionDelta;
            if (result.minNormalDot < minNormDot) minNormDot = result.minNormalDot;
            if (result.maxMaterialWeightDelta > maxMatDelta) maxMatDelta = result.maxMaterialWeightDelta;
            if (!result.passes) {
              for (const f of result.failures) {
                failures.push({
                  ...f,
                  scene: fixtureName,
                  nodeId: `L${highLevel}:${nx},${nz}(qdx${dx}) vs L${lowLevel}:${neighborKey}`,
                  level: highLevel,
                  edge: "east",
                });
              }
            }
          }

          if (dz === childCountPerParent - 1) {
            const neighborKey = `${childNX},${childNZ + 1}`;
            const neighbor = lowIndex.get(neighborKey);
            if (!neighbor) continue;

            const x0 = neighbor.footprint.minX;
            const x1 = neighbor.footprint.maxX;

            const hcChain = borderChain(highNode.mesh, "z", highNode.footprint.maxZ, highNode.footprint, 1);
            const nChain = borderChain(neighbor.mesh, "z", neighbor.footprint.minZ, neighbor.footprint, 1);

            const strippedHc = stripCornerVertices(hcChain, highNode.footprint.maxX, "x", 0.5);
            const strippedN = stripCornerVertices(nChain, neighbor.footprint.maxZ, "z", 0.5);

            const xMargin = 0.001;
            const highInRange: typeof hcChain = {
              positions: [], normals: [], materials: [], materialWeights: [],
            };
            const seenX = new Set<number>();
            for (let vi = 0; vi < strippedHc.positions.length; vi++) {
              const x = strippedHc.positions[vi][0];
              if (x >= x0 - xMargin && x <= x1 + xMargin) {
                const xKey = Math.round(x * 1e6);
                if (!seenX.has(xKey)) {
                  seenX.add(xKey);
                  highInRange.positions.push(strippedHc.positions[vi]);
                  highInRange.normals.push(strippedHc.normals[vi]);
                  highInRange.materials.push(strippedHc.materials[vi]);
                  highInRange.materialWeights.push(strippedHc.materialWeights[vi]);
                }
              }
            }

            if (highInRange.positions.length === 0 || strippedN.positions.length === 0) continue;

            const result = compareBorderChains(highInRange, strippedN, tolerances, true);
            if (result.maxPositionDelta > maxPosDelta) maxPosDelta = result.maxPositionDelta;
            if (result.minNormalDot < minNormDot) minNormDot = result.minNormalDot;
            if (result.maxMaterialWeightDelta > maxMatDelta) maxMatDelta = result.maxMaterialWeightDelta;
            if (!result.passes) {
              for (const f of result.failures) {
                failures.push({
                  ...f,
                  scene: fixtureName,
                  nodeId: `L${highLevel}:${nx},${nz}(qdz${dz}) vs L${lowLevel}:${neighborKey}`,
                  level: highLevel,
                  edge: "south",
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
    maxPosDelta,
    minNormDot,
    maxMatDelta,
  };
}

export function runMixedLodCutCheck(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  lodDeltas: number[],
  fixtureName: string,
): AcceptanceGateResult {
  const tolerances = buildTolerances(config.thresholds);
  const allFailures: AcceptanceFailure[] = [];
  let maxPosDelta = 0;
  let minNormDot = 1;
  let maxMatDelta = 0;

  for (const delta of lodDeltas) {
    const result = validateMixedLodCut(nodesByLevel, delta, tolerances, fixtureName);
    allFailures.push(...result.failures);
    if (result.maxPosDelta > maxPosDelta) maxPosDelta = result.maxPosDelta;
    if (result.minNormDot < minNormDot) minNormDot = result.minNormDot;
    if (result.maxMatDelta > maxMatDelta) maxMatDelta = result.maxMatDelta;
  }

  const status = allFailures.length === 0 ? "pass" : "fail";
  const testedDeltas = lodDeltas.join(",");

  return {
    id: "A1",
    name: "Watertight (mixed LOD)",
    status,
    message: status === "pass"
      ? `Mixed-LOD cuts pass for deltas ${testedDeltas}`
      : `${allFailures.length} mixed-LOD border failures for deltas ${testedDeltas}`,
    measurements: {
      testedLodDeltas: testedDeltas,
      mixedLodMaxPositionDelta: maxPosDelta,
      mixedLodMinNormalDot: minNormDot,
      mixedLodMaxMaterialWeightDelta: maxMatDelta,
      mixedLodFailureCount: allFailures.length,
    },
    failures: allFailures.map((f) => ({ ...f, scene: fixtureName })),
  };
}
