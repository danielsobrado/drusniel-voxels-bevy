import type { DressingEnvironmentSample, VegetationSurfaceSample } from "./types.js";

export interface DressingEnvironmentProviders {
  readonly sampleSurface: (x: number, z: number) => VegetationSurfaceSample;
  readonly sampleForestEdge: (x: number, z: number) => number;
  readonly sampleSunExposure: (x: number, z: number) => number;
  readonly sampleCaveMouthFactor: (x: number, z: number) => number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function sampleDressingEnvironment(
  x: number,
  z: number,
  providers: DressingEnvironmentProviders,
): DressingEnvironmentSample {
  const surface = providers.sampleSurface(x, z);
  return {
    ...surface,
    forestEdge: clamp01(providers.sampleForestEdge(x, z)),
    sunExposure: clamp01(providers.sampleSunExposure(x, z)),
    caveMouthFactor: clamp01(providers.sampleCaveMouthFactor(x, z)),
  };
}
