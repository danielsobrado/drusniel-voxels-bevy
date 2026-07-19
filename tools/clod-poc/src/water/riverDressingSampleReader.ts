import { readActiveEnvironmentQuery } from "../environment_query/runtime.js";
import type {
  EnvironmentQuery,
  NormalQueryResult,
  RiverQueryResult,
  SurfaceQueryResult,
  WaterQueryResult,
} from "../environment_query/types.js";
import type { WaterField, WaterFieldResult } from "./waterField.js";

export const DEFAULT_RIVER_DRESSING_SAMPLE_HINT_M = 16;

export interface RiverWaterSample {
  readonly waterY: number;
  readonly terrainY: number;
  readonly depth: number;
  readonly wetMask: number;
  readonly bodyKind: number;
  readonly shoreDistanceM: number;
}

export interface RiverDressingSample extends RiverWaterSample {
  readonly flowX: number;
  readonly flowZ: number;
  readonly flowStrength: number;
  readonly bedDrop: number;
}

export interface RiverDressingSamplingStats {
  readonly environmentSamples: number;
  readonly fallbackSamples: number;
  readonly invalidSamples: number;
}

export interface RiverDressingSampleReaderOptions {
  readonly sampleHintM?: number;
  readonly readEnvironmentQuery?: () => EnvironmentQuery | null;
}

export class RiverDressingSampleReader {
  readonly sampleHintM: number;

  private readonly readEnvironmentQuery: () => EnvironmentQuery | null;
  private environmentSamples = 0;
  private fallbackSamples = 0;
  private invalidSamples = 0;

  constructor(
    private readonly field: WaterField,
    options: RiverDressingSampleReaderOptions = {},
  ) {
    this.sampleHintM = Math.max(
      DEFAULT_RIVER_DRESSING_SAMPLE_HINT_M,
      finiteNonNegative(options.sampleHintM),
    );
    this.readEnvironmentQuery = options.readEnvironmentQuery ?? readActiveEnvironmentQuery;
  }

  sampleRiver(x: number, z: number): RiverDressingSample | null {
    const query = this.readEnvironmentQuery();
    if (query) {
      this.environmentSamples += 1;
      const sample = riverDressingSampleFromEnvironment(
        query.water(x, z, this.sampleHintM),
        query.river(x, z, this.sampleHintM),
      );
      if (!sample) this.invalidSamples += 1;
      return sample;
    }

    this.fallbackSamples += 1;
    return riverDressingSampleFromWaterField(this.sampleField(x, z));
  }

  sampleWater(x: number, z: number): RiverWaterSample | null {
    const query = this.readEnvironmentQuery();
    if (query) {
      this.environmentSamples += 1;
      const sample = riverWaterSampleFromEnvironment(query.water(x, z, this.sampleHintM));
      if (!sample) this.invalidSamples += 1;
      return sample;
    }

    this.fallbackSamples += 1;
    return riverWaterSampleFromWaterField(this.sampleField(x, z));
  }

  surfaceHeight(x: number, z: number): number | null {
    const query = this.readEnvironmentQuery();
    if (query) {
      this.environmentSamples += 1;
      const height = surfaceHeightFromEnvironment(
        query.surfaceHeightBestEffort(x, z, this.sampleHintM),
      );
      if (height === null) this.invalidSamples += 1;
      return height;
    }

    this.fallbackSamples += 1;
    const height = this.sampleField(x, z).terrainY;
    if (!Number.isFinite(height)) {
      this.invalidSamples += 1;
      return null;
    }
    return height;
  }

  surfaceNormalY(x: number, z: number, stepM: number): number | null {
    const query = this.readEnvironmentQuery();
    if (query) {
      this.environmentSamples += 1;
      const normalY = normalYFromEnvironment(query.surfaceNormal(x, z, this.sampleHintM));
      if (normalY === null) this.invalidSamples += 1;
      return normalY;
    }

    this.fallbackSamples += 1;
    const step = Math.max(0.01, finiteNonNegative(stepM));
    const hL = this.sampleField(x - step, z).terrainY;
    const hR = this.sampleField(x + step, z).terrainY;
    const hD = this.sampleField(x, z - step).terrainY;
    const hU = this.sampleField(x, z + step).terrainY;
    const normalY = normalizedY(hL - hR, step * 2, hD - hU);
    if (normalY === null) this.invalidSamples += 1;
    return normalY;
  }

  getStats(): RiverDressingSamplingStats {
    return {
      environmentSamples: this.environmentSamples,
      fallbackSamples: this.fallbackSamples,
      invalidSamples: this.invalidSamples,
    };
  }

  private sampleField(x: number, z: number): WaterFieldResult {
    return typeof this.field.sampleForCellSize === "function"
      ? this.field.sampleForCellSize(x, z, this.sampleHintM)
      : this.field.sample(x, z);
  }
}

export function riverDressingSampleFromEnvironment(
  water: WaterQueryResult,
  river: RiverQueryResult,
): RiverDressingSample | null {
  const base = riverWaterSampleFromEnvironment(water);
  if (!base || !river.meta.valid) return null;
  const sample: RiverDressingSample = {
    ...base,
    flowX: river.flowX,
    flowZ: river.flowZ,
    flowStrength: river.flowStrength,
    bedDrop: river.bedDrop,
  };
  return validRiverDressingSample(sample) ? sample : null;
}

export function riverDressingSampleFromWaterField(sample: WaterFieldResult): RiverDressingSample {
  return {
    ...riverWaterSampleFromWaterField(sample),
    flowX: finiteOrZero(sample.flow.x),
    flowZ: finiteOrZero(sample.flow.z),
    flowStrength: finiteNonNegative(sample.flow.speed),
    bedDrop: finiteNonNegative(sample.flow.drop),
  };
}

export function riverWaterSampleFromEnvironment(water: WaterQueryResult): RiverWaterSample | null {
  if (!water.meta.valid) return null;
  const sample: RiverWaterSample = {
    waterY: water.waterY,
    terrainY: water.carvedBedY,
    depth: water.depth,
    wetMask: water.wetMask,
    bodyKind: water.bodyKind,
    shoreDistanceM: water.shoreDistanceM,
  };
  return validRiverWaterSample(sample) ? sample : null;
}

export function riverWaterSampleFromWaterField(sample: WaterFieldResult): RiverWaterSample {
  return {
    waterY: finiteOrZero(sample.waterY),
    terrainY: finiteOrZero(sample.terrainY),
    depth: finiteOrZero(sample.depth),
    wetMask: finiteNonNegative(sample.bodyMask),
    bodyKind: nonNegativeIntegerOrZero(sample.bodyKind),
    shoreDistanceM: finiteOrZero(sample.shoreDistance),
  };
}

function surfaceHeightFromEnvironment(surface: SurfaceQueryResult): number | null {
  return surface.meta.valid && surface.height !== null && Number.isFinite(surface.height)
    ? surface.height
    : null;
}

function normalYFromEnvironment(normal: NormalQueryResult): number | null {
  if (!normal.meta.valid) return null;
  return normalizedY(normal.x, normal.y, normal.z);
}

function normalizedY(x: number, y: number, z: number): number | null {
  if (![x, y, z].every(Number.isFinite)) return null;
  const length = Math.hypot(x, y, z);
  return length > 1e-6 ? y / length : null;
}

function validRiverWaterSample(sample: RiverWaterSample): boolean {
  return Number.isFinite(sample.waterY)
    && Number.isFinite(sample.terrainY)
    && Number.isFinite(sample.depth)
    && Number.isFinite(sample.wetMask)
    && Number.isFinite(sample.bodyKind)
    && Number.isFinite(sample.shoreDistanceM);
}

function validRiverDressingSample(sample: RiverDressingSample): boolean {
  return validRiverWaterSample(sample)
    && Number.isFinite(sample.flowX)
    && Number.isFinite(sample.flowZ)
    && Number.isFinite(sample.flowStrength)
    && Number.isFinite(sample.bedDrop);
}

function finiteOrZero(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0;
}

function finiteNonNegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value!) : 0;
}

function nonNegativeIntegerOrZero(value: number | undefined): number {
  return Number.isFinite(value) && value! >= 0 ? Math.floor(value!) : 0;
}
