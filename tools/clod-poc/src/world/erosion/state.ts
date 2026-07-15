import { assertErosionNotAborted, yieldErosionTask } from "./abort.js";
import {
  EROSION_ASYNC_ROWS_PER_YIELD,
  FRACTION_Q16_ONE,
  HEIGHT_UNITS_PER_METER,
  SEDIMENT_UNITS_PER_METER,
  VELOCITY_UNITS_PER_CELL,
  WATER_UNITS_PER_METER,
} from "./constants.js";
import {
  fractionToQ16,
  metersToHeightFixed,
  metersToSedimentFixed,
  metersToWaterFixed,
  velocityCellsToFixed,
} from "./fixed_point.js";
import { buildHardnessField, buildHardnessFieldAsync } from "./hardness_field.js";
import type {
  ErodedMacroField,
  ErosionSourceField,
  ErosionState,
  ResolvedErosionConstants,
  TerrainErosionConfig,
} from "./types.js";

export interface ErosionSourceSampleInput {
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM?: { readonly x: number; readonly z: number };
  readonly config: TerrainErosionConfig;
  readonly sampleHeightMeters: (x: number, z: number) => number;
  readonly seed: number;
  readonly seaLevelM: number;
  readonly signal?: AbortSignal;
}

interface SourceGeometry {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
}

export function resolveErosionConstants(config: TerrainErosionConfig): ResolvedErosionConstants {
  const value = config.erosion;
  const talusHeightUnitsByHardnessByte = new Uint32Array(256);
  for (let hardnessByte = 0; hardnessByte < talusHeightUnitsByHardnessByte.length; hardnessByte++) {
    const hardness01 = hardnessByte / 255;
    const angleDegrees = value.thermal.softTalusDegrees
      + (value.thermal.hardTalusDegrees - value.thermal.softTalusDegrees) * hardness01;
    const riseM = Math.tan(angleDegrees * Math.PI / 180) * value.cellSizeM;
    talusHeightUnitsByHardnessByte[hardnessByte] = Math.max(0, Math.round(riseM * HEIGHT_UNITS_PER_METER)) >>> 0;
  }
  const fluxResponse = value.water.gravityMS2 * value.water.timeStepS * value.water.timeStepS / value.cellSizeM;
  return Object.freeze({
    rainWaterUnits: metersToWaterFixed(value.rain.amountPerIterationM),
    rainVariationQ16: fractionToQ16(value.rain.spatialVariation),
    fluxResponseQ16: fractionToQ16(Math.min(1, Math.max(0, fluxResponse))),
    evaporationRetainQ16: fractionToQ16(1 - value.water.evaporationFraction),
    maxVelocityFixed: velocityCellsToFixed(value.water.maxVelocityCellsPerStep),
    capacityFactorQ16: fractionToQ16(value.sediment.capacityFactor),
    erosionRateQ16: fractionToQ16(value.sediment.erosionRate),
    depositionRateQ16: fractionToQ16(value.sediment.depositionRate),
    minimumSlopeQ16: fractionToQ16(value.sediment.minimumSlope),
    maxErosionSedimentUnits: metersToSedimentFixed(value.sediment.maximumErosionPerIterationM),
    maxDepositionSedimentUnits: metersToSedimentFixed(value.sediment.maximumDepositionPerIterationM),
    thermalRateQ16: fractionToQ16(value.thermal.rate),
    talusHeightUnitsByHardnessByte,
  });
}

function sourceGeometry(input: ErosionSourceSampleInput): SourceGeometry {
  const cellSizeM = input.config.erosion.cellSizeM;
  const width = Math.floor(input.sizeM.x / cellSizeM) + 1;
  const height = Math.floor(input.sizeM.z / cellSizeM) + 1;
  if (width < 2 || height < 2) throw new Error("erosion bounds must contain at least 2 x 2 macro samples");
  const origin = input.originM ?? { x: 0, z: 0 };
  return { width, height, cellSizeM, originX: origin.x, originZ: origin.z };
}

function sampleHeightRow(
  input: ErosionSourceSampleInput,
  geometry: SourceGeometry,
  heightFixed: Int32Array,
  z: number,
): void {
  for (let x = 0; x < geometry.width; x++) {
    const sample = input.sampleHeightMeters(
      geometry.originX + x * geometry.cellSizeM,
      geometry.originZ + z * geometry.cellSizeM,
    );
    if (!Number.isFinite(sample)) throw new Error(`erosion sampler returned ${sample} at ${x},${z}`);
    heightFixed[z * geometry.width + x] = metersToHeightFixed(sample);
  }
}

function hardnessInput(
  input: ErosionSourceSampleInput,
  geometry: SourceGeometry,
  heightFixed: Int32Array,
) {
  return {
    width: geometry.width,
    height: geometry.height,
    cellSizeM: geometry.cellSizeM,
    originX: geometry.originX,
    originZ: geometry.originZ,
    seaLevelM: input.seaLevelM,
    seed: input.seed,
    heightFixed,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export function sampleErosionSourceField(input: ErosionSourceSampleInput): ErosionSourceField {
  const geometry = sourceGeometry(input);
  const heightFixed = new Int32Array(geometry.width * geometry.height);
  for (let z = 0; z < geometry.height; z++) {
    assertErosionNotAborted(input.signal);
    sampleHeightRow(input, geometry, heightFixed, z);
  }
  const hardness = buildHardnessField(hardnessInput(input, geometry, heightFixed));
  return Object.freeze({ ...geometry, heightFixed, hardness });
}

export async function sampleErosionSourceFieldAsync(input: ErosionSourceSampleInput): Promise<ErosionSourceField> {
  const geometry = sourceGeometry(input);
  const heightFixed = new Int32Array(geometry.width * geometry.height);
  for (let z = 0; z < geometry.height; z++) {
    assertErosionNotAborted(input.signal);
    sampleHeightRow(input, geometry, heightFixed, z);
    if ((z + 1) % EROSION_ASYNC_ROWS_PER_YIELD === 0) await yieldErosionTask(input.signal);
  }
  const hardness = await buildHardnessFieldAsync(hardnessInput(input, geometry, heightFixed));
  return Object.freeze({ ...geometry, heightFixed, hardness });
}

function emptyErosionState(source: ErosionSourceField, borderCells: number): ErosionState {
  const width = source.width + borderCells * 2;
  const height = source.height + borderCells * 2;
  const count = width * height;
  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    width,
    height,
    borderCells,
    cellSizeM: source.cellSizeM,
    originX: source.originX,
    originZ: source.originZ,
    heightFixed: new Int32Array(count),
    hardness: new Uint16Array(count),
    water: new Uint32Array(count),
    sediment: new Uint32Array(count),
    sedimentScratch: new Uint32Array(count),
    deposition: new Int32Array(count),
    fluxLeft: new Uint32Array(count),
    fluxRight: new Uint32Array(count),
    fluxUp: new Uint32Array(count),
    fluxDown: new Uint32Array(count),
    velocityX: new Int32Array(count),
    velocityZ: new Int32Array(count),
    capacity: new Uint32Array(count),
    thermalDelta: new Int32Array(count),
    hydraulicIteration: 0,
    thermalIteration: 0,
  };
}

function copySourceRow(source: ErosionSourceField, state: ErosionState, z: number): void {
  const sourceZ = Math.min(source.height - 1, Math.max(0, z - state.borderCells));
  for (let x = 0; x < state.width; x++) {
    const sourceX = Math.min(source.width - 1, Math.max(0, x - state.borderCells));
    const sourceIndex = sourceZ * source.width + sourceX;
    const index = z * state.width + x;
    state.heightFixed[index] = source.heightFixed[sourceIndex]!;
    state.hardness[index] = source.hardness[sourceIndex]!;
  }
}

export function createErosionState(source: ErosionSourceField, borderCells: number): ErosionState {
  const state = emptyErosionState(source, borderCells);
  for (let z = 0; z < state.height; z++) copySourceRow(source, state, z);
  return state;
}

export async function createErosionStateAsync(
  source: ErosionSourceField,
  borderCells: number,
  signal?: AbortSignal,
): Promise<ErosionState> {
  const state = emptyErosionState(source, borderCells);
  for (let z = 0; z < state.height; z++) {
    assertErosionNotAborted(signal);
    copySourceRow(source, state, z);
    if ((z + 1) % EROSION_ASYNC_ROWS_PER_YIELD === 0) await yieldErosionTask(signal);
  }
  return state;
}

export function cloneErosionState(state: ErosionState): ErosionState {
  return {
    ...state,
    heightFixed: new Int32Array(state.heightFixed),
    hardness: new Uint16Array(state.hardness),
    water: new Uint32Array(state.water),
    sediment: new Uint32Array(state.sediment),
    sedimentScratch: new Uint32Array(state.sedimentScratch),
    deposition: new Int32Array(state.deposition),
    fluxLeft: new Uint32Array(state.fluxLeft),
    fluxRight: new Uint32Array(state.fluxRight),
    fluxUp: new Uint32Array(state.fluxUp),
    fluxDown: new Uint32Array(state.fluxDown),
    velocityX: new Int32Array(state.velocityX),
    velocityZ: new Int32Array(state.velocityZ),
    capacity: new Uint32Array(state.capacity),
    thermalDelta: new Int32Array(state.thermalDelta),
  };
}

export function assertCanonicalScale(config: TerrainErosionConfig): void {
  if (config.erosion.persistence.quantizedHeightStepM !== 1 / HEIGHT_UNITS_PER_METER) {
    throw new Error("erosion quantized height step must match the canonical i32 height scale");
  }
  if (WATER_UNITS_PER_METER * 16 !== SEDIMENT_UNITS_PER_METER) {
    throw new Error("erosion fixed-point scale relationship is invalid");
  }
  if (VELOCITY_UNITS_PER_CELL !== 4096 || FRACTION_Q16_ONE !== 65536) {
    throw new Error("erosion fixed-point constants changed without a schema bump");
  }
}

function createCroppedField(state: ErosionState): ErodedMacroField {
  const count = state.sourceWidth * state.sourceHeight;
  const field: ErodedMacroField = {
    width: state.sourceWidth,
    height: state.sourceHeight,
    cellSizeM: state.cellSizeM,
    originX: state.originX,
    originZ: state.originZ,
    heightFixed: new Int32Array(count),
    hardness: new Uint16Array(count),
    sediment: new Uint32Array(count),
    deposition: new Int32Array(count),
    sampleHeightMeters(x, z) {
      const fx = Math.max(0, Math.min(field.width - 1, (x - field.originX) / field.cellSizeM));
      const fz = Math.max(0, Math.min(field.height - 1, (z - field.originZ) / field.cellSizeM));
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      const x1 = Math.min(field.width - 1, x0 + 1);
      const z1 = Math.min(field.height - 1, z0 + 1);
      const tx = fx - x0;
      const tz = fz - z0;
      const h00 = field.heightFixed[z0 * field.width + x0]!;
      const h10 = field.heightFixed[z0 * field.width + x1]!;
      const h01 = field.heightFixed[z1 * field.width + x0]!;
      const h11 = field.heightFixed[z1 * field.width + x1]!;
      const a = h00 + (h10 - h00) * tx;
      const b = h01 + (h11 - h01) * tx;
      return (a + (b - a) * tz) / HEIGHT_UNITS_PER_METER;
    },
  };
  return field;
}

function cropRow(state: ErosionState, field: ErodedMacroField, z: number): void {
  const sourceOffset = (z + state.borderCells) * state.width + state.borderCells;
  const targetOffset = z * state.sourceWidth;
  field.heightFixed.set(state.heightFixed.subarray(sourceOffset, sourceOffset + state.sourceWidth), targetOffset);
  field.hardness.set(state.hardness.subarray(sourceOffset, sourceOffset + state.sourceWidth), targetOffset);
  field.sediment.set(state.sediment.subarray(sourceOffset, sourceOffset + state.sourceWidth), targetOffset);
  field.deposition.set(state.deposition.subarray(sourceOffset, sourceOffset + state.sourceWidth), targetOffset);
}

export function cropErodedMacroField(state: ErosionState): ErodedMacroField {
  const field = createCroppedField(state);
  for (let z = 0; z < state.sourceHeight; z++) cropRow(state, field, z);
  return Object.freeze(field);
}

export async function cropErodedMacroFieldAsync(state: ErosionState, signal?: AbortSignal): Promise<ErodedMacroField> {
  const field = createCroppedField(state);
  for (let z = 0; z < state.sourceHeight; z++) {
    assertErosionNotAborted(signal);
    cropRow(state, field, z);
    if ((z + 1) % EROSION_ASYNC_ROWS_PER_YIELD === 0) await yieldErosionTask(signal);
  }
  return Object.freeze(field);
}
