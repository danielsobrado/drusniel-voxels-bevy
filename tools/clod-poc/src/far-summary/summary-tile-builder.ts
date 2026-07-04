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

export interface FarSummaryTileBuildState {
  readonly input: FarSummaryBuildInput;
  readonly originX: number;
  readonly originZ: number;
  readonly sampleCount: number;
  readonly samples: FarSummarySample[];
  cursor: number;
  globalMin: number;
  globalMax: number;
  globalSum: number;
  validSamples: number;
}

const BUILD_DEADLINE_CHECK_INTERVAL_CELLS = 8;

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

  return normalFromRangeSamples(hL, hR, hD, hU, step);
}

function normalFromRangeSamples(
  hL: number,
  hR: number,
  hD: number,
  hU: number,
  step: number,
): [number, number, number] {
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

export function createFarSummaryTileBuild(input: FarSummaryBuildInput): FarSummaryTileBuildState {
  const { key, ringConfig } = input;
  const originX = tileOrigin(key.x, ringConfig.cellM, ringConfig.tileCells);
  const originZ = tileOrigin(key.z, ringConfig.cellM, ringConfig.tileCells);
  const sampleCount = ringConfig.tileCells * ringConfig.tileCells;
  return {
    input,
    originX,
    originZ,
    sampleCount,
    samples: new Array(sampleCount),
    cursor: 0,
    globalMin: Number.POSITIVE_INFINITY,
    globalMax: Number.NEGATIVE_INFINITY,
    globalSum: 0,
    validSamples: 0,
  };
}

export function stepFarSummaryTileBuild(
  build: FarSummaryTileBuildState,
  deadlineMs: number,
): boolean {
  const { ringConfig } = build.input;
  let cellsSinceDeadlineCheck = 0;

  while (build.cursor < build.sampleCount) {
    build.samples[build.cursor] = sampleCell(build, build.cursor);
    build.cursor++;
    cellsSinceDeadlineCheck++;

    if (cellsSinceDeadlineCheck >= BUILD_DEADLINE_CHECK_INTERVAL_CELLS) {
      cellsSinceDeadlineCheck = 0;
      if (performance.now() >= deadlineMs) return false;
    }
  }

  void ringConfig;
  return true;
}

export function finishFarSummaryTileBuild(build: FarSummaryTileBuildState): FarSummaryTile {
  const { key, ringConfig, frameIndex, nowMs } = build.input;
  const avg = build.validSamples > 0 ? build.globalSum / build.validSamples : 0;

  for (let i = 0; i < build.samples.length; i++) {
    const sample = build.samples[i];
    if (!sample) {
      build.samples[i] = fallbackSample(avg);
      continue;
    }
    if (!Number.isFinite(sample.heightAvg)) sample.heightAvg = avg;
    if (!Number.isFinite(sample.heightMin)) sample.heightMin = avg;
    if (!Number.isFinite(sample.heightMax)) sample.heightMax = avg;
  }

  return {
    key,
    state: "ready",
    revision: 0,
    lastTouchedFrame: frameIndex,
    lastTouchedTimeMs: nowMs,
    cellSizeM: ringConfig.cellM,
    tileCells: ringConfig.tileCells,
    originX: build.originX,
    originZ: build.originZ,
    samples: build.samples,
  };
}

export function buildFarSummaryTile(input: FarSummaryBuildInput): FarSummaryTile {
  const build = createFarSummaryTileBuild(input);
  stepFarSummaryTileBuild(build, Number.POSITIVE_INFINITY);
  return finishFarSummaryTileBuild(build);
}

function sampleCell(build: FarSummaryTileBuildState, idx: number): FarSummarySample {
  const { ringConfig, terrainSampler } = build.input;
  const { cellM, tileCells } = ringConfig;
  const sx = idx % tileCells;
  const sz = Math.floor(idx / tileCells);
  const wx = build.originX + (sx + 0.5) * cellM;
  const wz = build.originZ + (sz + 0.5) * cellM;

  const height = terrainSampler.sampleHeight(wx, wz);
  if (Number.isNaN(height)) {
    console.warn(`[far-summary] NaN height at (${wx}, ${wz})`);
  }

  const heightValid = Number.isFinite(height);
  const sampleH = heightValid ? height : 0;
  const sampleForMin = heightValid ? height : Number.POSITIVE_INFINITY;
  const sampleForMax = heightValid ? height : Number.NEGATIVE_INFINITY;
  const rangeStep = cellM * 0.4;

  const hRangeL = terrainSampler.sampleHeight(wx - rangeStep, wz);
  const hRangeR = terrainSampler.sampleHeight(wx + rangeStep, wz);
  const hRangeD = terrainSampler.sampleHeight(wx, wz - rangeStep);
  const hRangeU = terrainSampler.sampleHeight(wx, wz + rangeStep);
  const hMin = Math.min(sampleForMin, hRangeL, hRangeR, hRangeD, hRangeU);
  const hMax = Math.max(sampleForMax, hRangeL, hRangeR, hRangeD, hRangeU);
  const [nx, ny, nz] = normalFromRangeSamples(hRangeL, hRangeR, hRangeD, hRangeU, rangeStep);
  const slope = Math.acos(clamp01(ny));

  const material = terrainSampler.sampleMaterial?.(wx, wz) ?? 0;
  const canopy = terrainSampler.sampleCanopyCoverage?.(wx, wz) ?? 0;
  const water = terrainSampler.sampleWaterCoverage?.(wx, wz) ?? 0;
  const roughness = computeRoughnessFromSamples(sampleH, hRangeL, hRangeR, hRangeD, hRangeU);

  if (heightValid) {
    build.globalMin = Math.min(build.globalMin, height);
    build.globalMax = Math.max(build.globalMax, height);
    build.globalSum += height;
    build.validSamples++;
  }

  return {
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

function computeRoughnessFromSamples(center: number, ...neighbors: number[]): number {
  if (!Number.isFinite(center)) return 0;
  let sumSq = 0;
  let count = 0;
  for (const value of neighbors) {
    if (!Number.isFinite(value)) continue;
    const diff = value - center;
    sumSq += diff * diff;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

function fallbackSample(height: number): FarSummarySample {
  return {
    heightMin: height,
    heightMax: height,
    heightAvg: height,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    dominantMaterial: 0,
    materialVariance: 0,
    canopyCoverage: 0,
    waterCoverage: 0,
    slope: 0,
    roughness: 0,
  };
}
