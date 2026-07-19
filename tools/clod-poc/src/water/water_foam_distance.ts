import type { WaterFoamVisualConfig } from "./water_config_types.js";

const MIN_FADE_WIDTH_M = 0.001;

export interface WaterFoamDistanceFade {
  readonly startM: number;
  readonly endM: number;
}

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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
