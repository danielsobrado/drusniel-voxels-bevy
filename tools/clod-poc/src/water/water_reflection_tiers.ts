import type { WaterReflectionClipmapTiersConfig, WaterVisualConfig } from "./waterConfig.js";

export function resolveWaterReflectionTierVisual(
  visual: WaterVisualConfig,
  levelCellSizeM: number | null,
): WaterVisualConfig {
  const reflection = visual.reflection;
  const tiers = reflection.clipmapTiers;
  if (
    !tiers.enabled
    || reflection.mode !== "ssr"
    || !reflection.ssrEnabled
    || reflection.maxSteps <= 0
    || !isPositiveFinite(levelCellSizeM)
  ) {
    return visual;
  }

  const fullMaxCellSizeM = nonNegativeFinite(tiers.fullQualityMaxCellSizeM);
  const midMaxCellSizeM = Math.max(
    fullMaxCellSizeM,
    nonNegativeFinite(tiers.midQualityMaxCellSizeM),
  );

  if (levelCellSizeM <= fullMaxCellSizeM) return visual;

  if (levelCellSizeM <= midMaxCellSizeM) {
    const midMaxSteps = resolveMidMaxSteps(tiers, reflection.maxSteps);
    if (midMaxSteps === reflection.maxSteps) return visual;
    if (midMaxSteps <= 0) return disableSsrForLevel(visual);

    return {
      ...visual,
      reflection: {
        ...reflection,
        maxSteps: midMaxSteps,
      },
    };
  }

  return disableSsrForLevel(visual);
}

function disableSsrForLevel(visual: WaterVisualConfig): WaterVisualConfig {
  if (!visual.reflection.ssrEnabled && visual.reflection.maxSteps === 0) return visual;

  return {
    ...visual,
    reflection: {
      ...visual.reflection,
      ssrEnabled: false,
      maxSteps: 0,
    },
  };
}

function resolveMidMaxSteps(
  tiers: WaterReflectionClipmapTiersConfig,
  baseMaxSteps: number,
): number {
  const base = Math.max(0, Math.floor(finiteOr(baseMaxSteps, 0)));
  const requested = Math.max(0, Math.floor(finiteOr(tiers.midMaxSteps, 0)));
  return Math.min(base, requested);
}

function isPositiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number): number {
  return Math.max(0, finiteOr(value, 0));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
