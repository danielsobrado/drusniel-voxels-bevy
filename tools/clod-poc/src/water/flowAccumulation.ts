import type { HydrologyAccumulationConfig, HydrologyFillConfig, HydrologyRiversConfig } from "./hydrologyConfig.js";
import {
  clampGridCoord,
  gridIndex,
  sampleArrayAtGrid,
  triangleBlur,
  type HydrologyGrid,
} from "./hydrologyGrid.js";

function hash01(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

export function computeFlowAccumulation(
  grid: HydrologyGrid,
  accumulationConfig: HydrologyAccumulationConfig,
  fillConfig: HydrologyFillConfig,
  riversConfig: HydrologyRiversConfig,
): void {
  const { res, filledSurface, originalBed, accumulation } = grid;
  accumulation.fill(0);
  const count = res * res;
  const particles = Math.max(0, Math.floor(accumulationConfig.particles));

  for (let p = 0; p < particles; p++) {
    const spawn = Math.floor((p * count) / Math.max(1, particles));
    let x = (spawn % res) + hash01(p + accumulationConfig.jitterSeed * 17);
    let z = Math.floor(spawn / res) + hash01(p + accumulationConfig.jitterSeed * 31);
    let dirX = 0;
    let dirZ = 0;

    for (let step = 0; step < accumulationConfig.maxSteps; step++) {
      const xi = Math.max(1, Math.min(res - 2, Math.floor(x)));
      const zi = Math.max(1, Math.min(res - 2, Math.floor(z)));
      const i = gridIndex(res, xi, zi);
      accumulation[i] += 1;
      if (filledSurface[i] - originalBed[i] > fillConfig.lakeDelta) break;

      const gx = sampleArrayAtGrid(filledSurface, res, x + 0.65, z) - sampleArrayAtGrid(filledSurface, res, x - 0.65, z);
      const gz = sampleArrayAtGrid(filledSurface, res, x, z + 0.65) - sampleArrayAtGrid(filledSurface, res, x, z - 0.65);
      const gLen = Math.hypot(gx, gz);
      if (gLen < accumulationConfig.flatGradientStop) break;

      const nx = -gx / gLen;
      const nz = -gz / gLen;
      const inertia = Math.max(0, Math.min(0.98, accumulationConfig.inertia));
      dirX = dirX * inertia + nx * (1 - inertia);
      dirZ = dirZ * inertia + nz * (1 - inertia);
      const dLen = Math.hypot(dirX, dirZ) || 1;
      x += dirX / dLen;
      z += dirZ / dLen;
      if (x < 1 || x > res - 2 || z < 1 || z > res - 2) break;
    }
  }

  const riverThreshold = particles / count + riversConfig.riverThresholdAdd;
  const visibleThreshold = particles / count + riversConfig.visibleWaterThresholdAdd;
  for (let i = 0; i < count; i++) {
    const acc = accumulation[i];
    const t = Math.max(1e-5, Math.min(60, acc / riverThreshold));
    grid.flowStrength[i] = t > 1 ? Math.max(0, Math.min(1, Math.log2(t) * 0.18)) : 0;
    const tw = Math.max(1e-5, Math.min(60, acc / visibleThreshold));
    grid.waterStrength[i] = tw > 1 ? Math.max(0, Math.min(1, Math.log2(tw) * 0.21)) : 0;
  }

  const radius = Math.max(0, Math.floor(riversConfig.widenRadius));
  const scratch = new Float32Array(count);
  triangleBlur(grid.flowStrength, res, radius, scratch);
  triangleBlur(grid.waterStrength, res, radius, scratch);

  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      const wl = filledSurface[gridIndex(res, clampGridCoord(res, x - 1), z)];
      const wr = filledSurface[gridIndex(res, clampGridCoord(res, x + 1), z)];
      const wd = filledSurface[gridIndex(res, x, clampGridCoord(res, z - 1))];
      const wu = filledSurface[gridIndex(res, x, clampGridCoord(res, z + 1))];
      const dx = wl - wr;
      const dz = wd - wu;
      const len = Math.hypot(dx, dz);
      if (len > 1e-5) {
        grid.flowDirX[i] = (dx / len) * grid.flowStrength[i];
        grid.flowDirZ[i] = (dz / len) * grid.flowStrength[i];
      } else {
        grid.flowDirX[i] = 0;
        grid.flowDirZ[i] = 0;
      }
    }
  }
}
