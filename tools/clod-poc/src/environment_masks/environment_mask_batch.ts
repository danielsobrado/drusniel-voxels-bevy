import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import {
  createEnvironmentBatchOutput,
  sampleEnvironmentBatch,
  type EnvironmentBatchOutput,
  type EnvironmentBatchSampler,
} from "../environment_query/batch.js";
import { ENVIRONMENT_QUERY_FIELD } from "../environment_query/constants.js";
import type { EnvironmentQuery } from "../environment_query/types.js";
import { evaluateEnvironmentalMasks } from "./environment_mask_evaluator.js";
import {
  createEnvironmentalMaskValues,
  evaluateEnvironmentalMaskValues,
  type EnvironmentalMaskValues,
} from "./environment_mask_math.js";
import type {
  EnvironmentalMaskBatchBuffers,
  EnvironmentalMaskSettings,
  EnvironmentalMaskValidity,
} from "./environment_mask_types.js";

const VALID_WATER = 1 << 0;
const VALID_RIVER = 1 << 1;
const VALID_NORMAL = 1 << 2;
const VALID_VISIBILITY = 1 << 3;
const REQUIRED_ENVIRONMENT_FIELDS = ENVIRONMENT_QUERY_FIELD.water
  | ENVIRONMENT_QUERY_FIELD.river
  | ENVIRONMENT_QUERY_FIELD.normal
  | ENVIRONMENT_QUERY_FIELD.visibility;
const ENVIRONMENT_WORKSPACES = new WeakMap<EnvironmentalMaskBatchBuffers, EnvironmentBatchOutput>();

export interface EnvironmentalMaskBatchInput {
  readonly query: EnvironmentQuery;
  readonly settings: EnvironmentalMaskSettings;
  readonly biome: BiomeVisualState;
  readonly positions: ArrayLike<number>;
  readonly count: number;
  readonly positionStride?: number;
  readonly positionOffset?: number;
  readonly hintM?: number;
  readonly output: EnvironmentalMaskBatchBuffers;
}

export function createEnvironmentalMaskBatchBuffers(count: number): EnvironmentalMaskBatchBuffers {
  const size = validateCount(count);
  return {
    riverCobble: new Float32Array(size),
    riverMist: new Float32Array(size),
    rapidSplash: new Float32Array(size),
    sunbeamMote: new Float32Array(size),
    calmPool: new Float32Array(size),
    frost: new Float32Array(size),
    dew: new Float32Array(size),
    shoreDebris: new Float32Array(size),
    validity: new Uint8Array(size),
  };
}

export function evaluateEnvironmentalMaskBatch(input: EnvironmentalMaskBatchInput): EnvironmentalMaskBatchBuffers {
  const count = validateCount(input.count);
  const stride = validateStride(input.positionStride ?? 2);
  const offset = validateOffset(input.positionOffset ?? 0);
  validatePositions(input.positions, count, stride, offset);
  validateOutput(input.output, count);

  const batchSampler = asBatchSampler(input.query);
  if (
    batchSampler
    && input.positions instanceof Float32Array
    && positionsAreFinite(input.positions, count, stride, offset)
  ) {
    evaluateWithBatchSampler(input, batchSampler, count, stride, offset);
    return input.output;
  }

  evaluateWithScalarQueries(input, count, stride, offset);
  return input.output;
}

export function unpackEnvironmentalMaskValidity(value: number): EnvironmentalMaskValidity {
  const bits = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return {
    water: (bits & VALID_WATER) !== 0,
    river: (bits & VALID_RIVER) !== 0,
    normal: (bits & VALID_NORMAL) !== 0,
    visibility: (bits & VALID_VISIBILITY) !== 0,
  };
}

function evaluateWithBatchSampler(
  input: EnvironmentalMaskBatchInput,
  sampler: EnvironmentBatchSampler,
  count: number,
  stride: number,
  offset: number,
): void {
  const environment = environmentWorkspace(input.output, count);
  sampleEnvironmentBatch(
    sampler,
    {
      positionsXZ: input.positions as Float32Array,
      count,
      stride,
      offset,
    },
    environment,
    {
      fieldMask: REQUIRED_ENVIRONMENT_FIELDS,
      sampleHintM: input.hintM,
    },
  );

  const values = createEnvironmentalMaskValues();
  for (let index = 0; index < count; index += 1) {
    const validity: EnvironmentalMaskValidity = {
      water: environment.meta.water.valid[index] !== 0,
      river: environment.meta.river.valid[index] !== 0,
      normal: environment.meta.normal.valid[index] !== 0,
      visibility: environment.meta.visibility.valid[index] !== 0,
    };
    evaluateEnvironmentalMaskValues({
      settings: input.settings,
      biome: input.biome,
      waterValid: validity.water,
      riverValid: validity.river,
      normalValid: validity.normal,
      visibilityValid: validity.visibility,
      wetMask: environment.wetMask[index] ?? 0,
      bodyKind: environment.bodyKind[index] ?? 0,
      waterDepth: environment.waterDepth[index] ?? 0,
      shoreDistanceM: environment.shoreDistanceM[index] ?? 0,
      flowStrength: environment.flowStrength[index] ?? 0,
      bedDrop: environment.bedDrop[index] ?? 0,
      rapidMask: environment.rapidMask[index] ?? 0,
      normalY: environment.normalXYZ[index * 3 + 1] ?? 0,
      sunVisibility: environment.sunVisibility[index] ?? 0,
    }, values);
    writeValues(input.output, index, values, validity);
  }
}

function evaluateWithScalarQueries(
  input: EnvironmentalMaskBatchInput,
  count: number,
  stride: number,
  offset: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const base = offset + index * stride;
    const x = Number(input.positions[base]);
    const z = Number(input.positions[base + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      writeZero(input.output, index);
      continue;
    }
    const sample = evaluateEnvironmentalMasks({
      query: input.query,
      settings: input.settings,
      biome: input.biome,
      x,
      z,
      hintM: input.hintM,
    });
    input.output.riverCobble[index] = sample.riverCobble;
    input.output.riverMist[index] = sample.riverMist;
    input.output.rapidSplash[index] = sample.rapidSplash;
    input.output.sunbeamMote[index] = sample.sunbeamMote;
    input.output.calmPool[index] = sample.calmPool;
    input.output.frost[index] = sample.frost;
    input.output.dew[index] = sample.dew;
    input.output.shoreDebris[index] = sample.shoreDebris;
    input.output.validity[index] = packValidity(sample.meta.validity);
  }
}

function writeValues(
  output: EnvironmentalMaskBatchBuffers,
  index: number,
  values: EnvironmentalMaskValues,
  validity: EnvironmentalMaskValidity,
): void {
  output.riverCobble[index] = values.riverCobble;
  output.riverMist[index] = values.riverMist;
  output.rapidSplash[index] = values.rapidSplash;
  output.sunbeamMote[index] = values.sunbeamMote;
  output.calmPool[index] = values.calmPool;
  output.frost[index] = values.frost;
  output.dew[index] = values.dew;
  output.shoreDebris[index] = values.shoreDebris;
  output.validity[index] = packValidity(validity);
}

function environmentWorkspace(
  output: EnvironmentalMaskBatchBuffers,
  count: number,
): EnvironmentBatchOutput {
  const existing = ENVIRONMENT_WORKSPACES.get(output);
  if (existing && existing.capacity >= count) return existing;
  const created = createEnvironmentBatchOutput(count);
  ENVIRONMENT_WORKSPACES.set(output, created);
  return created;
}

function asBatchSampler(query: EnvironmentQuery): EnvironmentBatchSampler | null {
  const candidate = query as EnvironmentQuery & Partial<EnvironmentBatchSampler>;
  return typeof candidate.sampleBatch === "function" ? candidate as EnvironmentQuery & EnvironmentBatchSampler : null;
}

function positionsAreFinite(
  positions: Float32Array,
  count: number,
  stride: number,
  offset: number,
): boolean {
  for (let index = 0; index < count; index += 1) {
    const base = offset + index * stride;
    if (!Number.isFinite(positions[base]) || !Number.isFinite(positions[base + 1])) return false;
  }
  return true;
}

function packValidity(validity: EnvironmentalMaskValidity): number {
  return (validity.water ? VALID_WATER : 0)
    | (validity.river ? VALID_RIVER : 0)
    | (validity.normal ? VALID_NORMAL : 0)
    | (validity.visibility ? VALID_VISIBILITY : 0);
}

function writeZero(output: EnvironmentalMaskBatchBuffers, index: number): void {
  output.riverCobble[index] = 0;
  output.riverMist[index] = 0;
  output.rapidSplash[index] = 0;
  output.sunbeamMote[index] = 0;
  output.calmPool[index] = 0;
  output.frost[index] = 0;
  output.dew[index] = 0;
  output.shoreDebris[index] = 0;
  output.validity[index] = 0;
}

function validateOutput(output: EnvironmentalMaskBatchBuffers, count: number): void {
  const buffers: ArrayLike<number>[] = [
    output.riverCobble,
    output.riverMist,
    output.rapidSplash,
    output.sunbeamMote,
    output.calmPool,
    output.frost,
    output.dew,
    output.shoreDebris,
    output.validity,
  ];
  if (buffers.some((buffer) => buffer.length < count)) {
    throw new RangeError(`environmental mask output buffers must contain at least ${count} entries`);
  }
}

function validatePositions(positions: ArrayLike<number>, count: number, stride: number, offset: number): void {
  const required = count === 0 ? offset : offset + (count - 1) * stride + 2;
  if (positions.length < required) {
    throw new RangeError(`environmental mask positions require ${required} values; received ${positions.length}`);
  }
}

function validateCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError("environmental mask batch count must be a non-negative integer");
  return value;
}

function validateStride(value: number): number {
  if (!Number.isInteger(value) || value < 2) throw new RangeError("environmental mask position stride must be an integer of at least 2");
  return value;
}

function validateOffset(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError("environmental mask position offset must be a non-negative integer");
  return value;
}
