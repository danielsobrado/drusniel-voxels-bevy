import {
  resolveEnvironmentSampleHint,
  type EnvironmentBatchInput,
  type EnvironmentBatchOutput,
  type EnvironmentBatchSampler,
  type ResolvedEnvironmentBatchOptions,
} from "./batch.js";
import { ENVIRONMENT_QUERY_FIELD } from "./constants.js";
import { EnvironmentQueryDiagnostics } from "./diagnostics.js";
import type {
  EnvironmentQuery,
  EnvironmentQueryField,
  EnvironmentQueryMeta,
  MaterialWeightsResult,
  NormalQueryResult,
  RiverQueryResult,
  SurfaceQueryResult,
  VisibilityQueryResult,
  WaterQueryResult,
} from "./types.js";
import type { HydrologySample } from "../water/hydrologyGrid.js";
import {
  createFallbackMeta,
  createHydrologyMeta,
  ENVIRONMENT_FALLBACK_SOURCE,
  hasEnvironmentField,
  HYDROLOGY_QUERY_SOURCE,
  hydrologyRiverResult,
  hydrologyWaterResult,
  isFiniteHydrologySample,
  writeBatchRiver,
  writeBatchWater,
  writeEnvironmentMeta,
} from "./hydrology_adapter_mapping.js";

export interface HydrologyEnvironmentAuthority {
  sample(x: number, z: number, cellSizeHint: number): HydrologySample;
  revision?(): number;
}

export interface HydrologyEnvironmentQueryOptions {
  readonly hydrology: HydrologyEnvironmentAuthority;
  readonly diagnostics?: EnvironmentQueryDiagnostics;
  readonly nowMs?: () => number;
}

interface CachedHydrologySample {
  readonly x: number;
  readonly z: number;
  readonly hintM: number;
  readonly revision: number;
  readonly sample: HydrologySample;
}

export class HydrologyEnvironmentQuery implements EnvironmentQuery, EnvironmentBatchSampler {
  readonly diagnostics: EnvironmentQueryDiagnostics;

  private readonly hydrology: HydrologyEnvironmentAuthority;
  private readonly nowMs: () => number;
  private cachedSample: CachedHydrologySample | null = null;

  constructor(options: HydrologyEnvironmentQueryOptions) {
    this.hydrology = options.hydrology;
    this.diagnostics = options.diagnostics ?? new EnvironmentQueryDiagnostics();
    this.nowMs = options.nowMs ?? defaultNowMs;
  }

  surfaceHeightBestEffort(x: number, z: number, hintM?: number): SurfaceQueryResult {
    const startedAt = this.nowMs();
    const hint = resolveEnvironmentSampleHint(hintM);
    const cached = this.sampleHydrology(x, z, hint);
    const valid = isFiniteHydrologySample(cached.sample);
    const result: SurfaceQueryResult = {
      height: valid ? cached.sample.terrainY : null,
      meta: createHydrologyMeta(cached.revision, valid, hint),
    };
    this.recordScalar("surface", result.meta, startedAt);
    return result;
  }

  surfaceNormal(_x: number, _z: number, hintM?: number): NormalQueryResult {
    const startedAt = this.nowMs();
    const meta = createFallbackMeta(resolveEnvironmentSampleHint(hintM));
    const result: NormalQueryResult = { x: 0, y: 1, z: 0, meta };
    this.recordScalar("normal", meta, startedAt);
    return result;
  }

  materialWeights(_x: number, _z: number, hintM?: number): MaterialWeightsResult {
    const startedAt = this.nowMs();
    const meta = createFallbackMeta(resolveEnvironmentSampleHint(hintM));
    const result: MaterialWeightsResult = { grass: 0, rock: 0, sand: 0, snow: 0, meta };
    this.recordScalar("material", meta, startedAt);
    return result;
  }

  water(x: number, z: number, hintM?: number): WaterQueryResult {
    const startedAt = this.nowMs();
    const hint = resolveEnvironmentSampleHint(hintM);
    const cached = this.sampleHydrology(x, z, hint);
    const result = hydrologyWaterResult(
      cached.sample,
      createHydrologyMeta(cached.revision, isFiniteHydrologySample(cached.sample), hint),
    );
    this.recordScalar("water", result.meta, startedAt);
    return result;
  }

  river(x: number, z: number, hintM?: number): RiverQueryResult {
    const startedAt = this.nowMs();
    const hint = resolveEnvironmentSampleHint(hintM);
    const cached = this.sampleHydrology(x, z, hint);
    const result = hydrologyRiverResult(
      cached.sample,
      createHydrologyMeta(cached.revision, isFiniteHydrologySample(cached.sample), hint),
    );
    this.recordScalar("river", result.meta, startedAt);
    return result;
  }

  visibility(_x: number, _z: number, hintM?: number): VisibilityQueryResult {
    const startedAt = this.nowMs();
    const meta = createFallbackMeta(resolveEnvironmentSampleHint(hintM));
    const result: VisibilityQueryResult = { sunVisibility: 1, meta };
    this.recordScalar("visibility", meta, startedAt);
    return result;
  }

  sampleBatch(
    input: EnvironmentBatchInput,
    output: EnvironmentBatchOutput,
    options: ResolvedEnvironmentBatchOptions,
  ): void {
    const startedAt = this.nowMs();
    const offset = input.offset ?? 0;
    const stride = input.stride ?? 2;
    const revision = this.revision();
    const hydrologyMeta = createHydrologyMeta(revision, true, options.sampleHintM);
    const fallbackMeta = createFallbackMeta(options.sampleHintM);
    const hydrologyRequested = hasEnvironmentField(options.fieldMask, ENVIRONMENT_QUERY_FIELD.surface)
      || hasEnvironmentField(options.fieldMask, ENVIRONMENT_QUERY_FIELD.water)
      || hasEnvironmentField(options.fieldMask, ENVIRONMENT_QUERY_FIELD.river);
    let validHydrologySamples = 0;

    for (let index = 0; index < input.count; index += 1) {
      const positionIndex = offset + index * stride;
      const x = input.positionsXZ[positionIndex] ?? 0;
      const z = input.positionsXZ[positionIndex + 1] ?? 0;
      const sample = hydrologyRequested
        ? this.hydrology.sample(x, z, options.sampleHintM)
        : null;
      const sampleValid = sample !== null && isFiniteHydrologySample(sample);
      if (sampleValid) validHydrologySamples += 1;
      const sampleMeta = sampleValid
        ? hydrologyMeta
        : createHydrologyMeta(revision, false, options.sampleHintM);

      if (hasEnvironmentField(options.fieldMask, ENVIRONMENT_QUERY_FIELD.surface)) {
        output.surfaceHeight[index] = sampleMeta.valid && sample ? sample.terrainY : Number.NaN;
        writeEnvironmentMeta(output.meta.surface, index, sampleMeta);
      }
      if (hasEnvironmentField(options.fieldMask, ENVIRONMENT_QUERY_FIELD.normal)) {
        const normalIndex = index * 3;
        output.normalXYZ[normalIndex] = 0;
        output.normalXYZ[normalIndex + 1] = 1;
        output.normalXYZ[normalIndex + 2] = 0;
        writeEnvironmentMeta(output.meta.normal, index, fallbackMeta);
      }
      if (hasEnvironmentField(options.fieldMask, ENVIRONMENT_QUERY_FIELD.material)) {
        const materialIndex = index * 4;
        output.materialWeights.fill(0, materialIndex, materialIndex + 4);
        writeEnvironmentMeta(output.meta.material, index, fallbackMeta);
      }
      if (hasEnvironmentField(options.fieldMask, ENVIRONMENT_QUERY_FIELD.water)) {
        writeBatchWater(output, index, sample, sampleMeta);
      }
      if (hasEnvironmentField(options.fieldMask, ENVIRONMENT_QUERY_FIELD.river)) {
        writeBatchRiver(output, index, sample, sampleMeta);
      }
      if (hasEnvironmentField(options.fieldMask, ENVIRONMENT_QUERY_FIELD.visibility)) {
        output.sunVisibility[index] = 1;
        writeEnvironmentMeta(output.meta.visibility, index, fallbackMeta);
      }
    }

    this.diagnostics.recordBatch(
      options.fieldMask,
      input.count,
      options.sampleHintM,
      elapsedMs(startedAt, this.nowMs()),
    );
    this.recordBatchSources(
      options.fieldMask,
      input.count,
      hydrologyRequested,
      validHydrologySamples,
    );
  }

  clearSampleCache(): void {
    this.cachedSample = null;
  }

  private sampleHydrology(x: number, z: number, hintM: number): CachedHydrologySample {
    const revision = this.revision();
    const cached = this.cachedSample;
    if (cached
      && cached.x === x
      && cached.z === z
      && cached.hintM === hintM
      && cached.revision === revision) {
      return cached;
    }

    const sample = this.hydrology.sample(x, z, hintM);
    const cachedSample = { x, z, hintM, revision, sample };
    this.cachedSample = cachedSample;
    return cachedSample;
  }

  private revision(): number {
    const revision = this.hydrology.revision?.() ?? 0;
    return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
  }

  private recordScalar(field: EnvironmentQueryField, meta: EnvironmentQueryMeta, startedAt: number): void {
    this.diagnostics.recordScalar(field, meta, elapsedMs(startedAt, this.nowMs()));
  }

  private recordBatchSources(
    fieldMask: number,
    count: number,
    hydrologyRequested: boolean,
    validHydrologySamples: number,
  ): void {
    if (hydrologyRequested) {
      this.diagnostics.recordBatchSource(HYDROLOGY_QUERY_SOURCE, validHydrologySamples);
      this.diagnostics.recordBatchSource(
        HYDROLOGY_QUERY_SOURCE,
        count - validHydrologySamples,
        false,
      );
    }
    const fallbackRequested = hasEnvironmentField(fieldMask, ENVIRONMENT_QUERY_FIELD.normal)
      || hasEnvironmentField(fieldMask, ENVIRONMENT_QUERY_FIELD.material)
      || hasEnvironmentField(fieldMask, ENVIRONMENT_QUERY_FIELD.visibility);
    if (fallbackRequested) {
      this.diagnostics.recordBatchSource(ENVIRONMENT_FALLBACK_SOURCE, count, false);
    }
  }
}

function elapsedMs(startedAt: number, finishedAt: number): number {
  const elapsed = finishedAt - startedAt;
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
}

function defaultNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
