import { environmentQuerySourceIndex, type EnvironmentBatchOutput } from "./batch.js";
import type {
  EnvironmentQueryField,
  EnvironmentQueryMeta,
  RiverQueryResult,
  WaterQueryResult,
} from "./types.js";
import type { HydrologySample } from "../water/hydrologyGrid.js";

export const HYDROLOGY_QUERY_SOURCE = "hydrology-cpu" as const;
export const ENVIRONMENT_FALLBACK_SOURCE = "fallback" as const;

const NO_BODY_ID = -1;

export function createHydrologyMeta(
  revision: number,
  valid: boolean,
  cellSizeM: number,
): EnvironmentQueryMeta {
  return {
    source: HYDROLOGY_QUERY_SOURCE,
    revision,
    valid,
    cellSizeM,
  };
}

export function createFallbackMeta(cellSizeM: number): EnvironmentQueryMeta {
  return {
    source: ENVIRONMENT_FALLBACK_SOURCE,
    revision: 0,
    valid: false,
    cellSizeM,
  };
}

export function hydrologyWaterResult(
  sample: HydrologySample | null,
  meta: EnvironmentQueryMeta,
): WaterQueryResult {
  if (!sample) {
    return {
      waterY: 0,
      carvedBedY: 0,
      depth: 0,
      wetMask: 0,
      shoreDistanceM: 0,
      bodyKind: 0,
      bodyId: null,
      meta,
    };
  }
  return {
    waterY: finiteOrZero(sample.waterY),
    carvedBedY: finiteOrZero(sample.terrainY),
    depth: finiteOrZero(sample.depth),
    wetMask: finiteOrZero(sample.bodyMask),
    shoreDistanceM: finiteOrZero(sample.shoreDistance),
    bodyKind: nonNegativeIntegerOrZero(sample.bodyKind),
    bodyId: sample.bodyId > 0 && Number.isFinite(sample.bodyId)
      ? Math.floor(sample.bodyId)
      : null,
    meta,
  };
}

export function hydrologyRiverResult(
  sample: HydrologySample | null,
  meta: EnvironmentQueryMeta,
): RiverQueryResult {
  if (!sample) {
    return {
      flowX: 0,
      flowZ: 0,
      flowStrength: 0,
      bedDrop: 0,
      rapidMask: 0,
      channelCenterWeight: 0,
      bankContactWeight: 0,
      gravelBarMask: 0,
      meta,
    };
  }
  return {
    flowX: finiteOrZero(sample.flowX),
    flowZ: finiteOrZero(sample.flowZ),
    flowStrength: finiteOrZero(sample.flowStrength),
    bedDrop: 0,
    rapidMask: 0,
    channelCenterWeight: finiteOrZero(sample.riverMask),
    bankContactWeight: 0,
    gravelBarMask: 0,
    meta,
  };
}

export function writeBatchWater(
  output: EnvironmentBatchOutput,
  index: number,
  sample: HydrologySample | null,
  meta: EnvironmentQueryMeta,
): void {
  output.waterY[index] = sample ? finiteOrZero(sample.waterY) : 0;
  output.carvedBedY[index] = sample ? finiteOrZero(sample.terrainY) : 0;
  output.waterDepth[index] = sample ? finiteOrZero(sample.depth) : 0;
  output.wetMask[index] = sample ? finiteOrZero(sample.bodyMask) : 0;
  output.shoreDistanceM[index] = sample ? finiteOrZero(sample.shoreDistance) : 0;
  output.bodyKind[index] = sample ? nonNegativeIntegerOrZero(sample.bodyKind) : 0;
  output.bodyId[index] = sample && sample.bodyId > 0 && Number.isFinite(sample.bodyId)
    ? Math.floor(sample.bodyId)
    : NO_BODY_ID;
  writeEnvironmentMeta(output.meta.water, index, meta);
}

export function writeBatchRiver(
  output: EnvironmentBatchOutput,
  index: number,
  sample: HydrologySample | null,
  meta: EnvironmentQueryMeta,
): void {
  const flowIndex = index * 2;
  output.flowXZ[flowIndex] = sample ? finiteOrZero(sample.flowX) : 0;
  output.flowXZ[flowIndex + 1] = sample ? finiteOrZero(sample.flowZ) : 0;
  output.flowStrength[index] = sample ? finiteOrZero(sample.flowStrength) : 0;
  output.bedDrop[index] = 0;
  output.rapidMask[index] = 0;
  output.channelCenterWeight[index] = sample ? finiteOrZero(sample.riverMask) : 0;
  output.bankContactWeight[index] = 0;
  output.gravelBarMask[index] = 0;
  writeEnvironmentMeta(output.meta.river, index, meta);
}

export function writeEnvironmentMeta(
  output: EnvironmentBatchOutput["meta"][EnvironmentQueryField],
  index: number,
  meta: EnvironmentQueryMeta,
): void {
  output.source[index] = environmentQuerySourceIndex(meta.source);
  output.revision[index] = meta.revision;
  output.valid[index] = meta.valid ? 1 : 0;
  output.cellSizeM[index] = meta.cellSizeM;
}

export function isFiniteHydrologySample(sample: HydrologySample): boolean {
  return Number.isFinite(sample.terrainY)
    && Number.isFinite(sample.waterY)
    && Number.isFinite(sample.depth)
    && Number.isFinite(sample.bodyMask)
    && Number.isFinite(sample.riverMask)
    && Number.isFinite(sample.flowX)
    && Number.isFinite(sample.flowZ)
    && Number.isFinite(sample.flowStrength)
    && Number.isFinite(sample.bodyKind)
    && Number.isFinite(sample.bodyId)
    && Number.isFinite(sample.shoreDistance);
}

export function hasEnvironmentField(fieldMask: number, field: number): boolean {
  return (fieldMask & field) !== 0;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nonNegativeIntegerOrZero(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
