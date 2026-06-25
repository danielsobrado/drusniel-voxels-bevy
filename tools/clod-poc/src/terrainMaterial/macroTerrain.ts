export function deterministicNoise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = smoothstep01(fx);
  const sy = smoothstep01(fy);
  const n00 = hash2(ix, iy);
  const n10 = hash2(ix + 1, iy);
  const n01 = hash2(ix, iy + 1);
  const n11 = hash2(ix + 1, iy + 1);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

function smoothstep01(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function deterministicFbm(
  x: number, y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxVal = 0;
  for (let i = 0; i < octaves; i++) {
    value += deterministicNoise2(x * frequency, y * frequency) * amplitude;
    maxVal += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / Math.max(maxVal, 1e-8);
}

export function computeMacroTint(
  x: number, z: number,
  scales: [number, number],
  strengths: [number, number, number],
): number {
  const n1 = deterministicNoise2(x / scales[0], z / scales[0]);
  const n2 = deterministicNoise2(x / scales[1], z / scales[1]);
  const v = n1 * 0.65 + n2 * 0.35;
  return (v - 0.5) * (strengths[0] * 0.5 + strengths[1] * 0.3 + strengths[2] * 0.2) * 2;
}
