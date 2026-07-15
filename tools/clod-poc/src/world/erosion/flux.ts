import { clampU32, mulQ16U32 } from "./fixed_point.js";
import type { ErosionState, ResolvedErosionConstants } from "./types.js";

function headWaterUnits(state: ErosionState, index: number): number {
  return state.heightFixed[index]! * 16 + state.water[index]!;
}

function updateOne(previous: number, headDifference: number, responseQ16: number): number {
  const change = mulQ16U32(Math.abs(headDifference), responseQ16);
  return headDifference >= 0 ? clampU32(previous + change) : Math.max(0, previous - change) >>> 0;
}

function normalizeFluxes(values: [number, number, number, number], available: number): [number, number, number, number] {
  let [left, right, up, down] = values;
  let sum = left + right + up + down;
  while (sum > available && sum > 0) {
    left >>>= 1;
    right >>>= 1;
    up >>>= 1;
    down >>>= 1;
    sum = left + right + up + down;
  }
  return [left, right, up, down];
}

export function updateHydraulicFlux(state: ErosionState, constants: ResolvedErosionConstants): void {
  const startX = state.borderCells;
  const endX = state.width - state.borderCells;
  const startZ = state.borderCells;
  const endZ = state.height - state.borderCells;
  const width = state.width;
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const index = z * width + x;
      const head = headWaterUnits(state, index);
      let fluxes: [number, number, number, number] = [
        updateOne(state.fluxLeft[index]!, head - headWaterUnits(state, index - 1), constants.fluxResponseQ16),
        updateOne(state.fluxRight[index]!, head - headWaterUnits(state, index + 1), constants.fluxResponseQ16),
        updateOne(state.fluxUp[index]!, head - headWaterUnits(state, index - width), constants.fluxResponseQ16),
        updateOne(state.fluxDown[index]!, head - headWaterUnits(state, index + width), constants.fluxResponseQ16),
      ];
      const available = Math.min(Number.MAX_SAFE_INTEGER, state.water[index]! * 16);
      if (fluxes[0] + fluxes[1] + fluxes[2] + fluxes[3] > available) fluxes = normalizeFluxes(fluxes, available);
      state.fluxLeft[index] = fluxes[0];
      state.fluxRight[index] = fluxes[1];
      state.fluxUp[index] = fluxes[2];
      state.fluxDown[index] = fluxes[3];
    }
  }
}
