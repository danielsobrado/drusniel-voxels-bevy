export interface FarNormalParams {
  mode: string;
  strength: number;
  finite_difference_m: number;
  flatten_with_distance: boolean;
  flatten_start_m: number;
  flatten_end_m: number;
}

export interface NormalResult {
  nx: number;
  ny: number;
  nz: number;
  slope: number;
  debugStrength: number;
}

const EPSILON = 1e-10;

function smoothstep(edge0: number, edge1: number, v: number): number {
  const range = edge1 - edge0;
  const denom = Math.abs(range) < 1e-8 ? 1e-8 : range;
  const t = Math.min(1, Math.max(0, (v - edge0) / denom));
  return t * t * (3 - 2 * t);
}

export function computeFarNormal(
  sampleHeight: (x: number, z: number) => number,
  x: number,
  z: number,
  params: FarNormalParams,
  distanceFromCamera?: number,
): NormalResult {
  const e = params.finite_difference_m;
  const hL = sampleHeight(x - e, z);
  const hR = sampleHeight(x + e, z);
  const hD = sampleHeight(x, z - e);
  const hU = sampleHeight(x, z + e);

  const nx = (hL - hR) / (2 * e);
  const nz = (hD - hU) / (2 * e);
  const ny = 1;

  const len = Math.hypot(nx, ny, nz);
  if (len < EPSILON) {
    return { nx: 0, ny: 1, nz: 0, slope: 0, debugStrength: 0 };
  }

  const slope = Math.hypot(nx, nz) / Math.abs(ny || 1);
  const clampedSlope = Math.min(1, slope);

  let normalStrength = params.strength;
  if (params.flatten_with_distance && distanceFromCamera !== undefined) {
    const flattenK = 1 - smoothstep(params.flatten_start_m, params.flatten_end_m, distanceFromCamera);
    normalStrength *= flattenK;
  }

  const invLen = 1 / len;
  const rnx = nx * invLen;
  const rny = ny * invLen;
  const rnz = nz * invLen;

  const result: NormalResult = {
    nx: rnx,
    ny: 1 - (1 - rny) * normalStrength,
    nz: rnz,
    slope: clampedSlope,
    debugStrength: normalStrength,
  };

  const rLen = Math.hypot(result.nx, result.ny, result.nz);
  if (rLen > EPSILON) {
    result.nx /= rLen;
    result.ny /= rLen;
    result.nz /= rLen;
  }

  return result;
}
