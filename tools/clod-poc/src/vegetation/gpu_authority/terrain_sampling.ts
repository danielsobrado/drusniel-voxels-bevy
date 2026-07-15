import { VEGETATION_SURFACE_VALIDITY } from "./constants.js";
import type { Vec2, VegetationSurfaceSample } from "./types.js";

export type VegetationSurfaceProvider = (
  positionXz: Vec2,
  current: VegetationSurfaceSample | null,
) => VegetationSurfaceSample | null | undefined;

export interface VegetationSurfaceProviders {
  readonly canonicalHeightfield?: VegetationSurfaceProvider;
  readonly voxelOverlay?: VegetationSurfaceProvider;
  readonly exclusions?: VegetationSurfaceProvider;
  readonly occupancy?: VegetationSurfaceProvider;
  readonly farSummary?: VegetationSurfaceProvider;
}

export function unknownVegetationSurfaceSample(positionXz: Vec2): VegetationSurfaceSample {
  return {
    positionWs: [positionXz[0], 0, positionXz[1]],
    normalWs: [0, 1, 0],
    materialWeights: [0, 0, 0, 0],
    waterDepthM: 0,
    shoreDistanceM: 0,
    wetness: 0,
    moisture: 0,
    sediment: 0,
    deposition: 0,
    hardness: 0,
    flow: [0, 0],
    canopyCoverage: 0,
    canopyHeightM: 0,
    caveCoverage: 0,
    structureCoverage: 0,
    validity: VEGETATION_SURFACE_VALIDITY.MISSING,
    flags: 0,
  };
}

function applyProvider(
  provider: VegetationSurfaceProvider | undefined,
  positionXz: Vec2,
  current: VegetationSurfaceSample | null,
): VegetationSurfaceSample | null {
  return provider?.(positionXz, current) ?? current;
}

export function resolveVegetationSurfaceSample(
  positionXz: Vec2,
  providers: VegetationSurfaceProviders,
): VegetationSurfaceSample {
  let sample: VegetationSurfaceSample | null = null;
  sample = applyProvider(providers.canonicalHeightfield, positionXz, sample);
  sample = applyProvider(providers.voxelOverlay, positionXz, sample);
  sample = applyProvider(providers.exclusions, positionXz, sample);
  sample = applyProvider(providers.occupancy, positionXz, sample);
  if (!sample || sample.validity < VEGETATION_SURFACE_VALIDITY.CANONICAL_HEIGHTFIELD) {
    sample = applyProvider(providers.farSummary, positionXz, sample);
  }
  return sample ?? unknownVegetationSurfaceSample(positionXz);
}
