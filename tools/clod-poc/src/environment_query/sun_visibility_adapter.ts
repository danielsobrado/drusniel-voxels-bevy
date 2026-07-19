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
  MaterialWeightsResult,
  NormalQueryResult,
  RiverQueryResult,
  SurfaceQueryResult,
  VisibilityQueryResult,
  WaterQueryResult,
} from "./types.js";
import {
  sampleSunLightGpuAtlas,
  type SunLightGpuAtlasSample,
} from "../terrain/sun_visibility/sun_light_gpu_atlas.js";

const SUN_VISIBILITY_SOURCE = "sun-visibility-cache" as const;
const SUN_VISIBILITY_SOURCE_INDEX = environmentQuerySourceIndex(SUN_VISIBILITY_SOURCE);

export interface SunVisibilityEnvironmentAuthority {
  sample(x: number, z: number, hintM: number): SunLightGpuAtlasSample;
}

export interface SunVisibilityEnvironmentQueryOptions {
  readonly base: EnvironmentQuery & EnvironmentBatchSampler;
  readonly visibility?: SunVisibilityEnvironmentAuthority;
}

export class SunVisibilityEnvironmentQuery implements EnvironmentQuery, EnvironmentBatchSampler {
  private readonly base: EnvironmentQuery & EnvironmentBatchSampler;
  private readonly authority: SunVisibilityEnvironmentAuthority;

  constructor(options: SunVisibilityEnvironmentQueryOptions) {
    this.base = options.base;
    this.authority = options.visibility ?? { sample: (x, z) => sampleSunLightGpuAtlas(x, z) };
  }

  surfaceHeightBestEffort(x: number, z: number, hintM?: number): SurfaceQueryResult {
    return this.base.surfaceHeightBestEffort(x, z, hintM);
  }

  surfaceNormal(x: number, z: number, hintM?: number): NormalQueryResult {
    return this.base.surfaceNormal(x, z, hintM);
  }

  materialWeights(x: number, z: number, hintM?: number): MaterialWeightsResult {
    return this.base.materialWeights(x, z, hintM);
  }

  water(x: number, z: number, hintM?: number): WaterQueryResult {
    return this.base.water(x, z, hintM);
  }

  river(x: number, z: number, hintM?: number): RiverQueryResult {
    return this.base.river(x, z, hintM);
  }

  visibility(x: number, z: number, hintM?: number): VisibilityQueryResult {
    const hint = resolveEnvironmentSampleHint(hintM);
    const sample = this.authority.sample(x, z, hint);
    return {
      sunVisibility: sample.valid ? clamp01(sample.visibility) : 1,
      meta: {
        source: SUN_VISIBILITY_SOURCE,
        revision: nonNegativeInteger(sample.revision),
        valid: sample.valid,
        cellSizeM: positiveFiniteOr(sample.cellSizeM, hint),
      },
    };
  }

  sampleBatch(
    input: EnvironmentBatchInput,
    output: EnvironmentBatchOutput,
    options: ResolvedEnvironmentBatchOptions,
  ): void {
    const visibilityRequested = (options.fieldMask & ENVIRONMENT_QUERY_FIELD.visibility) !== 0;
    const baseFieldMask = options.fieldMask & ~ENVIRONMENT_QUERY_FIELD.visibility;
    if (baseFieldMask !== 0) {
      this.base.sampleBatch(input, output, { ...options, fieldMask: baseFieldMask });
    }
    if (!visibilityRequested) return;

    const offset = input.offset ?? 0;
    const stride = input.stride ?? 2;
    const meta = output.meta.visibility;
    for (let index = 0; index < input.count; index += 1) {
      const positionIndex = offset + index * stride;
      const x = input.positionsXZ[positionIndex] ?? Number.NaN;
      const z = input.positionsXZ[positionIndex + 1] ?? Number.NaN;
      const sample = this.authority.sample(x, z, options.sampleHintM);
      output.sunVisibility[index] = sample.valid ? clamp01(sample.visibility) : 1;
      meta.source[index] = SUN_VISIBILITY_SOURCE_INDEX;
      meta.revision[index] = nonNegativeInteger(sample.revision);
      meta.valid[index] = sample.valid ? 1 : 0;
      meta.cellSizeM[index] = positiveFiniteOr(sample.cellSizeM, options.sampleHintM);
    }
  }
}

function positiveFiniteOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}
