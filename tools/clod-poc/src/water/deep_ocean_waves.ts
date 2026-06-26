export interface DeepOceanWaveSample {
  dx: number;
  dy: number;
  dz: number;
  slopeX: number;
  slopeZ: number;
  compression: number;
}

interface GerstnerSwell {
  dx: number;
  dz: number;
  wavelength: number;
  steepness: number;
  speedScale: number;
}

interface ResolvedSwell {
  dx: number;
  dz: number;
  k: number;
  omega: number;
  amp: number;
}

const GRAVITY = 9.81;
const OCEAN_HEIGHT_SCALE = 0.34;
const OCEAN_CHOPPINESS = 0.72;

const SWELLS: readonly GerstnerSwell[] = [
  { dx: 0.90, dz: 0.44, wavelength: 120, steepness: 0.18, speedScale: 0.88 },
  { dx: -0.30, dz: 0.95, wavelength: 80, steepness: 0.13, speedScale: 1.05 },
  { dx: 0.60, dz: -0.80, wavelength: 200, steepness: 0.10, speedScale: 0.72 },
  { dx: 0.70, dz: 0.70, wavelength: 400, steepness: 0.06, speedScale: 0.55 },
  { dx: -0.50, dz: 0.86, wavelength: 600, steepness: 0.04, speedScale: 0.45 },
  { dx: 0.40, dz: 0.92, wavelength: 55, steepness: 0.12, speedScale: 1.25 },
];

const RESOLVED_SWELLS: readonly ResolvedSwell[] = SWELLS.map((swell) => {
  const length = Math.hypot(swell.dx, swell.dz) || 1;
  const dx = swell.dx / length;
  const dz = swell.dz / length;
  const k = (Math.PI * 2) / Math.max(1, swell.wavelength);
  const omega = Math.sqrt(GRAVITY * k) * swell.speedScale;
  return { dx, dz, k, omega, amp: (swell.steepness / k) * OCEAN_HEIGHT_SCALE };
});

export function sampleDeepOceanWave(x: number, z: number, timeSeconds: number): DeepOceanWaveSample {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  let slopeX = 0;
  let slopeZ = 0;
  let jxx = 0;
  let jzz = 0;
  let jxz = 0;

  for (const swell of RESOLVED_SWELLS) {
    const theta = swell.k * (swell.dx * x + swell.dz * z) - swell.omega * timeSeconds;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    dx -= swell.amp * swell.dx * s * OCEAN_CHOPPINESS;
    dz -= swell.amp * swell.dz * s * OCEAN_CHOPPINESS;
    dy += swell.amp * c;
    slopeX -= swell.amp * swell.k * swell.dx * s;
    slopeZ -= swell.amp * swell.k * swell.dz * s;
    jxx -= swell.amp * swell.k * swell.dx * swell.dx * c * OCEAN_CHOPPINESS;
    jzz -= swell.amp * swell.k * swell.dz * swell.dz * c * OCEAN_CHOPPINESS;
    jxz -= swell.amp * swell.k * swell.dx * swell.dz * c * OCEAN_CHOPPINESS;
  }

  const jacobian = (1 + jxx) * (1 + jzz) - jxz * jxz;
  const compression = Math.max(0, Math.min(1, (0.58 - jacobian) / 0.58));
  return { dx, dy, dz, slopeX, slopeZ, compression };
}

export function sampleDeepOceanNormal(x: number, z: number, timeSeconds: number): readonly [number, number, number] {
  const sample = sampleDeepOceanWave(x, z, timeSeconds);
  const length = Math.hypot(sample.slopeX, 1, sample.slopeZ) || 1;
  return [-sample.slopeX / length, 1 / length, -sample.slopeZ / length] as const;
}

export function sampleDeepOceanCurrent(x: number, z: number, timeSeconds: number): readonly [number, number, number] {
  const sample = sampleDeepOceanWave(x, z, timeSeconds);
  return [sample.dx * 0.035, 0, sample.dz * 0.035] as const;
}

export function deepOceanWaveVerticalBounds(): number {
  return RESOLVED_SWELLS.reduce((sum, swell) => sum + Math.abs(swell.amp), 0) + 1;
}
