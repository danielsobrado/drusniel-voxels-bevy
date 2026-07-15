import { treePcg2d01 } from "../../vegetation/gpu_authority/pcg2d.js";
import type { DressingStableId } from "./types.js";

export type DressingDecayClass = "fresh" | "mossy" | "rotten";

export function selectDecayClass(age01: number): DressingDecayClass {
  if (age01 < 0.33) return "fresh";
  if (age01 <= 0.72) return "mossy";
  return "rotten";
}

export function decayAge(
  stableId: DressingStableId,
  moisture01: number,
  canopyShade01: number,
  biomeTemperature01: number,
): number {
  const base = treePcg2d01(stableId.lo | 0, stableId.hi | 0, 0x3101)[0];
  return Math.max(0, Math.min(1, base * 0.55 + moisture01 * 0.2 + canopyShade01 * 0.15 + biomeTemperature01 * 0.1));
}
