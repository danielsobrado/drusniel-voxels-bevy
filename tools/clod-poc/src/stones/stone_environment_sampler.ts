import { readActiveEnvironmentQuery } from "../environment_query/runtime.js";
import type { EnvironmentQuery } from "../environment_query/types.js";
import { surfaceHeight, surfaceNormal, terrainWeights, WATER_LEVEL } from "../terrain/terrain.js";
import type { StoneSettings } from "./stone_config.js";

export const DEFAULT_STONE_CPU_SAMPLE_HINT_M = 16;

const WET_MASK_MIN = 0.05;

export interface StoneEnvironmentSample {
  readonly height: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly grass: number;
  readonly rock: number;
  readonly sand: number;
  readonly snow: number;
  readonly standingWater: boolean;
}

export interface StoneEnvironmentSamplingStats {
  readonly environmentSamples: number;
  readonly fallbackSamples: number;
  readonly invalidSamples: number;
}

export interface StoneEnvironmentSource {
  sampleSite(x: number, z: number, settings: StoneSettings): StoneEnvironmentSample | null;
  sampleHeight(x: number, z: number): number | null;
}

export interface LegacyStoneEnvironmentAuthority {
  surfaceHeight(x: number, z: number): number;
  surfaceNormal(x: number, z: number): readonly [number, number, number];
  terrainWeights(height: number, normalY: number): readonly [number, number, number, number];
  readonly waterLevel: number;
}

export interface StoneEnvironmentSamplerOptions {
  readonly sampleHintM?: number;
  readonly readEnvironmentQuery?: () => EnvironmentQuery | null;
  readonly legacy?: LegacyStoneEnvironmentAuthority;
}

export class StoneEnvironmentSampler implements StoneEnvironmentSource {
  readonly sampleHintM: number;

  private readonly readEnvironmentQuery: () => EnvironmentQuery | null;
  private readonly legacy: LegacyStoneEnvironmentAuthority;
  private environmentSamples = 0;
  private fallbackSamples = 0;
  private invalidSamples = 0;

  constructor(options: StoneEnvironmentSamplerOptions = {}) {
    this.sampleHintM = Math.max(
      DEFAULT_STONE_CPU_SAMPLE_HINT_M,
      finiteNonNegative(options.sampleHintM),
    );
    this.readEnvironmentQuery = options.readEnvironmentQuery ?? readActiveEnvironmentQuery;
    this.legacy = options.legacy ?? DEFAULT_LEGACY_AUTHORITY;
  }

  sampleSite(x: number, z: number, settings: StoneSettings): StoneEnvironmentSample | null {
    const query = this.readEnvironmentQuery();
    if (query) {
      this.environmentSamples += 1;
      const sample = sampleSiteFromEnvironmentQuery(query, x, z, settings, this.sampleHintM);
      if (!sample) this.invalidSamples += 1;
      return sample;
    }

    this.fallbackSamples += 1;
    const sample = sampleSiteFromLegacy(this.legacy, x, z, settings);
    if (!sample) this.invalidSamples += 1;
    return sample;
  }

  sampleHeight(x: number, z: number): number | null {
    const query = this.readEnvironmentQuery();
    if (query) {
      this.environmentSamples += 1;
      const result = query.surfaceHeightBestEffort(x, z, this.sampleHintM);
      const height = result.meta.valid && result.height !== null && Number.isFinite(result.height)
        ? result.height
        : null;
      if (height === null) this.invalidSamples += 1;
      return height;
    }

    this.fallbackSamples += 1;
    const height = this.legacy.surfaceHeight(x, z);
    if (!Number.isFinite(height)) {
      this.invalidSamples += 1;
      return null;
    }
    return height;
  }

  getStats(): StoneEnvironmentSamplingStats {
    return {
      environmentSamples: this.environmentSamples,
      fallbackSamples: this.fallbackSamples,
      invalidSamples: this.invalidSamples,
    };
  }
}

function sampleSiteFromEnvironmentQuery(
  query: EnvironmentQuery,
  x: number,
  z: number,
  settings: StoneSettings,
  sampleHintM: number,
): StoneEnvironmentSample | null {
  const surface = query.surfaceHeightBestEffort(x, z, sampleHintM);
  const normal = query.surfaceNormal(x, z, sampleHintM);
  const material = query.materialWeights(x, z, sampleHintM);
  const water = query.water(x, z, sampleHintM);
  if (
    !surface.meta.valid
    || surface.height === null
    || !normal.meta.valid
    || !material.meta.valid
    || !water.meta.valid
  ) return null;

  const height = surface.height;
  const normalLength = Math.hypot(normal.x, normal.y, normal.z);
  if (!Number.isFinite(height) || !Number.isFinite(normalLength) || normalLength <= 1e-6) return null;
  const weights = [material.grass, material.rock, material.sand, material.snow] as const;
  if (!weights.every(Number.isFinite)) return null;

  return {
    height,
    normalX: normal.x / normalLength,
    normalY: normal.y / normalLength,
    normalZ: normal.z / normalLength,
    grass: nonNegative(material.grass),
    rock: nonNegative(material.rock),
    sand: nonNegative(material.sand),
    snow: nonNegative(material.snow),
    standingWater: nonNegative(water.wetMask) > WET_MASK_MIN
      && height < water.waterY + settings.waterMarginM + settings.standingWaterCutoffM,
  };
}

function sampleSiteFromLegacy(
  authority: LegacyStoneEnvironmentAuthority,
  x: number,
  z: number,
  settings: StoneSettings,
): StoneEnvironmentSample | null {
  const height = authority.surfaceHeight(x, z);
  const normal = authority.surfaceNormal(x, z);
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
  if (!Number.isFinite(height) || !Number.isFinite(normalLength) || normalLength <= 1e-6) return null;

  const normalX = normal[0] / normalLength;
  const normalY = normal[1] / normalLength;
  const normalZ = normal[2] / normalLength;
  const weights = authority.terrainWeights(height, normalY);
  if (!weights.every(Number.isFinite)) return null;

  return {
    height,
    normalX,
    normalY,
    normalZ,
    grass: nonNegative(weights[0]),
    rock: nonNegative(weights[1]),
    sand: nonNegative(weights[2]),
    snow: nonNegative(weights[3]),
    standingWater: height
      < authority.waterLevel + settings.waterMarginM + settings.standingWaterCutoffM,
  };
}

const DEFAULT_LEGACY_AUTHORITY: LegacyStoneEnvironmentAuthority = {
  surfaceHeight,
  surfaceNormal,
  terrainWeights,
  waterLevel: WATER_LEVEL,
};

function finiteNonNegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
