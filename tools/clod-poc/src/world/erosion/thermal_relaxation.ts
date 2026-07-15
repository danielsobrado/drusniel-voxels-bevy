import { clampI32, mulQ16U32 } from "./fixed_point.js";
import type { ErosionState, ResolvedErosionConstants } from "./types.js";

export function relaxThermalTalus(state: ErosionState, constants: ResolvedErosionConstants): void {
  const width = state.width;
  const startX = state.borderCells + 1;
  const endX = state.width - state.borderCells - 1;
  const startZ = state.borderCells + 1;
  const endZ = state.height - state.borderCells - 1;
  state.thermalDelta.fill(0);
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const index = z * width + x;
      const center = state.heightFixed[index]!;
      const neighbors = [index - 1, index + 1, index - width, index + width] as const;
      let target = neighbors[0];
      for (let n = 1; n < neighbors.length; n++) {
        const candidate = neighbors[n]!;
        if (state.heightFixed[candidate]! < state.heightFixed[target]!) target = candidate;
      }
      const difference = center - state.heightFixed[target]!;
      const hardnessByte = state.hardness[index]! >>> 8;
      const talusLimit = constants.talusHeightUnitsByHardnessByte[hardnessByte]!;
      if (difference <= talusLimit) continue;
      const excess = difference - talusLimit;
      const transfer = Math.min(excess >>> 1, mulQ16U32(excess, constants.thermalRateQ16));
      if (transfer <= 0) continue;
      state.thermalDelta[index] = clampI32(state.thermalDelta[index]! - transfer);
      state.thermalDelta[target] = clampI32(state.thermalDelta[target]! + transfer);
    }
  }
  for (let index = 0; index < state.heightFixed.length; index++) {
    const deltaHeight = state.thermalDelta[index]!;
    if (deltaHeight === 0) continue;
    state.heightFixed[index] = clampI32(state.heightFixed[index]! + deltaHeight);
    state.deposition[index] = clampI32(state.deposition[index]! + deltaHeight * 256);
  }
  state.thermalIteration++;
}
