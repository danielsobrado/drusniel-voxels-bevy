import { isRpgDensityScene } from "../../../scenes/rpg_density_scenes.js";
import {
  runTerrainStreamingWork,
} from "../../../stream/terrain_streaming_control.js";

const INFINITE_ISLANDS_SCENE = "infinite-islands";

export const ACCEPTANCE_MIN_STREAM_BUILD_BUDGET = 16;
export const ACCEPTANCE_MIN_STREAM_APPLY_BUDGET = 4;
export const ACCEPTANCE_MIN_STREAM_MAX_CACHED = 512;
export const ACCEPTANCE_STREAM_MAX_LEVEL = 1;
export const ACCEPTANCE_CPU_MAX_STREAM_INFLIGHT_BATCHES = 1;
export const ACCEPTANCE_GPU_MAX_STREAM_INFLIGHT_BATCHES = 2;
export const STREAMING_ROOT_IDLE_UPDATE_PAGE_FACTOR = 0.25;
export const DEFAULT_ROOT_TRANSITION_FRAMES = 12;
export const DEFAULT_ROOT_TRANSITION_MAX_EXTRA_ROOTS = 64;

export function positiveIntegerParam(params: URLSearchParams, key: string): number | undefined {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function nonNegativeIntegerParam(params: URLSearchParams, key: string): number | undefined {
  if (!params.has(key)) return undefined;
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export function usesInteractiveStreamingBudgets(scene: string | null): boolean {
  return scene === INFINITE_ISLANDS_SCENE || scene === "continent" || isRpgDensityScene(scene);
}

export function runStreamingSelectionUpdate<T>(
  enabled: boolean,
  previous: T,
  updateTiles: () => void,
  updateRoots: () => T,
): T {
  return runTerrainStreamingWork(enabled, () => {
    updateTiles();
    return updateRoots();
  }) ?? previous;
}

export function acceptanceMin(value: number | undefined, minimum: number, acceptance: boolean): number | undefined {
  if (!acceptance) return value;
  return Math.max(value ?? minimum, minimum);
}

export function acceptanceMax(value: number | undefined, maximum: number, acceptance: boolean): number | undefined {
  if (!acceptance) return value;
  return Math.min(value ?? maximum, maximum);
}

export function enabledParam(params: URLSearchParams, key: string): boolean {
  const raw = params.get(key);
  return raw === "1" || raw?.toLowerCase() === "true";
}
