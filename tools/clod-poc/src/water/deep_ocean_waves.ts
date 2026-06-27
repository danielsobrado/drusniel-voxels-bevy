import {
  DEFAULT_BORDER_COAST_OCEAN_CONFIG,
  type DeepOceanWaveConfig,
} from "../terrain/border_coast_config.js";

interface GerstnerSwell {
  dx: number;
  dz: number;
  wavelength: number;
  steepness: number;
  speedScale: number;
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

export interface DeepOceanGpuWave {
  dirX: number;
  dirZ: number;
  k: number;
  omega: number;
  amp: number;
  phase: number;
  choppiness: number;
}

export interface DeepOceanWaveSample {
  height: number;
  offsetX: number;
  offsetZ: number;
  slopeX: number;
  slopeZ: number;
  compression: number;
  velocityX: number;
  velocityZ: number;
}

const TWO_PI = Math.PI * 2;
const SPECTRUM_SEED = 12345;
const DEFAULT_WAVE_CONFIG = DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean.wave;

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

function normalizeWaveConfig(config: DeepOceanWaveConfig = DEFAULT_WAVE_CONFIG): DeepOceanWaveConfig {
  return {
    gravity: Math.max(0.01, config.gravity),
    gridK: Math.max(2, Math.floor(config.gridK)),
    activeGpuWaves: Math.max(1, Math.floor(config.activeGpuWaves)),
    windSpeed: Math.max(0.01, config.windSpeed),
    windDirectionDeg: config.windDirectionDeg,
    heightScale: Math.max(0, config.heightScale),
    choppiness: Math.max(0, config.choppiness),
    coarsePatchM: Math.max(1, config.coarsePatchM),
    finePatchM: Math.max(1, config.finePatchM),
    foamThreshold: Math.max(0, config.foamThreshold),
    foamPower: Math.max(0, config.foamPower),
    foamIntensity: Math.max(0, config.foamIntensity),
    swellHeightScale: Math.max(0, config.swellHeightScale),
  };
}

function buildCascade(config: DeepOceanWaveConfig, cascade: 0 | 1, patchSize: number): SpectrumWave[] {
  const waves: SpectrumWave[] = [];
  const gridK = config.gridK;
  const dk = TWO_PI / patchSize;
  const windSpeed = Math.max(0.5, config.windSpeed);
  const windDirectionRad = (config.windDirectionDeg * Math.PI) / 180;
  const fetchLength = (windSpeed * windSpeed) / config.gravity;
  const omegaPeak = (config.gravity * 0.87) / windSpeed;

  for (let iz = 0; iz < gridK; iz++) {
    for (let ix = 0; ix < gridK; ix++) {
      const nx = ix - gridK / 2;
      const nz = iz - gridK / 2;
      if (Math.abs(nx) < 0.5 && Math.abs(nz) < 0.5) continue;

      const kx = nx * dk;
      const kz = nz * dk;
      const k = Math.max(0.0001, Math.hypot(kx, kz));
      const omega = Math.sqrt(config.gravity * k);
      const dx = kx / k;
      const dz = kz / k;
      const kFetch = k * fetchLength;
      const k4 = k * k * k * k;
      const phillips = (0.01 / k4) * Math.exp(-1 / Math.max(1e-6, kFetch * kFetch));
      const sigma = omega <= omegaPeak ? 0.07 : 0.09;
      const ratio = (omega - omegaPeak) / Math.max(1e-6, sigma * omegaPeak);
      const jonswap = Math.pow(3.3, Math.exp(-0.5 * ratio * ratio));
      const waveAngle = Math.atan2(kz, kx);
      const directional = Math.pow(Math.max(Math.cos(waveAngle - windDirectionRad), 0), 2);
      const suppress = Math.exp(k * k * -0.0001);
      const spectrum = phillips * jonswap * directional * suppress;
      const amp = Math.sqrt(Math.max(0, spectrum)) * dk * config.heightScale;
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

function resolveSwellWaves(config: DeepOceanWaveConfig): DeepOceanGpuWave[] {
  return SWELLS.map((swell) => {
    const length = Math.hypot(swell.dx, swell.dz) || 1;
    const dirX = swell.dx / length;
    const dirZ = swell.dz / length;
    const k = TWO_PI / Math.max(1, swell.wavelength);
    const omega = Math.sqrt(config.gravity * k) * swell.speedScale;
    return {
      dirX,
      dirZ,
      k,
      omega,
      amp: (swell.steepness / k) * config.swellHeightScale,
      phase: 0,
      choppiness: config.choppiness,
    };
  });
}

function zeroWave(): DeepOceanGpuWave {
  return { dirX: 1, dirZ: 0, k: 1, omega: 0, amp: 0, phase: 0, choppiness: 0 };
}

function buildGpuWaves(configInput: DeepOceanWaveConfig = DEFAULT_WAVE_CONFIG): DeepOceanGpuWave[] {
  const config = normalizeWaveConfig(configInput);
  const spectrum = [
    ...buildCascade(config, 0, config.coarsePatchM),
    ...buildCascade(config, 1, config.finePatchM),
  ]
    .sort((a, b) => b.amp - a.amp)
    .slice(0, config.activeGpuWaves)
    .map((wave): DeepOceanGpuWave => ({
      dirX: wave.dx,
      dirZ: wave.dz,
      k: wave.k,
      omega: wave.omega,
      amp: wave.amp,
      phase: wave.phase,
      choppiness: config.choppiness,
    }));

  return [...spectrum, ...resolveSwellWaves(config)];
}

const DEFAULT_GPU_WAVES = Object.freeze(buildGpuWaves(DEFAULT_WAVE_CONFIG));
const DEFAULT_GPU_WAVE_COUNT = DEFAULT_GPU_WAVES.length;

function fitDefaultWaveCount(waves: DeepOceanGpuWave[]): readonly DeepOceanGpuWave[] {
  if (waves.length > DEFAULT_GPU_WAVE_COUNT) return Object.freeze(waves.slice(0, DEFAULT_GPU_WAVE_COUNT));
  if (waves.length < DEFAULT_GPU_WAVE_COUNT) {
    return Object.freeze([
      ...waves,
      ...Array.from({ length: DEFAULT_GPU_WAVE_COUNT - waves.length }, zeroWave),
    ]);
  }
  return Object.freeze(waves);
}

/** Live binding used by the WebGL and WebGPU ocean materials. */
export let DEEP_OCEAN_GPU_WAVES: readonly DeepOceanGpuWave[] = DEFAULT_GPU_WAVES;

export function deepOceanGpuWaves(config?: DeepOceanWaveConfig): readonly DeepOceanGpuWave[] {
  return fitDefaultWaveCount(buildGpuWaves(config ?? DEFAULT_WAVE_CONFIG));
}

export function configureDeepOceanWaves(config?: DeepOceanWaveConfig): readonly DeepOceanGpuWave[] {
  DEEP_OCEAN_GPU_WAVES = deepOceanGpuWaves(config);
  return DEEP_OCEAN_GPU_WAVES;
}

export function sampleDeepOceanWave(
  x: number,
  z: number,
  timeSeconds: number,
  waves: readonly DeepOceanGpuWave[] = DEEP_OCEAN_GPU_WAVES,
): DeepOceanWaveSample {
  let offsetX = 0;
  let offsetZ = 0;
  let height = 0;
  let slopeX = 0;
  let slopeZ = 0;
  let jxx = 0;
  let jzz = 0;
  let jxz = 0;
  let velocityX = 0;
  let velocityZ = 0;

  for (const wave of waves) {
    const theta = wave.k * (wave.dirX * x + wave.dirZ * z) - wave.omega * timeSeconds + wave.phase;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    offsetX -= wave.amp * wave.dirX * s * wave.choppiness;
    offsetZ -= wave.amp * wave.dirZ * s * wave.choppiness;
    height += wave.amp * c;
    slopeX -= wave.amp * wave.k * wave.dirX * s;
    slopeZ -= wave.amp * wave.k * wave.dirZ * s;
    jxx -= wave.amp * wave.k * wave.dirX * wave.dirX * c * wave.choppiness;
    jzz -= wave.amp * wave.k * wave.dirZ * wave.dirZ * c * wave.choppiness;
    jxz -= wave.amp * wave.k * wave.dirX * wave.dirZ * c * wave.choppiness;
    velocityX += wave.amp * wave.dirX * wave.omega * c * wave.choppiness;
    velocityZ += wave.amp * wave.dirZ * wave.omega * c * wave.choppiness;
  }

  const jacobian = (1 + jxx) * (1 + jzz) - jxz * jxz;
  return {
    height,
    offsetX,
    offsetZ,
    slopeX,
    slopeZ,
    compression: Math.min(1, Math.max(0, (0.58 - jacobian) / 0.58)),
    velocityX,
    velocityZ,
  };
}

export function sampleDeepOceanNormal(
  x: number,
  z: number,
  timeSeconds: number,
  waves: readonly DeepOceanGpuWave[] = DEEP_OCEAN_GPU_WAVES,
): readonly [number, number, number] {
  const wave = sampleDeepOceanWave(x, z, timeSeconds, waves);
  const nx = -wave.slopeX;
  const ny = 1;
  const nz = -wave.slopeZ;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len] as const;
}

export function deepOceanWaveVerticalBounds(waves: readonly DeepOceanGpuWave[] = DEEP_OCEAN_GPU_WAVES): number {
  return waves.reduce((sum, wave) => sum + Math.abs(wave.amp), 0) + 1;
}

export function deepOceanSpectrumWaveCount(waves: readonly DeepOceanGpuWave[] = DEEP_OCEAN_GPU_WAVES): number {
  return waves.length;
}
