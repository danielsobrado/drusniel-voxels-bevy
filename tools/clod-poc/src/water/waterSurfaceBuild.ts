import type { HydrologyWaterSurfaceConfig } from "./hydrologyConfig.js";
import { HYDROLOGY_BODY_DRY, clampGridCoord, gridIndex, type HydrologyGrid } from "./hydrologyGrid.js";

export function buildWaterSurface(grid: HydrologyGrid, config: HydrologyWaterSurfaceConfig, drySentinelDepth: number): void {
  const { res, carvedBed, waterYRaw, waterY, wetMask } = grid;
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      const wet = waterYRaw[i] > -1000;
      wetMask[i] = wet ? 1 : 0;
      if (wet) {
        waterY[i] = waterYRaw[i];
      } else {
        let minBed = Number.POSITIVE_INFINITY;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            minBed = Math.min(
              minBed,
              carvedBed[gridIndex(res, clampGridCoord(res, x + ox), clampGridCoord(res, z + oz))],
            );
          }
        }
        waterY[i] = minBed - drySentinelDepth;
      }
    }
  }

  const tmp = new Float32Array(waterY.length);
  for (let iter = 0; iter < config.wetSmoothIterations; iter++) {
    tmp.set(waterY);
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const i = gridIndex(res, x, z);
        if (wetMask[i] <= 0.5) continue;
        let sum = waterY[i];
        let count = 1;
        for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const ni = gridIndex(res, clampGridCoord(res, x + ox), clampGridCoord(res, z + oz));
          if (wetMask[ni] > 0.5) {
            sum += waterY[ni];
            count++;
          }
        }
        tmp[i] = sum / count;
      }
    }
    waterY.set(tmp);
  }

  tmp.set(waterY);
  const maxJump = config.wetToWetCliffSlopeMax * grid.texel;
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      if (wetMask[i] <= 0.5) continue;
      let cliff = false;
      for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const ni = gridIndex(res, clampGridCoord(res, x + ox), clampGridCoord(res, z + oz));
        if (wetMask[ni] > 0.5 && Math.abs(waterY[i] - waterY[ni]) > maxJump) {
          cliff = true;
          break;
        }
      }
      if (cliff) {
        tmp[i] = carvedBed[i] - drySentinelDepth;
        wetMask[i] = 0;
        grid.lakeMask[i] = 0;
        grid.riverMask[i] = 0;
        grid.bodyKind[i] = HYDROLOGY_BODY_DRY;
      }
    }
  }
  waterY.set(tmp);
}
