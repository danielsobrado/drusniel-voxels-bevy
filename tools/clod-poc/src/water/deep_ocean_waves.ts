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

interface SpectrumWave {
  dx: number;
  dz: number;
  k: number;
  omega: number;
  amp: number;
  phase: number;
  cascade: 0 | 1;
}

export const DEEP_OCEAN_SPECTRUM = {
  gravity: 9.81,
  gridK: 16,
  patchCoarse: 250,
  patchFine: 37,
  activeCpuWaves: 128,
  windSpeed: 14.0,
  windDirectionRad: Math.PI * 0.25,
  heightScale: 1.3,
  choppiness: 0.72,
  swellHeightScale: 0.34,
} as const;

const TWO_PI = Math.PI * 2;
const SPECTRUM_SEED = 12345;

const SWELLS: readonly GerstnerSwell[] = [
  { dx: 0.90, dz: 0.44, wavelength: 120, steepness: 0.18, speedScale: 0.88 },
  { dx: -0.30, dz: 0.95, wavelength: 80, steepness: 0.13, speedScale: 1.05 },
  { dx: 0.60, dz: -0.80, wavelength: 200, steepness: 0.10, speedScale: 0.72 },
  { dx: 0.70, dz: 0.70, wavelength: 400, steepness: 0.06, speedScale: 0.55 },
  { dx: -0.50, dz: 0.86, wavelength: 600, steepness: 0.04, speedScale: 0.45 },
  { dx: 0.40, dz: 0.92, wavelength: 55, steepness: 0.12, speedScale: 1.25 },
];

function hash01(value: number, seed = SPECTRUM_SEED): number {
  let n = (Math.imul(value | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  n = Math.imul(n ^ (n >> 13), 1274126177);
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function resolveSwells(): readonly ResolvedSwell[] {
  return SWELLS.map((swell) => {
    const length = Math.hypot(swell.dx, swell.dz) || 1;
    const dx = swell.dx / length;
    const dz = swell.dz / length;
    const k = TWO_PI / Math.max(1, swell.wavelength);
    const omega = Math.sqrt(DEEP_OCEAN_SPECTRUM.gravity * k) * swell.speedScale;
    return {
      dx,
      dz,
      k,
      omega,
      amp: (swell.steepness / k) * DEEP_OCEAN_SPECTRUM.swellHeightScale,
    };
  });
}

function buildCascade(cascade: 0 | 1, patchSize: number): SpectrumWave[] {
  const waves: SpectrumWave[] = [];
  const gridK = DEEP_OCEAN_SPECTRUM.gridK;
  const dk = TWO_PI / patchSize;
  const windSpeed = Math.max(0.5, DEEP_OCEAN_SPECTRUM.windSpeed);
  const fetchLength = (windSpeed * windSpeed) / DEEP_OCEAN_SPECTRUM.gravity;
  const omegaPeak = (DEEP_OCEAN_SPECTRUM.gravity * 0.87) / windSpeed;

  for (let iz = 0; iz < gridK; iz++) {
    for (let ix = 0; ix < gridK; ix++) {
      const nx = ix - gridK / 2;
      const nz = iz - gridK / 2;
      if (Math.abs(nx) < 0.5 && Math.abs(nz) < 0.5) continue;

      const kx = nx * dk;
      const kz = nz * dk;
      const k = Math.max(0.0001, Math.hypot(kx, kz));
      const omega = Math.sqrt(DEEP_OCEAN_SPECTRUM.gravity * k);
      const dx = kx / k;
      const dz = kz / k;
      const kFetch = k * fetchLength;
      const k4 = k * k * k * k;
      const phillips = (0.01 / k4) * Math.exp(-1 / Math.max(1e-6, kFetch * kFetch));
      const sigma = omega <= omegaPeak ? 0.07 : 0.09;
      const ratio = (omega - omegaPeak) / Math.max(1e-6, sigma * omegaPeak);
      const jonswap = Math.pow(3.3, Math.exp(-0.5 * ratio * ratio));
      const waveAngle = Math.atan2(kz, kx);
      const directional = Math.pow(Math.max(Math.cos(waveAngle - DEEP_OCEAN_SPECTRUM.windDirectionRad), 0), 2);
      const suppress = Math.exp(k * k * -0.0001);
      const spectrum = phillips * jonswap * directional * suppress;
      const amp = Math.sqrt(Math.max(0, spectrum)) * dk * DEEP_OCEAN_SPECTRUM.heightScale;
      if (amp <= 1e-6) continue;

      const waveIndex = cascade * gridK * gridK + iz * gridK + ix;
      waves.push({
        dx,
        dz,
        k,
        omega,
        amp,
        phase: hash01(waveIndex, SPECTRUM_SEED) * TWO_PI,
        cascade,
      });
    }
  }

  return waves;
}

const RESOLVED_SWELLS = resolveSwells();
const SPECTRUM_WAVES = [
  ...buildCascade(0, DEEP_OCEAN_SPECTRUM.patchCoarse),
  ...buildCascade(1, DEEP_OCEAN_SPECTRUM.patchFine),
]
  .sort((a, b) => b.amp - a.amp)
  .slice(0, DEEP_OCEAN_SPECTRUM.activeCpuWaves);

function accumulateWave(
  acc: DeepOceanWaveSample & { jxx: number; jzz: number; jxz: number },
  dx: number,
  dz: number,
  k: number,
  omega: number,
  amp: number,
  phase: number,
  x: number,
  z: number,
  timeSeconds: number,
): void {
  const theta = k * (dx * x + dz * z) - omega * timeSeconds + phase;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  acc.dx -= amp * dx * s * DEEP_OCEAN_SPECTRUM.choppiness;
  acc.dz -= amp * dz * s * DEEP_OCEAN_SPECTRUM.choppiness;
  acc.dy += amp * c;
  acc.slopeX -= amp * k * dx * s;
  acc.slopeZ -= amp * k * dz * s;
  acc.jxx -= amp * k * dx * dx * c * DEEP_OCEAN_SPECTRUM.choppiness;
  acc.jzz -= amp * k * dz * dz * c * DEEP_OCEAN_SPECTRUM.choppiness;
  acc.jxz -= amp * k * dx * dz * c * DEEP_OCEAN_SPECTRUM.choppiness;
}

export function sampleDeepOceanWave(x: number, z: number, timeSeconds: number): DeepOceanWaveSample {
  const acc = { dx: 0, dy: 0, dz: 0, slopeX: 0, slopeZ: 0, compression: 0, jxx: 0, jzz: 0, jxz: 0 };

  for (const wave of SPECTRUM_WAVES) {
    accumulateWave(acc, wave.dx, wave.dz, wave.k, wave.omega, wave.amp, wave.phase, x, z, timeSeconds);
  }

  for (const swell of RESOLVED_SWELLS) {
    accumulateWave(acc, swell.dx, swell.dz, swell.k, swell.omega, swell.amp, 0, x, z, timeSeconds);
  }

  const jacobian = (1 + acc.jxx) * (1 + acc.jzz) - acc.jxz * acc.jxz;
  acc.compression = Math.max(0, Math.min(1, (0.58 - jacobian) / 0.58));
  return {
    dx: acc.dx,
    dy: acc.dy,
    dz: acc.dz,
    slopeX: acc.slopeX,
    slopeZ: acc.slopeZ,
    compression: acc.compression,
  };
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
  const spectrumBounds = SPECTRUM_WAVES.reduce((sum, wave) => sum + Math.abs(wave.amp), 0);
  const swellBounds = RESOLVED_SWELLS.reduce((sum, swell) => sum + Math.abs(swell.amp), 0);
  return spectrumBounds + swellBounds + 1;
}

export function deepOceanSpectrumWaveCount(): number {
  return SPECTRUM_WAVES.length;
}
