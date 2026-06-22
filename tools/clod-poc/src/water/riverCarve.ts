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

  if (talusConfig.enabled) relaxTalus(grid, talusConfig);
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
