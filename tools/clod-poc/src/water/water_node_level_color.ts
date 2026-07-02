import { clamp, vec3 } from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export function waterLevelColorTsl(level: TslNode): TslNode {
  const c0: TslNode = vec3(0.36, 0.62, 0.95);
  const c1: TslNode = vec3(0.30, 0.86, 0.58);
  const c2: TslNode = vec3(0.94, 0.74, 0.30);
  const c3: TslNode = vec3(0.95, 0.42, 0.46);
  const c4: TslNode = vec3(0.66, 0.46, 0.94);
  const c5: TslNode = vec3(0.42, 0.78, 0.92);
  const idx: TslNode = clamp(level.floor(), 0.0, 5.0);
  return idx.equal(0).select(c0,
    idx.equal(1).select(c1,
      idx.equal(2).select(c2,
        idx.equal(3).select(c3,
          idx.equal(4).select(c4, c5)))));
}
