import { surfaceHeight } from "./terrain_surface.js";
import { densityFromEdits } from "./terrain_edits.js";

export function density(x: number, y: number, z: number): number {
  return densityFromEdits(x, y, z, surfaceHeight(x, z) - y);
}

function gradient(x: number, y: number, z: number): [number, number, number] {
  const e = 0.5;
  const gx = density(x + e, y, z) - density(x - e, y, z);
  const gy = density(x, y + e, z) - density(x, y - e, z);
  const gz = density(x, y, z + e) - density(x, y, z - e);
  const nx = -gx;
  const ny = -gy;
  const nz = -gz;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function surfaceNormal(x: number, z: number): [number, number, number] {
  return gradient(x, surfaceHeight(x, z), z);
}

export { gradient };
