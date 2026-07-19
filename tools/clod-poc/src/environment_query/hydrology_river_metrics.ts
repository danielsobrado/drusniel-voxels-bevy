import type { HydrologyGrid, HydrologySample } from "../water/hydrologyGrid.js";
import { cascadeWhitewaterDrop, clamp01 } from "../water/water_field_helpers.js";
import { FLOW_EPSILON } from "../water/water_field_types.js";

export interface HydrologyRiverMetricSource {
  readonly grid: Pick<HydrologyGrid, "res" | "worldCells">;
  sample(x: number, z: number, cellSizeHint: number): HydrologySample;
}

export interface HydrologyRiverMetrics {
  readonly flowX: number;
  readonly flowZ: number;
  readonly flowStrength: number;
  readonly bedDrop: number;
}

export function resolveHydrologyRiverMetrics(
  source: HydrologyRiverMetricSource,
  sample: HydrologySample,
  x: number,
  z: number,
  cellSizeHint: number,
): HydrologyRiverMetrics {
  const riverMask = clamp01(sample.riverMask);
  const flowLength = Math.hypot(sample.flowX, sample.flowZ);
  const flowStrength = Math.max(0, sample.flowStrength) * riverMask;
  if (flowLength <= FLOW_EPSILON || flowStrength <= FLOW_EPSILON) {
    return { flowX: 0, flowZ: 0, flowStrength: 0, bedDrop: 0 };
  }

  const flowX = sample.flowX / flowLength;
  const flowZ = sample.flowZ / flowLength;
  const sampleStepM = Math.max(
    1,
    source.grid.worldCells / Math.max(1, source.grid.res - 1),
  ) * 2;
  const upstream = source.sample(
    x - flowX * sampleStepM,
    z - flowZ * sampleStepM,
    cellSizeHint,
  );
  const downstream = source.sample(
    x + flowX * sampleStepM,
    z + flowZ * sampleStepM,
    cellSizeHint,
  );
  const localDrop = upstream.riverMask <= 0.05 && downstream.riverMask <= 0.05
    ? 0
    : Math.max(0, upstream.waterY - downstream.waterY);

  return {
    flowX,
    flowZ,
    flowStrength,
    bedDrop: finiteNonNegative(cascadeWhitewaterDrop(localDrop, flowStrength)),
  };
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
