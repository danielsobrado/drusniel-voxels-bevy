import { gridIndex, type HydrologyGrid } from "./hydrologyGrid.js";

export function buildFarWaterSurface(grid: HydrologyGrid, farReduceFactor: number): void {
  const reduce = Math.max(1, Math.floor(farReduceFactor));
  const farRes = Math.max(1, Math.floor(grid.res / reduce));
  const out = grid.waterYFar.length === farRes * farRes ? grid.waterYFar : new Float32Array(farRes * farRes);

  for (let fz = 0; fz < farRes; fz++) {
    const z0 = Math.floor((fz * grid.res) / farRes);
    const z1 = Math.max(z0 + 1, Math.floor(((fz + 1) * grid.res) / farRes));
    for (let fx = 0; fx < farRes; fx++) {
      const x0 = Math.floor((fx * grid.res) / farRes);
      const x1 = Math.max(x0 + 1, Math.floor(((fx + 1) * grid.res) / farRes));
      let minWaterY = Number.POSITIVE_INFINITY;
      for (let z = z0; z < Math.min(grid.res, z1); z++) {
        for (let x = x0; x < Math.min(grid.res, x1); x++) {
          minWaterY = Math.min(minWaterY, grid.waterY[gridIndex(grid.res, x, z)]);
        }
      }
      out[gridIndex(farRes, fx, fz)] = Number.isFinite(minWaterY) ? minWaterY : 0;
    }
  }

  grid.farReduceFactor = reduce;
  grid.farRes = farRes;
  grid.waterYFar = out;
}
