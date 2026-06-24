import {
  gridIndex,
  type HydrologyGrid,
} from "./hydrologyGrid.js";

/**
 * Build the reduced-resolution far water surface used by coarse clipmap levels.
 *
 * Uses body-aware reduction instead of simple min to avoid:
 * - Dark rim bands on far lakes (dry sentinel pulling down the level)
 * - Narrow rivers expanding into huge sheets at far LOD
 *
 * Strategy per far cell block:
 *   - Lake-dominated: use median lake waterY (stable representative level)
 *   - River-dominated: use conservative min wet waterY (rivers vanish at distance)
 *   - Mostly dry: use min local bed - drySentinelDepth
 */
export function buildFarWaterSurface(grid: HydrologyGrid, farReduceFactor: number): void {
  const reduce = Math.max(1, Math.floor(farReduceFactor));
  const farRes = Math.max(1, Math.floor(grid.res / reduce));
  const out = grid.waterYFar.length === farRes * farRes ? grid.waterYFar : new Float32Array(farRes * farRes);

  const LAKE_DOMINANCE = 0.4;   // >40% lake cells → use lake-representative level
  const RIVER_DOMINANCE = 0.3;  // >30% river cells → use conservative min
  const WET_THRESHOLD = 0.1;    // >10% wet cells → not "mostly dry"

  for (let fz = 0; fz < farRes; fz++) {
    const z0 = Math.floor((fz * grid.res) / farRes);
    const z1 = Math.max(z0 + 1, Math.floor(((fz + 1) * grid.res) / farRes));
    for (let fx = 0; fx < farRes; fx++) {
      const x0 = Math.floor((fx * grid.res) / farRes);
      const x1 = Math.max(x0 + 1, Math.floor(((fx + 1) * grid.res) / farRes));

      let minWaterY = Number.POSITIVE_INFINITY;
      let minBedY = Number.POSITIVE_INFINITY;
      let wetCount = 0;
      let lakeCount = 0;
      let riverCount = 0;
      let totalCells = 0;
      const lakeWaterYs: number[] = [];

      for (let z = z0; z < Math.min(grid.res, z1); z++) {
        for (let x = x0; x < Math.min(grid.res, x1); x++) {
          const idx = gridIndex(grid.res, x, z);
          const wY = grid.waterY[idx];
          const bed = grid.carvedBed[idx];
          const wet = grid.wetMask[idx];
          const kind = grid.bodyKind[idx];

          totalCells++;
          if (wet > 0.5) wetCount++;
          if (kind === 2) { // lake
            lakeCount++;
            lakeWaterYs.push(wY);
          }
          if (kind === 3) riverCount++; // river
          minWaterY = Math.min(minWaterY, wY);
          minBedY = Math.min(minBedY, bed);
        }
      }

      const wetRatio = totalCells > 0 ? wetCount / totalCells : 0;
      const lakeRatio = totalCells > 0 ? lakeCount / totalCells : 0;
      const riverRatio = totalCells > 0 ? riverCount / totalCells : 0;

      let result: number;

      if (wetRatio < WET_THRESHOLD) {
        // Mostly dry: conservative min keeps dry sentinel below terrain
        result = minWaterY;
      } else if (lakeRatio >= LAKE_DOMINANCE) {
        // Lake-dominated: use median lake waterY for stable far-water level
        lakeWaterYs.sort((a, b) => a - b);
        const mid = Math.floor(lakeWaterYs.length / 2);
        result = lakeWaterYs.length % 2 === 0
          ? (lakeWaterYs[mid - 1] + lakeWaterYs[mid]) * 0.5
          : lakeWaterYs[mid];
      } else if (riverRatio >= RIVER_DOMINANCE) {
        // River-dominated: conservative min (rivers vanish at far LOD)
        let minWetY = Number.POSITIVE_INFINITY;
        for (let z = z0; z < Math.min(grid.res, z1); z++) {
          for (let x = x0; x < Math.min(grid.res, x1); x++) {
            const idx = gridIndex(grid.res, x, z);
            if (grid.wetMask[idx] > 0.5) {
              minWetY = Math.min(minWetY, grid.waterY[idx]);
            }
          }
        }
        result = Number.isFinite(minWetY) ? minWetY : minWaterY;
      } else {
        // Mixed shore: use min wet waterY, fall back to overall min
        let minWetY = Number.POSITIVE_INFINITY;
        for (let z = z0; z < Math.min(grid.res, z1); z++) {
          for (let x = x0; x < Math.min(grid.res, x1); x++) {
            const idx = gridIndex(grid.res, x, z);
            if (grid.wetMask[idx] > 0.5) {
              minWetY = Math.min(minWetY, grid.waterY[idx]);
            }
          }
        }
        result = Number.isFinite(minWetY) ? minWetY : minWaterY;
      }

      out[gridIndex(farRes, fx, fz)] = Number.isFinite(result) ? result : 0;
    }
  }

  grid.farReduceFactor = reduce;
  grid.farRes = farRes;
  grid.waterYFar = out;
}
