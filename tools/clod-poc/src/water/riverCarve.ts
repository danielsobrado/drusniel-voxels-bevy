import type { HydrologyFillConfig, HydrologyRiversConfig, HydrologyTalusConfig } from "./hydrologyConfig.js";
import {
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_RIVER,
  clampGridCoord,
  gridIndex,
  smoothstep,
  triangleBlur,
  type HydrologyGrid,
} from "./hydrologyGrid.js";

const FALLBACK_RIVER_PATHS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0.08, 0.32], [0.24, 0.39], [0.42, 0.47], [0.61, 0.56], [0.86, 0.68]],
  [[0.72, 0.12], [0.66, 0.27], [0.58, 0.42], [0.48, 0.51]],
];

export function carveRiversAndClassifyWater(
  grid: HydrologyGrid,
  fillConfig: HydrologyFillConfig,
  riversConfig: HydrologyRiversConfig,
  talusConfig: HydrologyTalusConfig,
): void {
  const { res, texel, originalBed, carvedBed, filledSurface } = grid;
  carvedBed.set(originalBed);

  // Lower lake surfaces below the fill spill level; the shoreline recedes to the
  // new (lower) water contour, so lakes read lower and smaller instead of brimming.
  const lakeDrop = Math.max(0, riversConfig.lakeSurfaceDropM ?? 0);
  const lakeSurface = (i: number): number => filledSurface[i] - lakeDrop;
  const lakeDepth = new Float32Array(res * res);
  for (let i = 0; i < lakeDepth.length; i++) lakeDepth[i] = Math.max(0, lakeSurface(i) - originalBed[i]);
  triangleBlur(lakeDepth, res, 3);

  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      const lakeD = lakeDepth[i];
      const isLake = lakeD > fillConfig.lakeDelta;
      grid.lakeMask[i] = isLake ? 1 : 0;

      const lakeFade = smoothstep(fillConfig.lakeDelta * 0.7, 0.12, lakeD);
      const strength = isLake ? 1 : Math.max(0, Math.min(1, grid.flowStrength[i] * 2.1));
      grid.flowStrength[i] = strength;
      const carveDepth = Math.pow(strength, riversConfig.carvePower) * riversConfig.carveDepthM * lakeFade;
      if (!isLake) carvedBed[i] = originalBed[i] - carveDepth;

      const wl = filledSurface[gridIndex(res, clampGridCoord(res, x - 1), z)];
      const wr = filledSurface[gridIndex(res, clampGridCoord(res, x + 1), z)];
      const wd = filledSurface[gridIndex(res, x, clampGridCoord(res, z - 1))];
      const wu = filledSurface[gridIndex(res, x, clampGridCoord(res, z + 1))];
      const slope = Math.hypot(wl - wr, wd - wu) / Math.max(1e-6, texel * 2);
      const slopeGate = smoothstep(riversConfig.slopeGateStart, riversConfig.slopeGateEnd, slope);

      if (isLake) {
        grid.riverDepth[i] = lakeD;
        grid.waterYRaw[i] = lakeSurface(i);
        grid.wetMask[i] = 1;
        grid.riverMask[i] = 0;
        grid.bodyKind[i] = HYDROLOGY_BODY_LAKE;
        grid.flowDirX[i] = 0;
        grid.flowDirZ[i] = 0;
        continue;
      }

      const visibleStrength = Math.max(0, Math.min(1, grid.waterStrength[i] * 1.5));
      const riverSurfaceDepth = Math.max(
        0,
        Math.pow(visibleStrength, riversConfig.visibleDepthPower) *
          riversConfig.visibleDepthM *
          lakeFade *
          0.45 *
          slopeGate,
      );
      const riverWet = visibleStrength > riversConfig.minVisibleDepth && riverSurfaceDepth > riversConfig.minVisibleDepth;
      grid.riverDepth[i] = riverWet ? riverSurfaceDepth : 0;
      grid.riverMask[i] = riverWet ? 1 : 0;
      grid.wetMask[i] = riverWet ? 1 : 0;
      grid.bodyKind[i] = riverWet ? HYDROLOGY_BODY_RIVER : HYDROLOGY_BODY_DRY;
      grid.waterYRaw[i] = riverWet ? carvedBed[i] + riverSurfaceDepth : -1e4;
    }
  }

  ensureVisibleFallbackRivers(grid, riversConfig);

  if (talusConfig.enabled) relaxTalus(grid, talusConfig);
}

function ensureVisibleFallbackRivers(grid: HydrologyGrid, config: HydrologyRiversConfig): void {
  if (!config.guaranteeFallbackRivers) return;
  if (grid.res < 16) return;
  const minimumRiverCells = Math.max(grid.res * 2.25, grid.res * grid.res * 0.006);
  if (countRiverCells(grid) >= minimumRiverCells) return;

  for (let index = 0; index < FALLBACK_RIVER_PATHS.length; index++) {
    if (index === 0 && !config.fallbackMainRiver) continue;
    if (index > 0 && !config.fallbackTributaries) continue;
    carveFallbackRiverPath(grid, config, FALLBACK_RIVER_PATHS[index]);
  }
}

function countRiverCells(grid: HydrologyGrid): number {
  let count = 0;
  for (const value of grid.riverMask) {
    if (value > 0.5) count++;
  }
  return count;
}

function carveFallbackRiverPath(
  grid: HydrologyGrid,
  config: HydrologyRiversConfig,
  pathNorm: ReadonlyArray<readonly [number, number]>,
): void {
  if (pathNorm.length < 2) return;

  const points = pathNorm.map(([nx, nz]) => [
    clampGridCoord(grid.res, nx * (grid.res - 1)),
    clampGridCoord(grid.res, nz * (grid.res - 1)),
  ] as const);
  const levels = monotonicRiverLevels(grid, points);
  const halfWidthCells = Math.max(2.4, Math.min(6.5, grid.res * 0.013 + config.widenRadius * 0.9));

  for (let z = 1; z < grid.res - 1; z++) {
    for (let x = 1; x < grid.res - 1; x++) {
      let best: SegmentProjection | null = null;
      for (let i = 0; i < points.length - 1; i++) {
        const projection = projectGridPointToSegment(x, z, points[i], points[i + 1], i);
        if (!best || projection.distance < best.distance) best = projection;
      }
      if (!best || best.distance > halfWidthCells) continue;

      const cell = gridIndex(grid.res, x, z);
      if (grid.lakeMask[cell] > 0.5) continue;

      const bank = 1 - smoothstep(halfWidthCells * 0.35, halfWidthCells, best.distance);
      if (bank <= 0.01) continue;

      const level = lerp(levels[best.segmentIndex], levels[best.segmentIndex + 1], best.t);
      const channelDepth = Math.max(config.minVisibleDepth, config.visibleDepthM * (0.28 + bank * 0.72));
      const targetBed = level - channelDepth;
      grid.carvedBed[cell] = Math.min(grid.carvedBed[cell], targetBed);
      grid.riverDepth[cell] = Math.max(grid.riverDepth[cell], level - grid.carvedBed[cell]);
      grid.waterYRaw[cell] = Math.max(grid.waterYRaw[cell], level);
      grid.riverMask[cell] = Math.max(grid.riverMask[cell], bank);
      grid.wetMask[cell] = 1;
      grid.lakeMask[cell] = 0;
      grid.bodyKind[cell] = HYDROLOGY_BODY_RIVER;

      const flow = Math.max(grid.flowStrength[cell], 0.32 + bank * 0.68);
      grid.flowStrength[cell] = flow;
      grid.waterStrength[cell] = Math.max(grid.waterStrength[cell], bank);
      grid.flowDirX[cell] = best.dirX * flow;
      grid.flowDirZ[cell] = best.dirZ * flow;
    }
  }
}

function monotonicRiverLevels(grid: HydrologyGrid, points: ReadonlyArray<readonly [number, number]>): number[] {
  const levels = points.map(([x, z]) => {
    const ix = Math.round(clampGridCoord(grid.res, x));
    const iz = Math.round(clampGridCoord(grid.res, z));
    return grid.filledSurface[gridIndex(grid.res, ix, iz)] + 0.35;
  });

  for (let i = 1; i < levels.length; i++) levels[i] = Math.min(levels[i], levels[i - 1] - 0.08);
  const minimumDrop = Math.max(2.6, levels.length * 0.35);
  levels[levels.length - 1] = Math.min(levels[levels.length - 1], levels[0] - minimumDrop);
  for (let i = levels.length - 2; i >= 0; i--) levels[i] = Math.max(levels[i], levels[i + 1] + 0.08);

  return levels;
}

interface SegmentProjection {
  segmentIndex: number;
  distance: number;
  t: number;
  dirX: number;
  dirZ: number;
}

function projectGridPointToSegment(
  x: number,
  z: number,
  a: readonly [number, number],
  b: readonly [number, number],
  segmentIndex: number,
): SegmentProjection {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 1e-8 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lenSq)) : 0;
  const closestX = a[0] + dx * t;
  const closestZ = a[1] + dz * t;
  const len = Math.max(1e-8, Math.sqrt(lenSq));
  return {
    segmentIndex,
    distance: Math.hypot(x - closestX, z - closestZ),
    t,
    dirX: dx / len,
    dirZ: dz / len,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

function relaxTalus(grid: HydrologyGrid, config: HydrologyTalusConfig): void {
  const { res, texel, carvedBed } = grid;
  const tmp = new Float32Array(carvedBed.length);
  const talus = texel * 0.7;
  for (let iter = 0; iter < config.iterations; iter++) {
    tmp.set(carvedBed);
    for (let z = 1; z < res - 1; z++) {
      for (let x = 1; x < res - 1; x++) {
        const i = gridIndex(res, x, z);
        let delta = 0;
        for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const ni = gridIndex(res, x + ox, z + oz);
          const dOut = Math.max(0, carvedBed[i] - carvedBed[ni] - talus);
          const dIn = Math.max(0, carvedBed[ni] - carvedBed[i] - talus);
          delta += dIn - dOut;
        }
        tmp[i] = carvedBed[i] + delta * config.strength;
      }
    }
    carvedBed.set(tmp);
  }
}
