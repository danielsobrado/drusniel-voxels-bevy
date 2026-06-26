import type { AadfDistances, MipSummaryNode } from "./types.js";
import type { NaadfPocConfig } from "./config.js";

const MATERIAL_VARIANCE_REFINE = 0.15;
const NORMAL_VARIANCE_REFINE = 0.08;

export function computeAadfForMipNode(
  node: MipSummaryNode,
  regionCells: number,
  cellSizeM: number,
): AadfDistances {
  const cellM = cellSizeM;
  if (!node.occupiedAny) {
    const emptySkip = regionCells * cellM;
    return {
      posX: emptySkip,
      negX: emptySkip,
      posZ: emptySkip,
      negZ: emptySkip,
      posY: emptySkip,
      negY: emptySkip,
    };
  }

  const heightSpan = Math.max(cellM, node.maxHeight - node.minHeight);
  const conservativePlanar = node.normalVariance > NORMAL_VARIANCE_REFINE
    || node.materialVariance > MATERIAL_VARIANCE_REFINE
    ? cellM
    : Math.min(regionCells * cellM, cellM * Math.max(1, regionCells * 0.25));

  return {
    posX: conservativePlanar,
    negX: conservativePlanar,
    posZ: conservativePlanar,
    negZ: conservativePlanar,
    posY: Math.max(cellM, heightSpan * 0.5),
    negY: Math.max(cellM, heightSpan * 0.5),
  };
}

export function nodeRequiresRefine(node: MipSummaryNode, config: NaadfPocConfig): boolean {
  if (!node.occupiedAny) return false;
  if (!node.occupiedAll && config.mipSummary.mixedNodesRefine) return true;
  if (node.materialVariance > MATERIAL_VARIANCE_REFINE) return true;
  if (node.normalVariance > NORMAL_VARIANCE_REFINE) return true;
  return false;
}

export function estimateSafeSkipDistance(
  params: {
    node: MipSummaryNode;
    rayDirX: number;
    rayDirY: number;
    rayDirZ: number;
    cellSizeM: number;
    nextCellBoundaryDistanceM: number;
    epsilonM: number;
    config: NaadfPocConfig;
  },
): number {
  const { node, rayDirX, rayDirY, rayDirZ, cellSizeM, nextCellBoundaryDistanceM, epsilonM, config } = params;
  const eps = Math.max(epsilonM, 1e-6);
  const boundary = Math.max(eps, nextCellBoundaryDistanceM);

  if (!node.occupiedAny) {
    if (!config.mipSummary.conservativeEmptySkip) {
      return Math.min(boundary, cellSizeM);
    }
    const dirs = [
      { d: rayDirX, aadf: node.aadfPosX },
      { d: -rayDirX, aadf: node.aadfNegX },
      { d: rayDirZ, aadf: node.aadfPosZ },
      { d: -rayDirZ, aadf: node.aadfNegZ },
      { d: rayDirY, aadf: node.aadfPosY },
      { d: -rayDirY, aadf: node.aadfNegY },
    ];
    let maxSkip = eps;
    for (const { d, aadf } of dirs) {
      if (d > 1e-6) {
        maxSkip = Math.max(maxSkip, Math.min(aadf, boundary));
      }
    }
    return Math.min(maxSkip, boundary);
  }

  if (nodeRequiresRefine(node, config)) {
    return Math.min(boundary, cellSizeM);
  }

  const planar = Math.min(
    rayDirX > 0 ? node.aadfPosX : rayDirX < 0 ? node.aadfNegX : cellSizeM,
    rayDirZ > 0 ? node.aadfPosZ : rayDirZ < 0 ? node.aadfNegZ : cellSizeM,
    rayDirY > 0 ? node.aadfPosY : rayDirY < 0 ? node.aadfNegY : cellSizeM,
  );

  const skip = Math.max(eps, Math.min(planar, boundary, cellSizeM));
  if (!Number.isFinite(skip) || skip < 0) return eps;
  return skip;
}

export function sunNodeBlocksRay(
  node: MipSummaryNode,
  sampleY: number,
  config: NaadfPocConfig,
): "blocked" | "visible" | "refine" | "unknown" {
  if (!node.occupiedAny) return "visible";
  if (nodeRequiresRefine(node, config)) return "refine";
  if (sampleY < node.minHeight || sampleY > node.maxHeight) return "visible";
  return "blocked";
}
