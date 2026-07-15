import { VELOCITY_UNITS_PER_CELL } from "./constants.js";
import { bilinearWeightQ16, clampU32, mulQ16U32 } from "./fixed_point.js";
import type { ErosionState } from "./types.js";

function addSaturated(target: Uint32Array, index: number, amount: number): void {
  target[index] = clampU32(target[index]! + amount);
}

export function advectSediment(state: ErosionState): void {
  const source = state.sediment;
  const target = state.sedimentScratch;
  target.fill(0);
  const startX = state.borderCells;
  const endX = state.width - state.borderCells;
  const startZ = state.borderCells;
  const endZ = state.height - state.borderCells;
  const minXFixed = startX * VELOCITY_UNITS_PER_CELL;
  const maxXFixed = (endX - 1) * VELOCITY_UNITS_PER_CELL;
  const minZFixed = startZ * VELOCITY_UNITS_PER_CELL;
  const maxZFixed = (endZ - 1) * VELOCITY_UNITS_PER_CELL;
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const index = z * state.width + x;
      const suspended = source[index]!;
      if (suspended === 0) continue;
      const targetXFixed = Math.max(minXFixed, Math.min(maxXFixed, x * VELOCITY_UNITS_PER_CELL + state.velocityX[index]!));
      const targetZFixed = Math.max(minZFixed, Math.min(maxZFixed, z * VELOCITY_UNITS_PER_CELL + state.velocityZ[index]!));
      const x0 = Math.floor(targetXFixed / VELOCITY_UNITS_PER_CELL);
      const z0 = Math.floor(targetZFixed / VELOCITY_UNITS_PER_CELL);
      const x1 = Math.min(endX - 1, x0 + 1);
      const z1 = Math.min(endZ - 1, z0 + 1);
      const fx = targetXFixed - x0 * VELOCITY_UNITS_PER_CELL;
      const fz = targetZFixed - z0 * VELOCITY_UNITS_PER_CELL;
      const p00 = mulQ16U32(suspended, bilinearWeightQ16(fx, fz, 0, 0));
      const p10 = mulQ16U32(suspended, bilinearWeightQ16(fx, fz, 1, 0));
      const p01 = mulQ16U32(suspended, bilinearWeightQ16(fx, fz, 0, 1));
      const p11 = suspended - p00 - p10 - p01;
      addSaturated(target, z0 * state.width + x0, p00);
      addSaturated(target, z0 * state.width + x1, p10);
      addSaturated(target, z1 * state.width + x0, p01);
      addSaturated(target, z1 * state.width + x1, p11);
    }
  }
  state.sediment = target;
  state.sedimentScratch = source;
}
