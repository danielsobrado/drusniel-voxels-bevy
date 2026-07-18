import { float, smoothstep } from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslAny = any;

export function inverseSmoothstep(edge0: TslAny, edge1: TslAny, value: TslAny): TslAny {
  return float(1).sub(smoothstep(edge0, edge1, value));
}

export function inverseSmoothstepReference(edge0: number, edge1: number, value: number): number {
  if (!(edge1 > edge0)) return value < edge0 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return 1 - t * t * (3 - 2 * t);
}
