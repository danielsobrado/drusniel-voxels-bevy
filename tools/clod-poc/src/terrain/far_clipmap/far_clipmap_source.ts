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
  revisionIsAuthoritative?: () => boolean;
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
  stats?: { requestedTiles: number; readyTiles: number };
};

let latchedIntegration: GlobalFarSummaryProvider | undefined;
let latchedCoherentProvider: FarHeightProvider | undefined;

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

export function getGlobalCoherentFarSummaryProvider(): FarHeightProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const integration = (window as typeof window & { __drusnielFarSummary?: GlobalFarSummaryProvider })
    .__drusnielFarSummary;
  if (integration !== latchedIntegration) {
    latchedIntegration = integration;
    latchedCoherentProvider = undefined;
  }
  const stats = integration?.stats;
  if (!stats) return integration?.getHeightProvider();
  if (stats.requestedTiles > 0 && stats.readyTiles >= stats.requestedTiles) {
    latchedCoherentProvider = integration?.getHeightProvider();
  }
  // Once coherent, keep the cache-backed provider live while a recenter/invalidation batch is
  // filling. The cache retains stale resident tiles until replacements commit, so dropping the
  // provider here would incorrectly make the clipmap fail its source-ready gate every batch.
  return latchedCoherentProvider;
}

function providerHasRevision(provider: FarHeightProvider | undefined): boolean {
  const withRevision = provider as FarHeightProviderWithRevision | undefined;
  return typeof withRevision?.revision === "function"
    || typeof withRevision?.revisionAt === "function"
    || typeof withRevision?.stateRevisionAt === "function"
    || typeof withRevision?.commitRevisionAt === "function";
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
    revisionIsAuthoritative: () => providerHasRevision(provider),
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
    revisionIsAuthoritative: () => providerHasRevision(getProvider()),
  };
}

export function createDefaultFarClipmapSource(fallbackHeightM = 0): FarClipmapSource {
  return createFarClipmapSourceFromProviderGetter(getGlobalCoherentFarSummaryProvider, fallbackHeightM);
}

export function createFarClipmapSourceFromTerrainSampler(sampler: FarTerrainSampler): FarClipmapSource {
  return {
    sampleHeight: (x, z) => sampler.sampleHeight(x, z),
    sampleMaterial: (x, z) => sampler.sampleMaterial?.(x, z) ?? 0,
    sampleBiome: (x, z) => sampler.sampleMaterial?.(x, z) ?? 0,
    sampleWater: (x, z) => sampler.sampleWaterCoverage?.(x, z) ?? 0,
    isReady: () => true,
    revision: () => 0,
    revisionIsAuthoritative: () => true,
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
    revisionIsAuthoritative: () => true,
  };
}
