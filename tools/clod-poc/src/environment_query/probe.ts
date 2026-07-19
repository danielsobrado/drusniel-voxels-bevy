import { resolveEnvironmentSampleHint } from "./batch.js";
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

export interface EnvironmentQueryProbe {
  readonly x: number;
  readonly z: number;
  readonly hintM: number;
  readonly surface: SurfaceQueryResult;
  readonly normal: NormalQueryResult;
  readonly material: MaterialWeightsResult;
  readonly water: WaterQueryResult;
  readonly river: RiverQueryResult;
  readonly visibility: VisibilityQueryResult;
}

export function sampleEnvironmentQueryProbe(
  query: EnvironmentQuery,
  x: number,
  z: number,
  hintM: number,
): EnvironmentQueryProbe {
  const hint = resolveEnvironmentSampleHint(hintM);
  return {
    x,
    z,
    hintM: hint,
    surface: query.surfaceHeightBestEffort(x, z, hint),
    normal: query.surfaceNormal(x, z, hint),
    material: query.materialWeights(x, z, hint),
    water: query.water(x, z, hint),
    river: query.river(x, z, hint),
    visibility: query.visibility(x, z, hint),
  };
}

export function formatEnvironmentQueryMeta(meta: EnvironmentQueryMeta): string {
  return [
    meta.source,
    meta.valid ? "valid" : "invalid",
    `r${nonNegativeInteger(meta.revision)}`,
    `${formatNumber(meta.cellSizeM)} m`,
  ].join(" | ");
}

export function formatEnvironmentQueryProbeValues(probe: EnvironmentQueryProbe): string {
  const height = probe.surface.height === null ? "n/a" : formatNumber(probe.surface.height);
  return [
    `h=${height}`,
    `n=${formatNumber(probe.normal.x)},${formatNumber(probe.normal.y)},${formatNumber(probe.normal.z)}`,
    `grass=${formatNumber(probe.material.grass)}`,
    `rock=${formatNumber(probe.material.rock)}`,
    `wet=${formatNumber(probe.water.wetMask)}`,
    `depth=${formatNumber(probe.water.depth)}`,
    `flow=${formatNumber(probe.river.flowStrength)}`,
    `bar=${formatNumber(probe.river.gravelBarMask)}`,
    `sun=${formatNumber(probe.visibility.sunVisibility)}`,
  ].join(" | ");
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "n/a";
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
