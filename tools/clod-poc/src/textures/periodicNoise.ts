const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hash22(ix: number, iy: number, seed: number): [number, number] {
  return [hash2(ix, iy, seed), hash2(ix + 19, iy - 37, seed ^ 0x9e3779b9)];
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrapLattice(value: number, period: number): number {
  const safePeriod = periodCells(period);
  return ((value % safePeriod) + safePeriod) % safePeriod;
}

export function periodCells(period: number): number {
  return Math.max(1, Math.round(period));
}

export function periodicValueNoise2(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = smooth(fx);
  const uy = smooth(fy);
  const x0i = wrapLattice(ix, period);
  const x1i = wrapLattice(ix + 1, period);
  const y0i = wrapLattice(iy, period);
  const y1i = wrapLattice(iy + 1, period);
  const a = hash2(x0i, y0i, seed);
  const b = hash2(x1i, y0i, seed);
  const c = hash2(x0i, y1i, seed);
  const d = hash2(x1i, y1i, seed);
  const x0 = a + (b - a) * ux;
  const x1 = c + (d - c) * ux;
  return x0 + (x1 - x0) * uy;
}

export function periodicFbm2(x: number, y: number, period: number, seed: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const octavePeriod = Math.max(1, Math.round(period) * freq);
    sum += periodicValueNoise2(x * freq + octave * 17, y * freq - octave * 9, octavePeriod, seed + octave * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / Math.max(norm, 0.0001);
}

export function periodicRidged2(x: number, y: number, period: number, seed: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const octavePeriod = Math.max(1, Math.round(period) * freq);
    const n = Math.abs(periodicValueNoise2(x * freq + octave * 13, y * freq + octave * 5, octavePeriod, seed ^ 0x6c8e9cf5) * 2 - 1);
    const r = 1 - n;
    sum += r * r * amp;
    norm += amp;
    amp *= 0.53;
    freq *= 2;
  }
  return sum / Math.max(norm, 0.0001);
}

export function periodicWorleyF1(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let best = 8;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const [hx, hy] = hash22(wrapLattice(ix + ox, period), wrapLattice(iy + oy, period), seed);
      const dx = ox + hx - fx;
      const dy = oy + hy - fy;
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return clamp01(best / 1.41421356237);
}

export function periodicWorleyF1Edge(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  seed: number,
): { f1: number; edge: number } {
  const px = periodCells(periodX);
  const py = periodCells(periodY);
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let best = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const [hx, hy] = hash22(wrapLattice(ix + ox, px), wrapLattice(iy + oy, py), seed);
      const dx = ox + hx - fx;
      const dy = oy + hy - fy;
      const d = Math.hypot(dx, dy);
      if (d < best) {
        second = best;
        best = d;
      } else if (d < second && d > best + 1e-5) {
        second = d;
      }
    }
  }
  const f1 = clamp01(best / 1.41421356237);
  const edge = clamp01((second - best) / 1.41421356237);
  return { f1, edge };
}
