import type { ClodPagesConfig } from "../../config.js";

export interface StreamingClodRootBudgetOptions {
  buildBudgetPagesPerFrame?: number;
  applyBudgetPagesPerFrame?: number;
  maxInflightBatches?: number;
  maxCachedPages?: number;
}

export interface StreamingClodRootBudgets {
  buildBudgetPagesPerFrame: number;
  applyBudgetPagesPerFrame: number;
  maxInflightBatches: number;
  maxCachedPages: number;
}

export interface StreamingClodRootTransitionOptions {
  enabled: boolean;
  mode: "crossfade";
  durationFrames: number;
  maxExtraRoots: number;
}

interface StreamingClodConfigCarrier {
  streaming?: { clod?: { max_root_level?: number } };
}

export const DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME = 1;
export const DEFAULT_APPLY_BUDGET_PAGES_PER_FRAME = 1;
export const DEFAULT_MAX_INFLIGHT_BATCHES = 1;
export const DEFAULT_MAX_CACHED_PAGES = 128;
export const DEFAULT_STREAM_MAX_ROOT_LEVEL = 1;
export const DEFAULT_ROOT_SWITCH_STABLE_FRAMES = 8;
const DEFAULT_ROOT_TRANSITION_FRAMES = 12;
const DEFAULT_ROOT_TRANSITION_MAX_EXTRA_ROOTS = 64;

export function pageBudgetCost(level = 0): number {
  return 4 ** Math.max(0, Math.floor(level));
}

export function resolveBudget(value: number | undefined, fallback: number): number {
  const raw = value ?? fallback;
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : fallback;
}

function querySearchParams(): URLSearchParams | null {
  const maybeWindow = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window;
  const search = maybeWindow?.location?.search;
  return search ? new URLSearchParams(search) : null;
}

function queryStreamingClodMaxRootLevel(): number | undefined {
  const raw = querySearchParams()?.get("liveClodRootMaxLevel");
  if (raw === null || raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export function queryStreamingRootSwitchStableFrames(): number | undefined {
  const params = querySearchParams();
  if (!params) return undefined;
  const raw = params.get("liveClodRootSwitchStableFrames");
  if (raw === null || raw.trim() === "") return DEFAULT_ROOT_SWITCH_STABLE_FRAMES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_ROOT_SWITCH_STABLE_FRAMES;
}

function queryEnabledFlag(params: URLSearchParams | null, key: string): boolean | undefined {
  const raw = params?.get(key);
  if (raw === null || raw === undefined || raw.trim() === "") return undefined;
  return raw === "1" || raw.toLowerCase() === "true";
}

function queryPositiveInteger(params: URLSearchParams | null, key: string, fallback: number): number {
  const parsed = Number(params?.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function queryNonNegativeInteger(params: URLSearchParams | null, key: string, fallback: number): number {
  const parsed = Number(params?.get(key));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function resolveRootTransitionOptions(
  override?: Partial<StreamingClodRootTransitionOptions>,
): StreamingClodRootTransitionOptions {
  const params = querySearchParams();
  const mode = params?.get("liveClodRootTransitionMode") === "crossfade" ? "crossfade" : "crossfade";
  return {
    enabled: override?.enabled ?? queryEnabledFlag(params, "liveClodRootTransition") ?? false,
    mode: override?.mode ?? mode,
    durationFrames: Math.max(
      1,
      Math.floor(
        override?.durationFrames
          ?? queryPositiveInteger(params, "liveClodRootTransitionFrames", DEFAULT_ROOT_TRANSITION_FRAMES),
      ),
    ),
    maxExtraRoots: Math.max(
      0,
      Math.floor(
        override?.maxExtraRoots
          ?? queryNonNegativeInteger(params, "liveClodRootTransitionMaxExtraRoots", DEFAULT_ROOT_TRANSITION_MAX_EXTRA_ROOTS),
      ),
    ),
  };
}

export function resolveStreamingClodMaxRootLevel(cfg: ClodPagesConfig, override?: number): number {
  const fullMax = Math.max(0, Math.floor(cfg.page.quadtree_levels) - 1);
  const configured = (cfg as ClodPagesConfig & StreamingClodConfigCarrier).streaming?.clod?.max_root_level;
  const fallback = Math.min(DEFAULT_STREAM_MAX_ROOT_LEVEL, fullMax);
  const raw = override ?? queryStreamingClodMaxRootLevel() ?? configured ?? fallback;
  return Number.isFinite(raw) ? Math.max(0, Math.min(fullMax, Math.floor(raw))) : fallback;
}
