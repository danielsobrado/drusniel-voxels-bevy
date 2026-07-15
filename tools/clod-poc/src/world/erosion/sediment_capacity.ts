import { HARDNESS_MAX } from "./constants.js";
import { approximateHypotI32, clampU32, mulQ16U32, ratioQ16U53 } from "./fixed_point.js";
import type { ErosionState, ResolvedErosionConstants } from "./types.js";

export function computeSedimentCapacity(state: ErosionState, constants: ResolvedErosionConstants): void {
  const startX = state.borderCells;
  const endX = state.width - state.borderCells;
  const startZ = state.borderCells;
  const endZ = state.height - state.borderCells;
  const width = state.width;
  const cellRiseUnits = Math.max(1, Math.round(state.cellSizeM * 256));
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const index = z * width + x;
      if (state.water[index] === 0) {
        state.capacity[index] = 0;
        continue;
      }
      const center = state.heightFixed[index]!;
      const maxDrop = Math.max(
        0,
        center - state.heightFixed[index - 1]!,
        center - state.heightFixed[index + 1]!,
        center - state.heightFixed[index - width]!,
        center - state.heightFixed[index + width]!,
      );
      const slopeQ16 = Math.max(constants.minimumSlopeQ16, ratioQ16U53(Math.min(0xffff, maxDrop), cellRiseUnits));
      const speed = approximateHypotI32(state.velocityX[index]!, state.velocityZ[index]!);
      const speedQ16 = Math.min(0x10000, ratioQ16U53(speed, Math.max(1, constants.maxVelocityFixed)));
      const softnessQ16 = Math.max(0, HARDNESS_MAX - state.hardness[index]!);
      let capacity = clampU32(state.water[index]! * 16);
      capacity = mulQ16U32(capacity, speedQ16);
      capacity = mulQ16U32(capacity, slopeQ16);
      capacity = mulQ16U32(capacity, cellRiseUnits * 256);
      capacity = mulQ16U32(capacity, constants.capacityFactorQ16);
      capacity = mulQ16U32(capacity, softnessQ16);
      state.capacity[index] = capacity;
    }
  }
}
