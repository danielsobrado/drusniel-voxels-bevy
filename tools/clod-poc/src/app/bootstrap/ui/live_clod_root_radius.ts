import type { Phase0Config } from "../../../phase0/phase0_config.js";

const DEFAULT_CLOD_REFINEMENT_RADIUS_M = 768;

function positiveNumberParam(params: URLSearchParams, key: string): number | undefined {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveFinite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function resolveLiveClodRootRadius(
  params: URLSearchParams,
  phase0Config: Phase0Config,
  fallbackRadius: number,
): number {
  return positiveNumberParam(params, "liveClodRootRadius")
    ?? positiveFinite(phase0Config.phase0.streaming.clod_refinement_radius_m)
    ?? positiveFinite(fallbackRadius)
    ?? DEFAULT_CLOD_REFINEMENT_RADIUS_M;
}
