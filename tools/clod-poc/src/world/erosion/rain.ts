import { FRACTION_Q16_ONE } from "./constants.js";
import { clampU32, hashU32, mulDivI32, mulQ16U32 } from "./fixed_point.js";
import type { ErosionState, ResolvedErosionConstants } from "./types.js";

export function injectRain(
  state: ErosionState,
  constants: ResolvedErosionConstants,
  seed: number,
  iteration: number,
): void {
  const startX = state.borderCells;
  const endX = state.width - state.borderCells;
  const startZ = state.borderCells;
  const endZ = state.height - state.borderCells;
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const hash = hashU32(seed, x - startX, z - startZ, iteration);
      const centered = ((hash >>> 16) & 0xffff) - 0x8000;
      const variation = mulDivI32(centered, constants.rainVariationQ16, 0x8000);
      const factorQ16 = Math.max(0, FRACTION_Q16_ONE + variation);
      const amount = mulQ16U32(constants.rainWaterUnits, factorQ16);
      const index = z * state.width + x;
      state.water[index] = clampU32(state.water[index]! + amount);
    }
  }
}
