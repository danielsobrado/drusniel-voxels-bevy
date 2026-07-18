import { float, smoothstep } from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslAny = any;

const MIN_SMOOTHSTEP_WIDTH = 1e-5;

export function inverseSmoothstep(edge0: TslAny, edge1: TslAny, value: TslAny): TslAny {
  const first = float(edge0);
  const second = float(edge1);
  const low = first.min(second);
  const high = first.max(second).max(low.add(MIN_SMOOTHSTEP_WIDTH));
  return float(1).sub(smoothstep(low, high, value));
}

export function inverseSmoothstepReference(edge0: number, edge1: number, value: number): number {
  const low = Math.min(edge0, edge1);
  const high = Math.max(Math.max(edge0, edge1), low + MIN_SMOOTHSTEP_WIDTH);
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return 1 - t * t * (3 - 2 * t);
}
