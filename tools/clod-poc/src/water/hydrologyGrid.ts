import type { TerrainHeightSampler } from "./waterField.js";

export const HYDROLOGY_BODY_DRY = 0;
export const HYDROLOGY_BODY_OCEAN = 1;
export const HYDROLOGY_BODY_LAKE = 2;
export const HYDROLOGY_BODY_RIVER = 3;
export const HYDROLOGY_BODY_POND = 4;
export const HYDROLOGY_BODY_MARSH = 5;

export interface HydrologyGrid {
  res: number;
  worldCells: number;
  texel: number;
  originalBed: Float32Array;
  carvedBed: Float32Array;
  filledSurface: Float32Array;
  accumulation: Float32Array;
  flowStrength: Float32Array;
  waterStrength: Float32Array;
  riverDepth: Float32Array;
  waterYRaw: Float32Array;
  waterY: Float32Array;
  waterYFar: Float32Array;
  farRes: number;
  farReduceFactor: number;
  wetMask: Float32Array;
  lakeMask: Float32Array;
  riverMask: Float32Array;
  moisture: Float32Array;
  bodyKind: Uint8Array;
  flowDirX: Float32Array;
  flowDirZ: Float32Array;
}

export interface HydrologySample {
  terrainY: number;
  waterY: number;
  bodyMask: number;
  lakeMask: number;
  riverMask: number;
  flowX: number;
  flowZ: number;
  flowStrength: number;
  riverDepth: number;
  waterYFar: number;
  moisture: number;
  bodyKind: number;
}

export function createHydrologyGrid(
  res: number,
  worldCells: number,
  sampler: TerrainHeightSampler,
  farReduceFactor = 1,
): HydrologyGrid {
  const count = res * res;
  const reduce = Math.max(1, Math.floor(farReduceFactor));
  const farRes = Math.max(1, Math.floor(res / reduce));
  const originalBed = new Float32Array(count);
  const texel = worldCells / Math.max(1, res - 1);
  for (let z = 0; z < res; z++) {
    const wz = (z / Math.max(1, res - 1)) * worldCells;
    for (let x = 0; x < res; x++) {
      const wx = (x / Math.max(1, res - 1)) * worldCells;
      originalBed[z * res + x] = sampler.surfaceHeight(wx, wz);
    }
  }
  return {
    res,
    worldCells,
    texel,
    originalBed,
    carvedBed: new Float32Array(originalBed),
    filledSurface: new Float32Array(originalBed),
    accumulation: new Float32Array(count),
    flowStrength: new Float32Array(count),
    waterStrength: new Float32Array(count),
    riverDepth: new Float32Array(count),
    waterYRaw: new Float32Array(count),
    waterY: new Float32Array(count),
    waterYFar: new Float32Array(farRes * farRes),
    farRes,
    farReduceFactor: reduce,
    wetMask: new Float32Array(count),
    lakeMask: new Float32Array(count),
    riverMask: new Float32Array(count),
    moisture: new Float32Array(count),
    bodyKind: new Uint8Array(count),
    flowDirX: new Float32Array(count),
    flowDirZ: new Float32Array(count),
  };
}

export function gridIndex(res: number, x: number, z: number): number {
  return z * res + x;
}

export function clampGridCoord(res: number, v: number): number {
  return Math.max(0, Math.min(res - 1, v));
}

export function worldToGrid(grid: HydrologyGrid, x: number, z: number): { gx: number; gz: number } {
  const scale = (grid.res - 1) / Math.max(1e-6, grid.worldCells);
  return {
    gx: clampGridCoord(grid.res, x * scale),
    gz: clampGridCoord(grid.res, z * scale),
  };
}

export function sampleGridBilinear(grid: HydrologyGrid, field: Float32Array, x: number, z: number): number {
  const { gx, gz } = worldToGrid(grid, x, z);
  return sampleArrayAtGrid(field, grid.res, gx, gz);
}

export function sampleGridBilinearByRes(
  field: Float32Array,
  res: number,
  worldCells: number,
  x: number,
  z: number,
): number {
  const scale = (res - 1) / Math.max(1e-6, worldCells);
  return sampleArrayAtGrid(field, res, x * scale, z * scale);
}

export function sampleWaterYFar(grid: HydrologyGrid, x: number, z: number): number {
  return sampleGridBilinearByRes(grid.waterYFar, grid.farRes, grid.worldCells, x, z);
}

export function sampleBodyKindNearest(grid: HydrologyGrid, x: number, z: number): number {
  const { gx, gz } = worldToGrid(grid, x, z);
  const ix = Math.round(clampGridCoord(grid.res, gx));
  const iz = Math.round(clampGridCoord(grid.res, gz));
  return grid.bodyKind[gridIndex(grid.res, ix, iz)];
}

export function sampleArrayAtGrid(field: Float32Array, res: number, gx: number, gz: number): number {
  const x0 = Math.floor(clampGridCoord(res, gx));
  const z0 = Math.floor(clampGridCoord(res, gz));
  const x1 = Math.min(res - 1, x0 + 1);
  const z1 = Math.min(res - 1, z0 + 1);
  const fx = Math.max(0, Math.min(1, gx - x0));
  const fz = Math.max(0, Math.min(1, gz - z0));
  const a = field[gridIndex(res, x0, z0)] * (1 - fx) + field[gridIndex(res, x1, z0)] * fx;
  const b = field[gridIndex(res, x0, z1)] * (1 - fx) + field[gridIndex(res, x1, z1)] * fx;
  return a * (1 - fz) + b * fz;
}

export function sampleHydrologyGrid(grid: HydrologyGrid, x: number, z: number): HydrologySample {
  const terrainY = sampleGridBilinear(grid, grid.carvedBed, x, z);
  const waterY = sampleGridBilinear(grid, grid.waterY, x, z);
  const wet = sampleGridBilinear(grid, grid.wetMask, x, z);
  const depth = waterY - terrainY;
  const bodyMask = depth > 0 ? Math.max(0, Math.min(1, wet)) : 0;
  return {
    terrainY,
    waterY,
    bodyMask,
    lakeMask: sampleGridBilinear(grid, grid.lakeMask, x, z),
    riverMask: sampleGridBilinear(grid, grid.riverMask, x, z),
    flowX: sampleGridBilinear(grid, grid.flowDirX, x, z),
    flowZ: sampleGridBilinear(grid, grid.flowDirZ, x, z),
    flowStrength: sampleGridBilinear(grid, grid.flowStrength, x, z),
    riverDepth: sampleGridBilinear(grid, grid.riverDepth, x, z),
    waterYFar: sampleWaterYFar(grid, x, z),
    moisture: sampleGridBilinear(grid, grid.moisture, x, z),
    bodyKind: sampleBodyKindNearest(grid, x, z),
  };
}

export function triangleBlur(field: Float32Array, res: number, radius: number, scratch = new Float32Array(field.length)): void {
  if (radius <= 0) return;
  const denom = (radius + 1) * (radius + 1);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      let sum = 0;
      for (let o = -radius; o <= radius; o++) {
        const w = radius + 1 - Math.abs(o);
        sum += field[gridIndex(res, clampGridCoord(res, x + o), z)] * w;
      }
      scratch[gridIndex(res, x, z)] = sum / denom;
    }
  }
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      let sum = 0;
      for (let o = -radius; o <= radius; o++) {
        const w = radius + 1 - Math.abs(o);
        sum += scratch[gridIndex(res, x, clampGridCoord(res, z + o))] * w;
      }
      field[gridIndex(res, x, z)] = sum / denom;
    }
  }
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= Number.EPSILON) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
