import { treePcg2dU32 } from "../../vegetation/gpu_authority/pcg2d.js";
import type { DressingEnvironmentSample, DressingStableId } from "./types.js";

const MAX_LOG_SLOPE_NORMAL_Y = Math.cos(30 * Math.PI / 180);

export function acceptDeadLogCandidate(
  sample: DressingEnvironmentSample,
  endpointSupportDistancesM: readonly [number, number],
): boolean {
  return sample.normal[1] >= MAX_LOG_SLOPE_NORMAL_Y
    && sample.waterDepthM <= 0.12
    && endpointSupportDistancesM[0] <= 0.35
    && endpointSupportDistancesM[1] <= 0.35
    && !sample.structureExcluded
    && !sample.persistentExcluded;
}

export function createPairedStumpId(deadfallId: DressingStableId): DressingStableId {
  const [lo, hi] = treePcg2dU32(deadfallId.lo | 0, deadfallId.hi | 0, 0x3201);
  return { lo, hi };
}

export function deadfallOrientation(
  downhillRad: number,
  prevailingWindfallRad: number,
  randomRad: number,
  selectionRoll: number,
): number {
  if (selectionRoll < 0.65) return downhillRad;
  if (selectionRoll < 0.85) return prevailingWindfallRad;
  return randomRad;
}
