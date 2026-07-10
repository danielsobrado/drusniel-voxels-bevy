import type { HydrologyWaterSurfaceConfig } from "./hydrologyConfig.js";
import { HYDROLOGY_BODY_DRY, clampGridCoord, gridIndex, type HydrologyGrid } from "./hydrologyGrid.js";
import { computeBodyIds, isStillBodyKind } from "./bodyIdentity.js";

const NEIGHBORS_4 = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

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

  // Label bodies from the initial wet mask so the smoothing/flatten passes stay
  // body-aware: a lake surface must never be averaged with a river, ocean or a disjoint
  // pond. (build() recomputes final ids after the cliff pass below can turn cells dry.)
  computeBodyIds(grid);

  // Diffuse only within a single body — averaging across a wet<->wet seam between two
  // different bodies is exactly what dragged lake surfaces onto rivers before.
  const tmp = new Float32Array(waterY.length);
  for (let iter = 0; iter < config.wetSmoothIterations; iter++) {
    tmp.set(waterY);
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const i = gridIndex(res, x, z);
        if (wetMask[i] <= 0.5) continue;
        const body = grid.bodyId[i];
        let sum = waterY[i];
        let count = 1;
        for (const [ox, oz] of NEIGHBORS_4) {
          const ni = gridIndex(res, clampGridCoord(res, x + ox), clampGridCoord(res, z + oz));
          if (wetMask[ni] > 0.5 && grid.bodyId[ni] === body) {
            sum += waterY[ni];
            count++;
          }
        }
        tmp[i] = sum / count;
      }
    }
    waterY.set(tmp);
  }

  flattenStillBodies(grid);
  enforceRiverDownstreamMonotonic(grid);

  // Physical floor for still bodies: a lake/pond cell flattened to the body mean can end
  // up below a shallow-shore bed. Clamp any remaining wet cell up to its carved bed so
  // depth is never negative (rivers are already bed-floored inside the monotonic pass).
  for (let i = 0; i < waterY.length; i++) {
    if (wetMask[i] > 0.5 && waterY[i] < carvedBed[i]) waterY[i] = carvedBed[i];
  }

  tmp.set(waterY);
  const nextWetMask = new Float32Array(wetMask);
  const nextLakeMask = new Float32Array(grid.lakeMask);
  const nextRiverMask = new Float32Array(grid.riverMask);
  const nextBodyKind = new Int8Array(grid.bodyKind);
  const maxJump = config.wetToWetCliffSlopeMax * grid.texel;
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      if (wetMask[i] <= 0.5) continue;
      const body = grid.bodyId[i];
      let cliff = false;
      for (const [ox, oz] of NEIGHBORS_4) {
        const ni = gridIndex(res, clampGridCoord(res, x + ox), clampGridCoord(res, z + oz));
        // Only a cliff *inside the same body* is a data problem worth culling. A large
        // step across two different bodies (e.g. a river dropping into a lower lake) is
        // legitimate geometry, not a smoothing artefact, so it must not delete the cell.
        if (wetMask[ni] > 0.5 && grid.bodyId[ni] === body && Math.abs(waterY[i] - waterY[ni]) > maxJump) {
          cliff = true;
          break;
        }
      }
      if (cliff) {
        tmp[i] = carvedBed[i] - drySentinelDepth;
        nextWetMask[i] = 0;
        nextLakeMask[i] = 0;
        nextRiverMask[i] = 0;
        nextBodyKind[i] = HYDROLOGY_BODY_DRY;
      }
    }
  }
  waterY.set(tmp);
  wetMask.set(nextWetMask);
  grid.lakeMask.set(nextLakeMask);
  grid.riverMask.set(nextRiverMask);
  grid.bodyKind.set(nextBodyKind);
}

/**
 * Force every still-water body (lake / pond / marsh) to a single constant surface height
 * so it reads as a flat plane instead of a spatially-smoothed sheet that can sag or tilt.
 * The representative level is the area mean of the body's cells (robust to a few carve
 * outliers).
 */
function flattenStillBodies(grid: HydrologyGrid): void {
  const { res, waterY, wetMask, bodyKind, bodyId } = grid;
  let maxId = 0;
  for (let i = 0; i < bodyId.length; i++) if (bodyId[i] > maxId) maxId = bodyId[i];
  if (maxId === 0) return;
  const sum = new Float64Array(maxId + 1);
  const count = new Uint32Array(maxId + 1);
  const still = new Uint8Array(maxId + 1);
  for (let i = 0; i < bodyId.length; i++) {
    const id = bodyId[i];
    if (id === 0 || wetMask[i] <= 0.5) continue;
    if (isStillBodyKind(bodyKind[i])) still[id] = 1;
    sum[id] += waterY[i];
    count[id]++;
  }
  const level = new Float64Array(maxId + 1);
  for (let id = 1; id <= maxId; id++) {
    level[id] = count[id] > 0 ? sum[id] / count[id] : 0;
  }
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      const id = bodyId[i];
      if (id === 0 || wetMask[i] <= 0.5 || still[id] === 0) continue;
      waterY[i] = level[id];
    }
  }
}

/**
 * Relax river surfaces so they are non-increasing downhill *subject to the carved bed*.
 * For each river cell the surface is pulled down to its upstream neighbour but never below
 * its own bed: waterY = max(carvedBed, min(waterY, upstreamWaterY)). Where a channel bed
 * genuinely rises downstream the surface steps up with it (a legitimate riffle/pool lip),
 * but it never drops below the bed (no negative depth) and never rises more than the bed
 * does (no floating step). A few propagation passes spread the correction along the
 * channel; still bodies are untouched.
 */
function enforceRiverDownstreamMonotonic(grid: HydrologyGrid): void {
  const { res, waterY, carvedBed, wetMask, riverMask, flowDirX, flowDirZ, bodyId } = grid;
  const PASSES = 6;
  for (let pass = 0; pass < PASSES; pass++) {
    let changed = false;
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const i = gridIndex(res, x, z);
        if (wetMask[i] <= 0.5 || riverMask[i] <= 0.5) continue;
        const fx = flowDirX[i];
        const fz = flowDirZ[i];
        if (fx === 0 && fz === 0) continue;
        // Upstream cell is one step against the flow direction.
        const ux = clampGridCoord(res, x - Math.sign(fx));
        const uz = clampGridCoord(res, z - Math.sign(fz));
        const ui = gridIndex(res, ux, uz);
        if (wetMask[ui] <= 0.5 || bodyId[ui] !== bodyId[i]) continue;
        const target = Math.max(carvedBed[i], Math.min(waterY[i], waterY[ui]));
        if (target !== waterY[i]) {
          waterY[i] = target;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}
