import { HARDNESS_MAX } from "./constants.js";
import { clampI32, clampU32, mulQ16U32 } from "./fixed_point.js";
import type { ErosionState, ResolvedErosionConstants } from "./types.js";

const SEDIMENT_UNITS_PER_HEIGHT_UNIT = 256;

export function erodeOrDeposit(state: ErosionState, constants: ResolvedErosionConstants): void {
  const startX = state.borderCells;
  const endX = state.width - state.borderCells;
  const startZ = state.borderCells;
  const endZ = state.height - state.borderCells;
  const width = state.width;
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const index = z * width + x;
      const suspended = state.sediment[index]!;
      const capacity = state.capacity[index]!;
      if (suspended < capacity) {
        const deficit = capacity - suspended;
        const softnessQ16 = Math.max(0, HARDNESS_MAX - state.hardness[index]!);
        const hardnessLimit = mulQ16U32(constants.maxErosionSedimentUnits, softnessQ16);
        const requested = Math.min(hardnessLimit, mulQ16U32(deficit, constants.erosionRateQ16));
        const heightUnits = Math.trunc(requested / SEDIMENT_UNITS_PER_HEIGHT_UNIT);
        if (heightUnits <= 0) continue;
        const actual = heightUnits * SEDIMENT_UNITS_PER_HEIGHT_UNIT;
        state.heightFixed[index] = clampI32(state.heightFixed[index]! - heightUnits);
        state.sediment[index] = clampU32(suspended + actual);
        state.deposition[index] = clampI32(state.deposition[index]! - actual);
        continue;
      }
      if (suspended === capacity) continue;
      const excess = suspended - capacity;
      const requested = Math.min(
        constants.maxDepositionSedimentUnits,
        mulQ16U32(excess, constants.depositionRateQ16),
      );
      const heightUnits = Math.trunc(requested / SEDIMENT_UNITS_PER_HEIGHT_UNIT);
      if (heightUnits <= 0) continue;
      const actual = Math.min(suspended, heightUnits * SEDIMENT_UNITS_PER_HEIGHT_UNIT);
      state.heightFixed[index] = clampI32(state.heightFixed[index]! + Math.trunc(actual / SEDIMENT_UNITS_PER_HEIGHT_UNIT));
      state.sediment[index] = suspended - actual;
      state.deposition[index] = clampI32(state.deposition[index]! + actual);
    }
  }
}
