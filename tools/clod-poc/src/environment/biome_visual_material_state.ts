import type { BiomeVisualState } from "./biome_visual_state.js";

export interface ResolvedBiomeVisualMaterialState {
  readonly enabled: number;
  readonly green: number;
  readonly autumn: number;
  readonly bloom: number;
  readonly snowlineM: number;
  readonly frost: number;
  readonly dew: number;
}

const NEUTRAL_MATERIAL_STATE: ResolvedBiomeVisualMaterialState = Object.freeze({
  enabled: 0,
  green: 1,
  autumn: 0,
  bloom: 1,
  snowlineM: 1_000_000,
  frost: 0,
  dew: 0,
});

export function resolveBiomeVisualMaterialState(
  state: BiomeVisualState | null,
): ResolvedBiomeVisualMaterialState {
  if (!state?.enabled) return NEUTRAL_MATERIAL_STATE;

  const frost = clamp01(state.frostAmount);
  return {
    enabled: 1,
    green: clamp01(state.green),
    autumn: clamp01(state.autumn),
    bloom: clamp01(state.bloom),
    snowlineM: finiteAtLeast(state.snowlineM, 0, NEUTRAL_MATERIAL_STATE.snowlineM),
    frost,
    dew: clamp01(state.wetness) * (1 - frost),
  };
}

export function biomeVisualMaterialStateSignature(
  state: ResolvedBiomeVisualMaterialState,
): string {
  return [
    state.enabled,
    state.green,
    state.autumn,
    state.bloom,
    state.snowlineM,
    state.frost,
    state.dew,
  ].map((value) => value.toFixed(5)).join("|");
}

export function resolveGrassSeasonalColor(
  color: readonly [number, number, number],
  state: ResolvedBiomeVisualMaterialState,
): [number, number, number] {
  if (state.enabled === 0) return [...color];

  const dry = Math.max(1 - state.green, state.autumn * 0.8);
  let next = multiplyColor(color, mixColor([1, 1, 1], [0.95, 0.78, 0.36], dry * 0.58));
  next = multiplyColor(next, mixColor([1, 1, 1], [1.08, 0.76, 0.38], state.autumn * 0.28));
  next = mixColor(next, [0.78, 0.9, 1], state.frost * 0.48);
  return multiplyColor(next, mixColor([1, 1, 1], [1.05, 1.09, 1.06], state.dew * 0.16));
}

function multiplyColor(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): [number, number, number] {
  return [left[0] * right[0], left[1] * right[1], left[2] * right[2]];
}

function mixColor(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  const t = clamp01(amount);
  return [
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
    left[2] + (right[2] - left[2]) * t,
  ];
}

function finiteAtLeast(value: number, minimum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
