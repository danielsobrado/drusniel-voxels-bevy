import type { SunbeamMoteMaskSettings } from "./environment_mask_types.js";

export interface SunbeamMoteAirborneInput {
  readonly enabled: boolean;
  readonly morningMist: number;
  readonly pollenAmount: number;
  readonly frostAmount: number;
}

export interface SunbeamMoteAirborneState {
  readonly amount: number;
  readonly coldBlend: number;
  readonly localMist: number;
}

export interface SunbeamMoteMaskValueInput {
  readonly settings: SunbeamMoteMaskSettings;
  readonly biome: SunbeamMoteAirborneInput;
  readonly visibilityValid: boolean;
  readonly sunVisibility: number;
}

export function evaluateSunbeamMoteAirborneState(
  input: SunbeamMoteAirborneInput,
): SunbeamMoteAirborneState {
  if (!input.enabled) return { amount: 0, coldBlend: 0, localMist: 0 };

  const pollen = clamp01(input.pollenAmount);
  const frost = clamp01(input.frostAmount);
  const seasonalAmount = clamp01(pollen + frost);
  const localMist = clamp01(input.morningMist);
  return {
    amount: Math.max(localMist, seasonalAmount),
    coldBlend: seasonalAmount > 0.0001 ? frost / Math.max(0.0001, pollen + frost) : 0,
    localMist,
  };
}

export function evaluateSunbeamMoteMaskValue(input: SunbeamMoteMaskValueInput): number {
  if (!input.settings.enabled || !input.visibilityValid) return 0;
  const airborne = evaluateSunbeamMoteAirborneState(input.biome);
  return clamp01(
    input.settings.strength
      * airborne.amount
      * smoothRamp(
        input.settings.visibilityStart,
        input.settings.visibilityEnd,
        input.sunVisibility,
      ),
  );
}

function smoothRamp(start: number, end: number, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!(end > start)) return value >= end ? 1 : 0;
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
