import type { SelectionParams } from "../../clod/selection.js";

const POSITION_QUANTUM_M = 0.05;
const RADIUS_QUANTUM_M = 0.05;
const FLOAT_QUANTUM = 0.0001;

export interface ClodSelectionCacheStats {
  hits: number;
  misses: number;
  lastHit: boolean;
}

function q(value: number, quantum: number): number {
  return Math.round(value / quantum);
}

function qFloat(value: number): number {
  return q(value, FLOAT_QUANTUM);
}

function sortedSetKey(values: ReadonlySet<string>): string {
  if (values.size === 0) return "";
  return [...values].sort().join(",");
}

export function buildClodSelectionCacheKey(
  params: SelectionParams,
  forceSplitIds: ReadonlySet<string>,
): string {
  const nearField = params.nearField;
  return [
    `thr:${qFloat(params.thresholdPx)}`,
    `hys:${qFloat(params.hysteresisMergeFactor)}`,
    `e21:${params.enforce21 ? 1 : 0}`,
    `ndl:${params.neighborLevelDeltaMax ?? 1}`,
    `freeze:${params.freezeSelection ? 1 : 0}`,
    `vp:${params.viewportH}`,
    `fov:${qFloat(params.fovY)}`,
    `cam:${params.camPos.map((value) => q(value, POSITION_QUANTUM_M)).join(",")}`,
    `forced:${params.forcedMaxLevel ?? "auto"}`,
    `nf:${nearField?.enabled ? 1 : 0}`,
    `nfc:${nearField ? `${q(nearField.centerX, POSITION_QUANTUM_M)},${q(nearField.centerZ, POSITION_QUANTUM_M)}` : ""}`,
    `nfr:${nearField ? q(nearField.radius, RADIUS_QUANTUM_M) : ""}`,
    `nfb:${nearField ? q(nearField.boundaryPadding, RADIUS_QUANTUM_M) : ""}`,
    `forceSplit:${sortedSetKey(forceSplitIds)}`,
  ].join("|");
}
