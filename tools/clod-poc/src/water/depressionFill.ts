import { gridIndex, type HydrologyGrid } from "./hydrologyGrid.js";
import type { HydrologyFillConfig } from "./hydrologyConfig.js";

const OFFSETS_8: Array<[number, number, number]> = [
  [-1, 0, 1],
  [1, 0, 1],
  [0, -1, 1],
  [0, 1, 1],
  [-1, -1, Math.SQRT2],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
];

export function fillDepressions(grid: HydrologyGrid, config: HydrologyFillConfig): void {
  const { res, originalBed, filledSurface } = grid;
  if (!config.enabled) {
    filledSurface.set(originalBed);
    return;
  }

  const count = res * res;
  let src = new Float32Array(count);
  let dst = new Float32Array(count);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      const border = x === 0 || z === 0 || x === res - 1 || z === res - 1;
      src[i] = border ? originalBed[i] : originalBed[i] + 4000;
      dst[i] = src[i];
    }
  }

  for (let iter = 0; iter < config.iterations; iter++) {
    let maxChange = 0;
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const i = gridIndex(res, x, z);
        if (x === 0 || z === 0 || x === res - 1 || z === res - 1) {
          dst[i] = originalBed[i];
          continue;
        }
        let lowest = Number.POSITIVE_INFINITY;
        for (const [ox, oz, dist] of OFFSETS_8) {
          const n = gridIndex(res, x + ox, z + oz);
          lowest = Math.min(lowest, src[n] + config.epsilonPerCell * dist);
        }
        const next = Math.max(originalBed[i], Math.min(src[i], lowest));
        dst[i] = next;
        maxChange = Math.max(maxChange, Math.abs(next - src[i]));
      }
    }
    const tmp = src;
    src = dst;
    dst = tmp;
    if (maxChange < 1e-4) break;
  }

  filledSurface.set(src);
}
