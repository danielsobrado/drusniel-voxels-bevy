import type { ChunkBrick, ChunkMipChain, MipSummaryNode } from "./types.js";
import { computeAadfForMipNode } from "./aadf.js";

const EMPTY_HEIGHT_THRESHOLD = 0.001;

function dominantMaterial(materials: Uint16Array): { dominant: number; variance: number } {
  const counts = new Map<number, number>();
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i]!;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  let dominant = 0;
  let maxCount = 0;
  let total = 0;
  let sumSq = 0;
  for (const [mat, count] of counts) {
    total += count;
    sumSq += mat * mat * count;
    if (count > maxCount) {
      maxCount = count;
      dominant = mat;
    }
  }
  const mean = total > 0 ? [...counts.entries()].reduce((s, [m, c]) => s + m * c, 0) / total : 0;
  const variance = total > 0 ? Math.max(0, sumSq / total - mean * mean) : 0;
  return { dominant, variance };
}

function computeNormalVariance(
  heights: Float32Array,
  size: number,
  cellSize: number,
): { nx: number; ny: number; nz: number; variance: number } {
  let sumNx = 0;
  let sumNy = 0;
  let sumNz = 0;
  let sumVar = 0;
  let count = 0;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const idx = z * size + x;
      const h = heights[idx]!;
      const hL = x > 0 ? heights[idx - 1]! : h;
      const hR = x < size - 1 ? heights[idx + 1]! : h;
      const hD = z > 0 ? heights[idx - size]! : h;
      const hU = z < size - 1 ? heights[idx + size]! : h;
      const nx = hL - hR;
      const ny = 2 * cellSize;
      const nz = hD - hU;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-10) continue;
      const nnx = nx / len;
      const nny = ny / len;
      const nnz = nz / len;
      sumNx += nnx;
      sumNy += nny;
      sumNz += nnz;
      const slope = Math.acos(Math.max(0, Math.min(1, nny)));
      sumVar += slope * slope;
      count++;
    }
  }
  if (count === 0) return { nx: 0, ny: 1, nz: 0, variance: 0 };
  return {
    nx: sumNx / count,
    ny: sumNy / count,
    nz: sumNz / count,
    variance: sumVar / count,
  };
}

function summarizeRegion(
  brick: ChunkBrick,
  startX: number,
  startZ: number,
  regionSize: number,
  cellSizeM: number,
): MipSummaryNode {
  const { heights, materials, canopyCoverage, waterCoverage, sizeCells } = brick;
  let minH = Number.POSITIVE_INFINITY;
  let maxH = Number.NEGATIVE_INFINITY;
  let sumH = 0;
  let occupied = 0;
  let sumCanopy = 0;
  let sumWater = 0;
  const regionHeights = new Float32Array(regionSize * regionSize);
  const regionMaterials = new Uint16Array(regionSize * regionSize);
  let ri = 0;

  for (let z = 0; z < regionSize; z++) {
    for (let x = 0; x < regionSize; x++) {
      const gx = startX + x;
      const gz = startZ + z;
      if (gx >= sizeCells || gz >= sizeCells) {
        regionHeights[ri] = 0;
        regionMaterials[ri] = 0;
        ri++;
        continue;
      }
      const idx = gz * sizeCells + gx;
      const h = heights[idx]!;
      regionHeights[ri] = h;
      regionMaterials[ri] = materials[idx]!;
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
      sumH += h;
      if (Math.abs(h) > EMPTY_HEIGHT_THRESHOLD) occupied++;
      sumCanopy += canopyCoverage[idx]!;
      sumWater += waterCoverage[idx]!;
      ri++;
    }
  }

  const total = regionSize * regionSize;
  const occupiedAny = occupied > 0;
  const occupiedAll = occupied === total;
  const avgHeight = total > 0 ? sumH / total : 0;
  const { dominant, variance: materialVariance } = dominantMaterial(regionMaterials);
  const normal = computeNormalVariance(regionHeights, regionSize, cellSizeM);

  const node: MipSummaryNode = {
    occupiedAny,
    occupiedAll,
    minHeight: occupiedAny ? minH : 0,
    maxHeight: occupiedAny ? maxH : 0,
    avgHeight,
    avgNormalX: normal.nx,
    avgNormalY: normal.ny,
    avgNormalZ: normal.nz,
    normalVariance: normal.variance,
    dominantMaterial: dominant,
    materialVariance,
    aadfPosX: 0,
    aadfNegX: 0,
    aadfPosZ: 0,
    aadfNegZ: 0,
    aadfPosY: 0,
    aadfNegY: 0,
    canopyCoverage: total > 0 ? sumCanopy / total : 0,
    waterCoverage: total > 0 ? sumWater / total : 0,
  };

  const aadf = computeAadfForMipNode(node, regionSize, cellSizeM);
  return {
    ...node,
    aadfPosX: aadf.posX,
    aadfNegX: aadf.negX,
    aadfPosZ: aadf.posZ,
    aadfNegZ: aadf.negZ,
    aadfPosY: aadf.posY,
    aadfNegY: aadf.negY,
  };
}

export function buildMipChainFromBrick(
  brick: ChunkBrick,
  cellSizeM: number,
): ChunkMipChain {
  const size = brick.sizeCells;
  const levels: MipSummaryNode[][] = [];

  // level 0 = leaf cells (16x16 proxy)
  const level0: MipSummaryNode[] = [];
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      level0.push(summarizeRegion(brick, x, z, 1, cellSizeM));
    }
  }
  levels.push(level0);

  let currentSize = size;
  while (currentSize > 1) {
    const nextSize = currentSize >> 1;
    const nextLevel: MipSummaryNode[] = [];
    for (let z = 0; z < nextSize; z++) {
      for (let x = 0; x < nextSize; x++) {
        const subBrick = extractSubBrick(brick, x * 2, z * 2, Math.min(2, currentSize));
        nextLevel.push(summarizeRegion(subBrick, 0, 0, 2, cellSizeM));
      }
    }
    levels.push(nextLevel);
    currentSize = nextSize;
  }

  return { key: brick.key, revision: brick.revision, levels };
}

function extractSubBrick(brick: ChunkBrick, startX: number, startZ: number, regionSize: number): ChunkBrick {
  const heights = new Float32Array(regionSize * regionSize);
  const materials = new Uint16Array(regionSize * regionSize);
  const canopyCoverage = new Float32Array(regionSize * regionSize);
  const waterCoverage = new Float32Array(regionSize * regionSize);
  for (let z = 0; z < regionSize; z++) {
    for (let x = 0; x < regionSize; x++) {
      const idx = z * regionSize + x;
      const src = (startZ + z) * brick.sizeCells + (startX + x);
      heights[idx] = brick.heights[src]!;
      materials[idx] = brick.materials[src]!;
      canopyCoverage[idx] = brick.canopyCoverage[src]!;
      waterCoverage[idx] = brick.waterCoverage[src]!;
    }
  }
  return {
    ...brick,
    sizeCells: regionSize,
    heights,
    materials,
    canopyCoverage,
    waterCoverage,
  };
}

export function sampleMipNodeAtWorld(
  mipChain: ChunkMipChain,
  localX: number,
  localZ: number,
  level: number,
  sizeCells: number,
): MipSummaryNode | null {
  if (level < 0 || level >= mipChain.levels.length) return null;
  const levelSize = sizeCells >> level;
  if (levelSize < 1) return null;
  const nodes = mipChain.levels[level]!;
  const cx = Math.min(levelSize - 1, Math.max(0, Math.floor(localX / (1 << level))));
  const cz = Math.min(levelSize - 1, Math.max(0, Math.floor(localZ / (1 << level))));
  const idx = cz * levelSize + cx;
  return nodes[idx] ?? null;
}

export function buildMipChain(brick: ChunkBrick, cellSizeM: number): ChunkMipChain {
  return buildMipChainFromBrick(brick, cellSizeM);
}
