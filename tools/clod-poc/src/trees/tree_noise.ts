export function hash2(x: number, z: number, seed: number): number {
  let value = seed | 0;
  value ^= Math.imul(Math.floor(x) | 0, 0x27d4eb2d);
  value ^= Math.imul(Math.floor(z) | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function hash3(x: number, y: number, z: number, seed: number): number {
  let value = seed | 0;
  value ^= Math.imul(Math.floor(x) | 0, 0x27d4eb2d);
  value ^= Math.imul(Math.floor(y) | 0, 0x9e3779b1);
  value ^= Math.imul(Math.floor(z) | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise2D(x: number, z: number, scaleM: number, seed: number): number {
  const scale = Math.max(0.001, scaleM);
  const nx = x / scale;
  const nz = z / scale;
  const x0 = Math.floor(nx);
  const z0 = Math.floor(nz);
  const tx = smoothstep01(nx - x0);
  const tz = smoothstep01(nz - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

export function fractalNoise2D(x: number, z: number, scaleM: number, seed: number, octaves = 3): number {
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise2D(x * frequency, z * frequency, scaleM, seed + octave * 1013) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return weight > 0 ? clamp01(total / weight) : 0;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= 1e-8) return value < edge0 ? 0 : 1;
  return smoothstep01(clamp01((value - edge0) / (edge1 - edge0)));
}

export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (Math.abs(inMax - inMin) <= 1e-8) return outMin;
  return lerp(outMin, outMax, clamp01((value - inMin) / (inMax - inMin)));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
