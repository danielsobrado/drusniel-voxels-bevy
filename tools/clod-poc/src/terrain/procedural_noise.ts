const DEFAULT_SEED = 0;

export interface FbmSettings {
  scale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  seed?: number;
}

export interface DomainWarpSettings extends FbmSettings {
  warpScale: number;
  warpStrength: number;
}

export function smooth01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

export function smoothstepRange(edge0: number, edge1: number, value: number): number {
  const denominator = edge1 - edge0;
  if (Math.abs(denominator) <= Number.EPSILON) return value >= edge1 ? 1 : 0;
  return smooth01((value - edge0) / denominator);
}

export function hashPositionSeeded(x: number, z: number, seed = DEFAULT_SEED): number {
  let n = (
    Math.imul(x | 0, 374761393) +
    Math.imul(z | 0, 668265263) +
    Math.imul(seed | 0, 1376312589)
  ) | 0;
  n = Math.imul(n ^ (n >> 13), 1274126177);
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

export function valueNoise2(x: number, z: number, seed = DEFAULT_SEED): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = smooth01(x - xi);
  const zf = smooth01(z - zi);
  const a = hashPositionSeeded(xi, zi, seed);
  const b = hashPositionSeeded(xi + 1, zi, seed);
  const c = hashPositionSeeded(xi, zi + 1, seed);
  const d = hashPositionSeeded(xi + 1, zi + 1, seed);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

export function fbm2(x: number, z: number, settings: FbmSettings): number {
  let value = 0;
  let amplitude = 1;
  let frequency = Math.max(1e-8, settings.scale);
  let maxValue = 0;
  const octaves = Math.max(1, Math.floor(settings.octaves));
  const seed = settings.seed ?? DEFAULT_SEED;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise2(x * frequency + i * 37.17, z * frequency - i * 19.31, seed + i * 101);
    maxValue += amplitude;
    amplitude *= settings.persistence;
    frequency *= settings.lacunarity;
  }

  return maxValue > 0 ? value / maxValue : 0;
}

export function ridgedFbm2(x: number, z: number, settings: FbmSettings, power = 1.5): number {
  let value = 0;
  let amplitude = 1;
  let frequency = Math.max(1e-8, settings.scale);
  let maxValue = 0;
  const octaves = Math.max(1, Math.floor(settings.octaves));
  const seed = settings.seed ?? DEFAULT_SEED;

  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2(x * frequency + i * 83.9, z * frequency - i * 47.3, seed + i * 131);
    const ridge = Math.pow(1 - Math.abs(n * 2 - 1), power);
    value += amplitude * ridge;
    maxValue += amplitude;
    amplitude *= settings.persistence;
    frequency *= settings.lacunarity;
  }

  return maxValue > 0 ? value / maxValue : 0;
}

export function domainWarpedFbm2(x: number, z: number, settings: DomainWarpSettings): number {
  const seed = settings.seed ?? DEFAULT_SEED;
  const wx = fbm2(x + 137.5, z - 91.25, {
    scale: settings.warpScale,
    octaves: Math.max(1, Math.min(3, settings.octaves)),
    persistence: 0.5,
    lacunarity: 2.0,
    seed: seed + 811,
  }) * 2 - 1;
  const wz = fbm2(x - 233.75, z + 57.5, {
    scale: settings.warpScale,
    octaves: Math.max(1, Math.min(3, settings.octaves)),
    persistence: 0.5,
    lacunarity: 2.0,
    seed: seed + 1451,
  }) * 2 - 1;

  return fbm2(x + wx * settings.warpStrength, z + wz * settings.warpStrength, settings);
}
