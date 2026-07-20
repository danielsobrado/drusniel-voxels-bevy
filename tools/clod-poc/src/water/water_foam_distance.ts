import type { WaterFoamVisualConfig } from "./water_config_types.js";

const MIN_FADE_WIDTH_M = 0.001;

export interface WaterFoamDistanceFade {
  readonly startM: number;
  readonly endM: number;
}

export interface WaterFoamDistanceFadeState extends WaterFoamDistanceFade {
  readonly valid: boolean;
  readonly version: number;
}

export interface WaterFoamDistanceDebugOverrideState {
  readonly enabled: boolean;
  readonly distanceM: number;
}

export interface WaterFoamDistanceDebugUniforms {
  readonly enabled: { value: number };
  readonly distanceM: { value: number };
}

export type WaterFoamDistanceFadeListener = (state: WaterFoamDistanceFadeState) => void;
export type WaterFoamDistanceDebugOverrideListener = (
  state: WaterFoamDistanceDebugOverrideState,
) => void;

let state: WaterFoamDistanceFadeState = {
  startM: 0,
  endM: MIN_FADE_WIDTH_M,
  valid: false,
  version: 0,
};
let debugOverride: WaterFoamDistanceDebugOverrideState = {
  enabled: false,
  distanceM: 0,
};
const listeners = new Set<WaterFoamDistanceFadeListener>();
const debugListeners = new Set<WaterFoamDistanceDebugOverrideListener>();
const debugUniforms: WaterFoamDistanceDebugUniforms = {
  enabled: { value: 0 },
  distanceM: { value: 0 },
};

export function resolveWaterFoamDistanceFade(
  foam: Pick<WaterFoamVisualConfig, "detailFadeStartM" | "detailFadeEndM">,
): WaterFoamDistanceFade {
  const startM = nonNegativeFinite(foam.detailFadeStartM);
  const requestedEndM = nonNegativeFinite(foam.detailFadeEndM);
  return {
    startM,
    endM: Math.max(startM + MIN_FADE_WIDTH_M, requestedEndM),
  };
}

export function publishWaterFoamDistanceFade(
  foam: Pick<WaterFoamVisualConfig, "detailFadeStartM" | "detailFadeEndM">,
): WaterFoamDistanceFadeState {
  const resolved = resolveWaterFoamDistanceFade(foam);
  if (state.valid && state.startM === resolved.startM && state.endM === resolved.endM) return state;
  state = {
    ...resolved,
    valid: true,
    version: state.version + 1,
  };
  for (const listener of listeners) listener(state);
  return state;
}

export function getWaterFoamDistanceFadeState(): WaterFoamDistanceFadeState {
  return state;
}

export function subscribeWaterFoamDistanceFade(listener: WaterFoamDistanceFadeListener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function setWaterFoamDistanceDebugOverrideM(
  value: number | null,
): WaterFoamDistanceDebugOverrideState {
  const next = value === null
    ? { enabled: false, distanceM: 0 }
    : { enabled: true, distanceM: finiteNonNegative(value, "foam distance debug override") };
  if (debugOverride.enabled === next.enabled && debugOverride.distanceM === next.distanceM) {
    return debugOverride;
  }
  debugOverride = next;
  debugUniforms.enabled.value = next.enabled ? 1 : 0;
  debugUniforms.distanceM.value = next.distanceM;
  for (const listener of debugListeners) listener(debugOverride);
  return debugOverride;
}

export function getWaterFoamDistanceDebugOverride(): WaterFoamDistanceDebugOverrideState {
  return debugOverride;
}

export function getWaterFoamDistanceDebugUniforms(): WaterFoamDistanceDebugUniforms {
  return debugUniforms;
}

export function subscribeWaterFoamDistanceDebugOverride(
  listener: WaterFoamDistanceDebugOverrideListener,
): () => void {
  debugListeners.add(listener);
  listener(debugOverride);
  return () => debugListeners.delete(listener);
}

export function evaluateWaterFoamDistanceFade(
  distanceM: number,
  fade: WaterFoamDistanceFade,
): number {
  const distance = nonNegativeFinite(distanceM);
  const t = clamp01((distance - fade.startM) / Math.max(MIN_FADE_WIDTH_M, fade.endM - fade.startM));
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite or null`);
  return Math.max(0, value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
