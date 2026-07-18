import {
  DEFAULT_ENVIRONMENT_SAMPLE_HINT_M,
  ENVIRONMENT_QUERY_ALL_FIELDS,
  ENVIRONMENT_QUERY_FIELD,
  ENVIRONMENT_QUERY_FIELD_NAMES,
  ENVIRONMENT_QUERY_SOURCE_NAMES,
  MAX_ENVIRONMENT_SAMPLE_HINT_M,
  MIN_ENVIRONMENT_SAMPLE_HINT_M,
} from "./constants.js";
import type { EnvironmentQueryField, EnvironmentQuerySource } from "./types.js";

export interface EnvironmentBatchInput {
  readonly positionsXZ: Float32Array;
  readonly count: number;
  readonly offset?: number;
  readonly stride?: number;
}

export interface EnvironmentBatchOptions {
  readonly fieldMask?: number;
  readonly sampleHintM?: number;
  readonly fallbackSampleHintM?: number;
}

export interface EnvironmentBatchMetaBuffers {
  readonly source: Uint8Array;
  readonly revision: Uint32Array;
  readonly valid: Uint8Array;
  readonly cellSizeM: Float32Array;
}

export interface EnvironmentBatchOutput {
  readonly capacity: number;
  count: number;
  readonly surfaceHeight: Float32Array;
  readonly normalXYZ: Float32Array;
  readonly materialWeights: Float32Array;
  readonly waterY: Float32Array;
  readonly carvedBedY: Float32Array;
  readonly waterDepth: Float32Array;
  readonly wetMask: Float32Array;
  readonly shoreDistanceM: Float32Array;
  readonly bodyKind: Uint8Array;
  readonly bodyId: Int32Array;
  readonly flowXZ: Float32Array;
  readonly flowStrength: Float32Array;
  readonly bedDrop: Float32Array;
  readonly rapidMask: Float32Array;
  readonly channelCenterWeight: Float32Array;
  readonly bankContactWeight: Float32Array;
  readonly gravelBarMask: Float32Array;
  readonly sunVisibility: Float32Array;
  readonly meta: Readonly<Record<EnvironmentQueryField, EnvironmentBatchMetaBuffers>>;
}

export interface ResolvedEnvironmentBatchOptions {
  readonly fieldMask: number;
  readonly sampleHintM: number;
}

export interface EnvironmentBatchSampler {
  sampleBatch(
    input: EnvironmentBatchInput,
    output: EnvironmentBatchOutput,
    options: ResolvedEnvironmentBatchOptions,
  ): void;
}

const SOURCE_INDEX = new Map<EnvironmentQuerySource, number>(
  ENVIRONMENT_QUERY_SOURCE_NAMES.map((source, index) => [source, index]),
);

function createMetaBuffers(capacity: number): EnvironmentBatchMetaBuffers {
  return {
    source: new Uint8Array(capacity),
    revision: new Uint32Array(capacity),
    valid: new Uint8Array(capacity),
    cellSizeM: new Float32Array(capacity),
  };
}

export function createEnvironmentBatchOutput(capacity: number): EnvironmentBatchOutput {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError(`Environment batch capacity must be a non-negative integer, received ${capacity}`);
  }

  const bodyId = new Int32Array(capacity);
  bodyId.fill(-1);
  const meta = Object.fromEntries(
    ENVIRONMENT_QUERY_FIELD_NAMES.map((field) => [field, createMetaBuffers(capacity)]),
  ) as Record<EnvironmentQueryField, EnvironmentBatchMetaBuffers>;

  return {
    capacity,
    count: 0,
    surfaceHeight: new Float32Array(capacity),
    normalXYZ: new Float32Array(capacity * 3),
    materialWeights: new Float32Array(capacity * 4),
    waterY: new Float32Array(capacity),
    carvedBedY: new Float32Array(capacity),
    waterDepth: new Float32Array(capacity),
    wetMask: new Float32Array(capacity),
    shoreDistanceM: new Float32Array(capacity),
    bodyKind: new Uint8Array(capacity),
    bodyId,
    flowXZ: new Float32Array(capacity * 2),
    flowStrength: new Float32Array(capacity),
    bedDrop: new Float32Array(capacity),
    rapidMask: new Float32Array(capacity),
    channelCenterWeight: new Float32Array(capacity),
    bankContactWeight: new Float32Array(capacity),
    gravelBarMask: new Float32Array(capacity),
    sunVisibility: new Float32Array(capacity),
    meta,
  };
}

export function resolveEnvironmentSampleHint(
  hintM: number | undefined,
  fallbackHintM = DEFAULT_ENVIRONMENT_SAMPLE_HINT_M,
): number {
  const fallback = Number.isFinite(fallbackHintM) && fallbackHintM > 0
    ? fallbackHintM
    : DEFAULT_ENVIRONMENT_SAMPLE_HINT_M;
  const candidate = Number.isFinite(hintM) && (hintM as number) > 0 ? (hintM as number) : fallback;
  return Math.min(MAX_ENVIRONMENT_SAMPLE_HINT_M, Math.max(MIN_ENVIRONMENT_SAMPLE_HINT_M, candidate));
}

export function environmentQuerySourceIndex(source: EnvironmentQuerySource): number {
  const index = SOURCE_INDEX.get(source);
  if (index === undefined) {
    throw new Error(`Unknown environment query source: ${source}`);
  }
  return index;
}

export function sampleEnvironmentBatch(
  sampler: EnvironmentBatchSampler,
  input: EnvironmentBatchInput,
  output: EnvironmentBatchOutput,
  options: EnvironmentBatchOptions = {},
): void {
  const count = validateEnvironmentBatchInput(input, output.capacity);
  const fieldMask = options.fieldMask ?? ENVIRONMENT_QUERY_ALL_FIELDS;
  if (!Number.isInteger(fieldMask) || fieldMask < 0 || (fieldMask & ~ENVIRONMENT_QUERY_ALL_FIELDS) !== 0) {
    throw new RangeError(
      `Environment batch fieldMask must be a non-negative bitset within 0x${ENVIRONMENT_QUERY_ALL_FIELDS.toString(16)}, received ${fieldMask}`,
    );
  }
  const resolved: ResolvedEnvironmentBatchOptions = {
    fieldMask,
    sampleHintM: resolveEnvironmentSampleHint(options.sampleHintM, options.fallbackSampleHintM),
  };

  clearUnmaskedEnvironmentFields(output, count, fieldMask);

  output.count = 0;
  sampler.sampleBatch(input, output, resolved);
  output.count = count;
}

function clearUnmaskedEnvironmentFields(
  output: EnvironmentBatchOutput,
  count: number,
  fieldMask: number,
): void {
  const clearMeta = (field: EnvironmentQueryField): void => {
    const meta = output.meta[field];
    meta.source.fill(0, 0, count);
    meta.revision.fill(0, 0, count);
    meta.valid.fill(0, 0, count);
    meta.cellSizeM.fill(0, 0, count);
  };

  if ((fieldMask & ENVIRONMENT_QUERY_FIELD.surface) === 0) {
    output.surfaceHeight.fill(0, 0, count);
    clearMeta("surface");
  }
  if ((fieldMask & ENVIRONMENT_QUERY_FIELD.normal) === 0) {
    output.normalXYZ.fill(0, 0, count * 3);
    clearMeta("normal");
  }
  if ((fieldMask & ENVIRONMENT_QUERY_FIELD.material) === 0) {
    output.materialWeights.fill(0, 0, count * 4);
    clearMeta("material");
  }
  if ((fieldMask & ENVIRONMENT_QUERY_FIELD.water) === 0) {
    output.waterY.fill(0, 0, count);
    output.carvedBedY.fill(0, 0, count);
    output.waterDepth.fill(0, 0, count);
    output.wetMask.fill(0, 0, count);
    output.shoreDistanceM.fill(0, 0, count);
    output.bodyKind.fill(0, 0, count);
    output.bodyId.fill(-1, 0, count);
    clearMeta("water");
  }
  if ((fieldMask & ENVIRONMENT_QUERY_FIELD.river) === 0) {
    output.flowXZ.fill(0, 0, count * 2);
    output.flowStrength.fill(0, 0, count);
    output.bedDrop.fill(0, 0, count);
    output.rapidMask.fill(0, 0, count);
    output.channelCenterWeight.fill(0, 0, count);
    output.bankContactWeight.fill(0, 0, count);
    output.gravelBarMask.fill(0, 0, count);
    clearMeta("river");
  }
  if ((fieldMask & ENVIRONMENT_QUERY_FIELD.visibility) === 0) {
    output.sunVisibility.fill(0, 0, count);
    clearMeta("visibility");
  }
}

function validateEnvironmentBatchInput(input: EnvironmentBatchInput, capacity: number): number {
  if (!Number.isInteger(input.count) || input.count < 0) {
    throw new RangeError(`Environment batch count must be a non-negative integer, received ${input.count}`);
  }
  if (input.count > capacity) {
    throw new RangeError(`Environment batch count ${input.count} exceeds output capacity ${capacity}`);
  }

  const offset = input.offset ?? 0;
  const stride = input.stride ?? 2;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`Environment batch offset must be a non-negative integer, received ${offset}`);
  }
  if (!Number.isInteger(stride) || stride < 2) {
    throw new RangeError(`Environment batch stride must be an integer >= 2, received ${stride}`);
  }

  if (input.count === 0) return 0;
  const requiredLength = offset + (input.count - 1) * stride + 2;
  if (requiredLength > input.positionsXZ.length) {
    throw new RangeError(
      `Environment batch positions require ${requiredLength} values, received ${input.positionsXZ.length}`,
    );
  }
  return input.count;
}
