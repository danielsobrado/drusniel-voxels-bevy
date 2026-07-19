import {
  environmentQuerySourceIndex,
  resolveEnvironmentSampleHint,
  type EnvironmentBatchInput,
  type EnvironmentBatchOutput,
  type EnvironmentBatchSampler,
  type ResolvedEnvironmentBatchOptions,
} from "./batch.js";
import { ENVIRONMENT_QUERY_FIELD } from "./constants.js";
import type {
  EnvironmentQuery,
  EnvironmentQueryMeta,
  MaterialWeightsResult,
  NormalQueryResult,
  RiverQueryResult,
  SurfaceQueryResult,
  VisibilityQueryResult,
  WaterQueryResult,
} from "./types.js";

const TERRAIN_SOURCE = "live-terrain" as const;
const TERRAIN_SOURCE_INDEX = environmentQuerySourceIndex(TERRAIN_SOURCE);
const TERRAIN_FIELDS = ENVIRONMENT_QUERY_FIELD.surface
  | ENVIRONMENT_QUERY_FIELD.normal
  | ENVIRONMENT_QUERY_FIELD.material;

export interface TerrainEnvironmentSample {
  readonly height: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly grass: number;
  readonly rock: number;
  readonly sand: number;
  readonly snow: number;
  readonly valid: boolean;
  readonly revision: number;
}

export interface TerrainEnvironmentAuthority {
  sample(x: number, z: number, hintM: number): TerrainEnvironmentSample;
  revision?(): number;
}

export interface TerrainEnvironmentQueryOptions {
  readonly base: EnvironmentQuery & EnvironmentBatchSampler;
  readonly terrain: TerrainEnvironmentAuthority;
}

interface CachedTerrainSample {
  readonly x: number;
  readonly z: number;
  readonly hintM: number;
  readonly authorityRevision: number;
  readonly sample: TerrainEnvironmentSample;
}

export class TerrainEnvironmentQuery implements EnvironmentQuery, EnvironmentBatchSampler {
  private readonly base: EnvironmentQuery & EnvironmentBatchSampler;
  private readonly terrain: TerrainEnvironmentAuthority;
  private cached: CachedTerrainSample | null = null;

  constructor(options: TerrainEnvironmentQueryOptions) {
    this.base = options.base;
    this.terrain = options.terrain;
  }

  surfaceHeightBestEffort(x: number, z: number, hintM?: number): SurfaceQueryResult {
    const hint = resolveEnvironmentSampleHint(hintM);
    const sample = this.sampleTerrain(x, z, hint);
    const valid = sample.valid && Number.isFinite(sample.height);
    return {
      height: valid ? sample.height : null,
      meta: terrainMeta(sample, hint, valid),
    };
  }

  surfaceNormal(x: number, z: number, hintM?: number): NormalQueryResult {
    const hint = resolveEnvironmentSampleHint(hintM);
    const sample = this.sampleTerrain(x, z, hint);
    const normal = normalizedNormal(sample);
    return {
      x: normal.x,
      y: normal.y,
      z: normal.z,
      meta: terrainMeta(sample, hint, normal.valid),
    };
  }

  materialWeights(x: number, z: number, hintM?: number): MaterialWeightsResult {
    const hint = resolveEnvironmentSampleHint(hintM);
    const sample = this.sampleTerrain(x, z, hint);
    const weights = normalizedWeights(sample);
    return {
      grass: weights.grass,
      rock: weights.rock,
      sand: weights.sand,
      snow: weights.snow,
      meta: terrainMeta(sample, hint, weights.valid),
    };
  }

  water(x: number, z: number, hintM?: number): WaterQueryResult {
    return this.base.water(x, z, hintM);
  }

  river(x: number, z: number, hintM?: number): RiverQueryResult {
    return this.base.river(x, z, hintM);
  }

  visibility(x: number, z: number, hintM?: number): VisibilityQueryResult {
    return this.base.visibility(x, z, hintM);
  }

  sampleBatch(
    input: EnvironmentBatchInput,
    output: EnvironmentBatchOutput,
    options: ResolvedEnvironmentBatchOptions,
  ): void {
    const terrainMask = options.fieldMask & TERRAIN_FIELDS;
    const baseMask = options.fieldMask & ~TERRAIN_FIELDS;
    if (baseMask !== 0) this.base.sampleBatch(input, output, { ...options, fieldMask: baseMask });
    if (terrainMask === 0) return;

    const offset = input.offset ?? 0;
    const stride = input.stride ?? 2;
    for (let index = 0; index < input.count; index += 1) {
      const positionIndex = offset + index * stride;
      const x = input.positionsXZ[positionIndex] ?? Number.NaN;
      const z = input.positionsXZ[positionIndex + 1] ?? Number.NaN;
      const sample = this.terrain.sample(x, z, options.sampleHintM);

      if ((terrainMask & ENVIRONMENT_QUERY_FIELD.surface) !== 0) {
        const valid = sample.valid && Number.isFinite(sample.height);
        output.surfaceHeight[index] = valid ? sample.height : Number.NaN;
        writeMeta(output.meta.surface, index, sample, options.sampleHintM, valid);
      }
      if ((terrainMask & ENVIRONMENT_QUERY_FIELD.normal) !== 0) {
        const normal = normalizedNormal(sample);
        const normalIndex = index * 3;
        output.normalXYZ[normalIndex] = normal.x;
        output.normalXYZ[normalIndex + 1] = normal.y;
        output.normalXYZ[normalIndex + 2] = normal.z;
        writeMeta(output.meta.normal, index, sample, options.sampleHintM, normal.valid);
      }
      if ((terrainMask & ENVIRONMENT_QUERY_FIELD.material) !== 0) {
        const weights = normalizedWeights(sample);
        const materialIndex = index * 4;
        output.materialWeights[materialIndex] = weights.grass;
        output.materialWeights[materialIndex + 1] = weights.rock;
        output.materialWeights[materialIndex + 2] = weights.sand;
        output.materialWeights[materialIndex + 3] = weights.snow;
        writeMeta(output.meta.material, index, sample, options.sampleHintM, weights.valid);
      }
    }
  }

  clearSampleCache(): void {
    this.cached = null;
  }

  private sampleTerrain(x: number, z: number, hintM: number): TerrainEnvironmentSample {
    const authorityRevision = this.authorityRevision();
    const cached = this.cached;
    if (
      cached
      && authorityRevision >= 0
      && cached.x === x
      && cached.z === z
      && cached.hintM === hintM
      && cached.authorityRevision === authorityRevision
    ) {
      return cached.sample;
    }

    const sample = this.terrain.sample(x, z, hintM);
    if (authorityRevision >= 0) {
      this.cached = { x, z, hintM, authorityRevision, sample };
    } else {
      this.cached = null;
    }
    return sample;
  }

  private authorityRevision(): number {
    const value = this.terrain.revision?.();
    return Number.isFinite(value) && (value as number) >= 0 ? Math.floor(value as number) : -1;
  }
}

function terrainMeta(
  sample: TerrainEnvironmentSample,
  hintM: number,
  valid = sample.valid,
): EnvironmentQueryMeta {
  return {
    source: TERRAIN_SOURCE,
    revision: nonNegativeInteger(sample.revision),
    valid,
    cellSizeM: hintM,
  };
}

function writeMeta(
  output: EnvironmentBatchOutput["meta"]["surface"],
  index: number,
  sample: TerrainEnvironmentSample,
  hintM: number,
  valid: boolean,
): void {
  output.source[index] = TERRAIN_SOURCE_INDEX;
  output.revision[index] = nonNegativeInteger(sample.revision);
  output.valid[index] = valid ? 1 : 0;
  output.cellSizeM[index] = hintM;
}

function normalizedNormal(sample: TerrainEnvironmentSample): {
  x: number;
  y: number;
  z: number;
  valid: boolean;
} {
  if (!sample.valid) return { x: 0, y: 1, z: 0, valid: false };
  const length = Math.hypot(sample.normalX, sample.normalY, sample.normalZ);
  if (!Number.isFinite(length) || length <= 1e-6) return { x: 0, y: 1, z: 0, valid: false };
  return {
    x: sample.normalX / length,
    y: sample.normalY / length,
    z: sample.normalZ / length,
    valid: true,
  };
}

function normalizedWeights(sample: TerrainEnvironmentSample): {
  grass: number;
  rock: number;
  sand: number;
  snow: number;
  valid: boolean;
} {
  if (!sample.valid) return { grass: 0, rock: 0, sand: 0, snow: 0, valid: false };
  const grass = nonNegative(sample.grass);
  const rock = nonNegative(sample.rock);
  const sand = nonNegative(sample.sand);
  const snow = nonNegative(sample.snow);
  const sum = grass + rock + sand + snow;
  if (!Number.isFinite(sum) || sum <= 1e-6) return { grass: 0, rock: 0, sand: 0, snow: 0, valid: false };
  return {
    grass: grass / sum,
    rock: rock / sum,
    sand: sand / sum,
    snow: snow / sum,
    valid: true,
  };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
