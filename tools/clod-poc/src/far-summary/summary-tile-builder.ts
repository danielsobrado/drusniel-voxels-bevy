import type { FarSummarySample, FarSummaryTile, FarSummaryTileKey } from "./types.js";
import type { FarSummaryRingConfig } from "./config.js";
import { tileOrigin } from "./tile-key.js";

export interface FarTerrainSampler {
  sampleHeight(x: number, z: number): number;
  sampleMaterial?(x: number, z: number): number;
  sampleCanopyCoverage?(x: number, z: number): number;
  sampleWaterCoverage?(x: number, z: number): number;
}

export interface FarSummaryBuildInput {
  key: FarSummaryTileKey;
  ringConfig: FarSummaryRingConfig;
  terrainSampler: FarTerrainSampler;
  frameIndex: number;
  nowMs: number;
}

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

export function buildFarSummaryTile(input: FarSummaryBuildInput): FarSummaryTile {
  const { key, ringConfig, terrainSampler, frameIndex, nowMs } = input;
  const { cellM, tileCells } = ringConfig;
  const originX = tileOrigin(key.x, cellM, tileCells);
  const originZ = tileOrigin(key.z, cellM, tileCells);
  const sampleCount = tileCells * tileCells;
  const samples: FarSummarySample[] = new Array(sampleCount);
  let globalMin = Number.POSITIVE_INFINITY;
  let globalMax = Number.NEGATIVE_INFINITY;
  let globalSum = 0;
  let validSamples = 0;

  const hFn = (x: number, z: number): number => terrainSampler.sampleHeight(x, z);

  for (let sz = 0; sz < tileCells; sz++) {
    for (let sx = 0; sx < tileCells; sx++) {
      const wx = originX + (sx + 0.5) * cellM;
      const wz = originZ + (sz + 0.5) * cellM;

      const height = terrainSampler.sampleHeight(wx, wz);
      if (Number.isNaN(height)) {
        console.warn(`[far-summary] NaN height at (${wx}, ${wz})`);
      }

      const heightValid = Number.isFinite(height);
      const sampleH = heightValid ? height : 0;
      const sampleForMin = heightValid ? height : Number.POSITIVE_INFINITY;
      const sampleForMax = heightValid ? height : Number.NEGATIVE_INFINITY;

      const hRangeL = terrainSampler.sampleHeight(wx - cellM * 0.4, wz);
      const hRangeR = terrainSampler.sampleHeight(wx + cellM * 0.4, wz);
      const hRangeD = terrainSampler.sampleHeight(wx, wz - cellM * 0.4);
      const hRangeU = terrainSampler.sampleHeight(wx, wz + cellM * 0.4);
      const hMin = Math.min(sampleForMin, hRangeL, hRangeR, hRangeD, hRangeU);
      const hMax = Math.max(sampleForMax, hRangeL, hRangeR, hRangeD, hRangeU);

      const [nx, ny, nz] = computeNormalFiniteDifference(hFn, wx, wz, cellM);

      const slope = Math.acos(clamp01(ny));

      const material = terrainSampler.sampleMaterial?.(wx, wz) ?? 0;
      const canopy = terrainSampler.sampleCanopyCoverage?.(wx, wz) ?? 0;
      const water = terrainSampler.sampleWaterCoverage?.(wx, wz) ?? 0;

      const roughness = computeRoughness(hFn, wx, wz, cellM);

      if (heightValid) {
        globalMin = Math.min(globalMin, height);
        globalMax = Math.max(globalMax, height);
        globalSum += height;
        validSamples++;
      }

      const idx = sz * tileCells + sx;
      samples[idx] = {
        heightMin: Number.isFinite(hMin) ? hMin : Number.POSITIVE_INFINITY,
        heightMax: Number.isFinite(hMax) ? hMax : Number.NEGATIVE_INFINITY,
        heightAvg: heightValid ? sampleH : Number.POSITIVE_INFINITY,
        normalX: nx,
        normalY: ny,
        normalZ: nz,
        dominantMaterial: Math.max(0, Math.round(material)),
        materialVariance: 0,
        canopyCoverage: clamp01(canopy),
        waterCoverage: clamp01(water),
        slope: Number.isFinite(slope) ? slope : 0,
        roughness: Number.isFinite(roughness) ? roughness : 0,
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

function computeRoughness(
  h: (x: number, z: number) => number,
  cx: number,
  cz: number,
  radius: number,
): number {
  const offsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  const center = h(cx, cz);
  if (!Number.isFinite(center)) return 0;

  let sumSq = 0;
  let count = 0;
  for (const [dx, dz] of offsets) {
    const v = h(cx + dx * radius * 0.5, cz + dz * radius * 0.5);
    if (Number.isFinite(v)) {
      const diff = v - center;
      sumSq += diff * diff;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}
