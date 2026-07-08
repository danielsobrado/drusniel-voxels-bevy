import type { FarHeightProvider } from "../../far-summary/clipmap-sampler.js";
import type { FarHeightProviderSample } from "../../far-summary/clipmap-sampler.js";
import type { FarTerrainSampler } from "../../far-summary/summary-tile-builder.js";

export interface FarClipmapSource {
  sampleHeight(x: number, z: number): number;
  sampleMaterial(x: number, z: number): number;
  sampleBiome(x: number, z: number): number;
  sampleWater(x: number, z: number): number;
  sampleSummaryInto?(x: number, z: number, distanceM: number, out: FarHeightProviderSample): boolean;
  isReady?: () => boolean;
  revision?: () => number;
}

type FarHeightProviderWithWater = FarHeightProvider & {
  sampleWaterCoverage?: (x: number, z: number) => number;
};

type FarHeightProviderWithRevision = FarHeightProviderWithWater & {
  revision?: () => number;
  revisionAt?: () => number;
  stateRevisionAt?: () => number;
  commitRevisionAt?: () => number;
};

type GlobalFarSummaryProvider = {
  getHeightProvider: () => FarHeightProvider | undefined;
};

function providerWater(provider: FarHeightProvider | undefined, x: number, z: number): number {
  return (provider as FarHeightProviderWithWater | undefined)?.sampleWaterCoverage?.(x, z) ?? 0;
}

function providerRevision(provider: FarHeightProvider | undefined): number {
  const withRevision = provider as FarHeightProviderWithRevision | undefined;
  return withRevision?.revision?.()
    ?? withRevision?.revisionAt?.()
    ?? withRevision?.stateRevisionAt?.()
    ?? withRevision?.commitRevisionAt?.()
    ?? 0;
}

function globalFarSummaryProvider(): FarHeightProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { __drusnielFarSummary?: GlobalFarSummaryProvider })
    .__drusnielFarSummary
    ?.getHeightProvider();
}

export function createFarClipmapSourceFromFarHeightProvider(provider: FarHeightProvider): FarClipmapSource {
  return {
    sampleHeight: (x, z) => provider.sampleHeight(x, z),
    sampleMaterial: (x, z) => provider.sampleMaterial?.(x, z) ?? 0,
    sampleBiome: (x, z) => provider.sampleMaterial?.(x, z) ?? 0,
    sampleWater: (x, z) => providerWater(provider, x, z),
    sampleSummaryInto: provider.sampleSummaryInto?.bind(provider),
    isReady: () => true,
    revision: () => providerRevision(provider),
  };
}

export function createFarClipmapSourceFromProviderGetter(
  getProvider: () => FarHeightProvider | undefined,
  fallbackHeightM = 0,
): FarClipmapSource {
  return {
    sampleHeight: (x, z) => getProvider()?.sampleHeight(x, z) ?? fallbackHeightM,
    sampleMaterial: (x, z) => getProvider()?.sampleMaterial?.(x, z) ?? 0,
    sampleBiome: (x, z) => getProvider()?.sampleMaterial?.(x, z) ?? 0,
    sampleWater: (x, z) => providerWater(getProvider(), x, z),
    sampleSummaryInto: (x, z, distanceM, out) => getProvider()?.sampleSummaryInto?.(x, z, distanceM, out) ?? false,
    isReady: () => getProvider() !== undefined,
    revision: () => providerRevision(getProvider()),
  };
}

export function createDefaultFarClipmapSource(fallbackHeightM = 0): FarClipmapSource {
  return createFarClipmapSourceFromProviderGetter(globalFarSummaryProvider, fallbackHeightM);
}

export function createFarClipmapSourceFromTerrainSampler(sampler: FarTerrainSampler): FarClipmapSource {
  return {
    sampleHeight: (x, z) => sampler.sampleHeight(x, z),
    sampleMaterial: (x, z) => sampler.sampleMaterial?.(x, z) ?? 0,
    sampleBiome: (x, z) => sampler.sampleMaterial?.(x, z) ?? 0,
    sampleWater: (x, z) => sampler.sampleWaterCoverage?.(x, z) ?? 0,
    isReady: () => true,
    revision: () => 0,
  };
}

export function createConservativeFarClipmapSource(heightM = 0): FarClipmapSource {
  return {
    sampleHeight: () => heightM,
    sampleMaterial: () => 0,
    sampleBiome: () => 0,
    sampleWater: () => 1,
    isReady: () => true,
    revision: () => 0,
  };
}
