import { VELOCITY_UNITS_PER_CELL } from "./constants.js";
import { clampI32, clampU32, mulQ16U32 } from "./fixed_point.js";
import type { ErosionState, ResolvedErosionConstants } from "./types.js";

export function updateWaterAndVelocity(state: ErosionState, constants: ResolvedErosionConstants): void {
  const startX = state.borderCells;
  const endX = state.width - state.borderCells;
  const startZ = state.borderCells;
  const endZ = state.height - state.borderCells;
  const width = state.width;
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const index = z * width + x;
      const outgoing = state.fluxLeft[index]! + state.fluxRight[index]! + state.fluxUp[index]! + state.fluxDown[index]!;
      const incoming = state.fluxRight[index - 1]! + state.fluxLeft[index + 1]!
        + state.fluxDown[index - width]! + state.fluxUp[index + width]!;
      const deltaWater = Math.trunc((incoming - outgoing) / 16);
      const nextWater = clampU32(state.water[index]! + deltaWater);
      state.water[index] = nextWater;
      if (nextWater === 0) {
        state.velocityX[index] = 0;
        state.velocityZ[index] = 0;
        continue;
      }
      const denominator = Math.max(1, Math.min(0x7fffffff, nextWater * 16));
      const fluxX = Math.max(-524_287, Math.min(524_287, clampI32(state.fluxRight[index]! - state.fluxLeft[index]!)));
      const fluxZ = Math.max(-524_287, Math.min(524_287, clampI32(state.fluxDown[index]! - state.fluxUp[index]!)));
      const velocityX = Math.trunc(fluxX * VELOCITY_UNITS_PER_CELL / denominator);
      const velocityZ = Math.trunc(fluxZ * VELOCITY_UNITS_PER_CELL / denominator);
      state.velocityX[index] = Math.max(-constants.maxVelocityFixed, Math.min(constants.maxVelocityFixed, velocityX));
      state.velocityZ[index] = Math.max(-constants.maxVelocityFixed, Math.min(constants.maxVelocityFixed, velocityZ));
    }
  }
}

export function evaporateAndDrainBoundaries(state: ErosionState, constants: ResolvedErosionConstants): void {
  const width = state.width;
  const height = state.height;
  const border = state.borderCells;
  for (let index = 0; index < state.water.length; index++) {
    state.water[index] = mulQ16U32(state.water[index]!, constants.evaporationRetainQ16);
  }
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (x >= border && z >= border && x < width - border && z < height - border) continue;
      const index = z * width + x;
      state.water[index] = 0;
      state.sediment[index] = 0;
      state.fluxLeft[index] = 0;
      state.fluxRight[index] = 0;
      state.fluxUp[index] = 0;
      state.fluxDown[index] = 0;
      state.velocityX[index] = 0;
      state.velocityZ[index] = 0;
    }
  }
}
