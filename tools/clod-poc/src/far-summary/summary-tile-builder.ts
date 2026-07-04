import type { FarSummarySample, FarSummaryTile, FarSummaryTileKey } from "./types.js";
import type { FarSummaryRingConfig } from "./config.js";
import { tileOrigin } from "./tile-key.js";

export interface FarTerrainSampler {
  sampleHeight(x: number, z: number): number;
  sampleMaterial?(x: number, z: number): number;
  sampleCanopyCoverage?(x: number, z: number): number;
  sampleWaterCoverage?(x: number, z: number): number;
  sampleWaterCoverageForHeight?(x: number, z: number, height: number): number;
}

export interface FarSummaryBuildInput {
  key: FarSummaryTileKey;
  ringConfig: FarSummaryRingConfig;
  terrainSampler: FarTerrainSampler;
  frameIndex: number;
  nowMs: number;
}

interface HeightGrid {
  values: Float64Array;
  stride: number;
  tileCells: number;
}

const GRID_BORDER_CELLS = 1;

export function computeNormalFiniteDifference(
  h: (x: number, z: number) => number,
  x: number,
  z: number,
  step: number,
): [number, number, number] {
  const hL = h(x - step, z);
  const hR = h(x + step, z);
  const hD = h(x, z - step);
  const hU = h(x, z + step);

  if (!Number.isFinite(hL) || !Number.isFinite(hR) || !Number.isFinite(hD) || !Number.isFinite(hU)) {
    return [0, 1, 0];
  }

  return normalFromHeights(hL, hR, hD, hU, step);
}

function normalFromHeights(
  hL: number,
  hR: number,
  hD: number,
  hU: number,
  step: number,
): [number, number, number] {
  if (!Number.isFinite(hL) || !Number.isFinite(hR) || !Number.isFinite(hD) || !Number.isFinite(hU)) return [0, 1, 0];
  const nx = hL - hR;
  const ny = 2 * step;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-10) return [0, 1, 0];
  return [nx / len, ny / len, nz / len];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function finiteMin(values: readonly number[], fallback: number): number {
  let out = Number.POSITIVE_INFINITY;
  for (const value of values) if (Number.isFinite(value) && value < out) out = value;
  return Number.isFinite(out) ? out : fallback;
}

function finiteMax(values: readonly number[], fallback: number): number {
  let out = Number.NEGATIVE_INFINITY;
  for (const value of values) if (Number.isFinite(value) && value > out) out = value;
  return Number.isFinite(out) ? out : fallback;
}

function buildHeightGrid(
  originX: number,
  originZ: number,
  cellM: number,
  tileCells: number,
  sampleHeight: (x: number, z: number) => number,
): HeightGrid {
  const stride = tileCells + GRID_BORDER_CELLS * 2;
  const values = new Float64Array(stride * stride);

  for (let gz = -GRID_BORDER_CELLS; gz < tileCells + GRID_BORDER_CELLS; gz++) {
    for (let gx = -GRID_BORDER_CELLS; gx < tileCells + GRID_BORDER_CELLS; gx++) {
      const wx = originX + (gx + 0.5) * cellM;
      const wz = originZ + (gz + 0.5) * cellM;
      values[(gz + GRID_BORDER_CELLS) * stride + gx + GRID_BORDER_CELLS] = sampleHeight(wx, wz);
    }
  }

  return { values, stride, tileCells };
}

function heightAt(grid: HeightGrid, sx: number, sz: number): number {
  const gx = Math.max(-GRID_BORDER_CELLS, Math.min(grid.tileCells, sx));
  const gz = Math.max(-GRID_BORDER_CELLS, Math.min(grid.tileCells, sz));
  return grid.values[(gz + GRID_BORDER_CELLS) * grid.stride + gx + GRID_BORDER_CELLS];
}

export function buildFarSummaryTile(input: FarSummaryBuildInput): FarSummaryTile {
  const { key, ringConfig, terrainSampler, frameIndex, nowMs } = input;
  const { cellM, tileCells } = ringConfig;
  const originX = tileOrigin(key.x, cellM, tileCells);
  const originZ = tileOrigin(key.z, cellM, tileCells);
  const sampleCount = tileCells * tileCells;
  const samples: FarSummarySample[] = new Array(sampleCount);
  let globalSum = 0;
  let validSamples = 0;

  const heightGrid = buildHeightGrid(originX, originZ, cellM, tileCells, terrainSampler.sampleHeight);

  for (let sz = 0; sz < tileCells; sz++) {
    for (let sx = 0; sx < tileCells; sx++) {
      const wx = originX + (sx + 0.5) * cellM;
      const wz = originZ + (sz + 0.5) * cellM;

      const height = heightAt(heightGrid, sx, sz);
      if (Number.isNaN(height)) {
        console.warn(`[far-summary] NaN height at (${wx}, ${wz})`);
      }

      const heightValid = Number.isFinite(height);
      const sampleH = heightValid ? height : 0;
      const hLeft = heightAt(heightGrid, sx - 1, sz);
      const hRight = heightAt(heightGrid, sx + 1, sz);
      const hDown = heightAt(heightGrid, sx, sz - 1);
      const hUp = heightAt(heightGrid, sx, sz + 1);
      const hMin = finiteMin([height, hLeft, hRight, hDown, hUp], sampleH);
      const hMax = finiteMax([height, hLeft, hRight, hDown, hUp], sampleH);

      const [nx, ny, nz] = normalFromHeights(hLeft, hRight, hDown, hUp, cellM);
      const slope = Math.acos(clamp01(ny));
      const material = terrainSampler.sampleMaterial?.(wx, wz) ?? 0;
      const canopy = terrainSampler.sampleCanopyCoverage?.(wx, wz) ?? 0;
      const water = heightValid
        ? terrainSampler.sampleWaterCoverageForHeight?.(wx, wz, sampleH) ?? terrainSampler.sampleWaterCoverage?.(wx, wz) ?? 0
        : 0;
      const roughness = computeRoughnessFromGrid(heightGrid, sx, sz);

      if (heightValid) {
        globalSum += height;
        validSamples++;
      }

      const idx = sz * tileCells + sx;
      samples[idx] = {
        heightMin: hMin,
        heightMax: hMax,
        heightAvg: heightValid ? sampleH : Number.POSITIVE_INFINITY,
        normalX: nx,
        normalY: ny,
        normalZ: nz,
        dominantMaterial: Math.max(0, Math.round(material)),
        materialVariance: 0,
        canopyCoverage: clamp01(canopy),
        waterCoverage: clamp01(water),
        slope: Number.isFinite(slope) ? slope : 0,
        roughness,
      };
    }
  }

  const avg = validSamples > 0 ? globalSum / validSamples : 0;

  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i].heightAvg)) {
      samples[i].heightAvg = avg;
    }
    if (!Number.isFinite(samples[i].heightMin)) {
      samples[i].heightMin = avg;
    }
    if (!Number.isFinite(samples[i].heightMax)) {
      samples[i].heightMax = avg;
    }
  }

  return {
    key,
    state: 'ready',
    revision: 0,
    lastTouchedFrame: frameIndex,
    lastTouchedTimeMs: nowMs,
    cellSizeM: cellM,
    tileCells,
    originX,
    originZ,
    samples,
  };
}

function computeRoughnessFromGrid(grid: HeightGrid, cx: number, cz: number): number {
  const center = heightAt(grid, cx, cz);
  if (!Number.isFinite(center)) return 0;

  let sumSq = 0;
  let count = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const value = heightAt(grid, cx + dx, cz + dz);
      if (Number.isFinite(value)) {
        const diff = value - center;
        sumSq += diff * diff;
        count++;
      }
    }
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}
