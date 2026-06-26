/** Deterministic pseudo-random helpers — never use Math.random() in this module. */

export function hash01(x: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hashSigned(x: number, z: number, seed: number): number {
  return hash01(x, z, seed) * 2 - 1;
}

export function smoothstep(edge0: number, edge1: number, t: number): number {
  const x = Math.max(0, Math.min(1, (t - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function fbm2(x: number, z: number, seed: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const sx = Math.floor(x * freq * 0.01);
    const sz = Math.floor(z * freq * 0.01);
    sum += amp * (hashSigned(sx, sz, seed + i * 17) * 0.5 + 0.5);
    norm += amp;
    freq *= 2;
    amp *= 0.5;
  }
  return norm > 0 ? sum / norm : 0;
}
