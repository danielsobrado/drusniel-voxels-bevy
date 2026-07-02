import type { BorderTolerances, ClodPageNode } from "../types.js";
import { borderChain } from "../clod/validate.js";
import type { AcceptanceConfig, AcceptanceFailure } from "./acceptanceTypes.js";
import { MIXED_LOD_FAILURE_CODES } from "./acceptanceTypes.js";
import type { AllMixedLodResult } from "./borderValidationTypes.js";
import {
  buildTolerances,
  collectFineEdgeChain,
  reportMixedLodSurfaceDifferences,
  stripCornerVertices,
  validateIntervalCoverage,
} from "./borderChainComparison.js";

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

    const fineIndex = indexNodesByGridKey(fineNodes);
    const coarseIndex = indexNodesByGridKey(coarseNodes);

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

          const coarseInRange = collectCoarseChainInRange(strippedCoarse, freeAxis, coarseSpanStart, coarseSpanEnd);

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

function indexNodesByGridKey(nodes: ClodPageNode[]): Map<string, ClodPageNode> {
  const index = new Map<string, ClodPageNode>();
  for (const node of nodes) {
    const match = /^L\d+:(\d+),(\d+)$/.exec(node.id);
    if (match) index.set(`${match[1]},${match[2]}`, node);
  }
  return index;
}

function collectCoarseChainInRange(
  strippedCoarse: ReturnType<typeof borderChain>,
  freeAxis: "x" | "z",
  coarseSpanStart: number,
  coarseSpanEnd: number,
): ReturnType<typeof borderChain> {
  const margin = 0.001;
  const coarseInRange: ReturnType<typeof borderChain> = {
    positions: [],
    normals: [],
    materials: [],
    materialWeights: [],
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
  return coarseInRange;
}
