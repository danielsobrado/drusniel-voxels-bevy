import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import type { WaterBodyVisualPreset, WaterBodyVisualPresets } from "./water_body_presets.js";
import type { WaterGlacialMurkinessConfig, WaterVisualConfig } from "./water_config_types.js";

export type WaterGlacialMurkinessState = Pick<BiomeVisualState, "enabled" | "glacialMurkiness">;

export function effectiveWaterGlacialMurkiness(
  config: WaterGlacialMurkinessConfig,
  state: WaterGlacialMurkinessState | null,
): number {
  if (!config.enabled || !state?.enabled) return 0;
  return clampFraction(state.glacialMurkiness);
}

export function resolveGlacialWaterBodyPresets(
  base: WaterBodyVisualPresets,
  config: WaterGlacialMurkinessConfig,
  state: WaterGlacialMurkinessState | null,
): WaterBodyVisualPresets {
  const murkiness = effectiveWaterGlacialMurkiness(config, state);
  if (murkiness <= 0) return base;

  const lake = resolveBodyPreset(base.lake, config, murkiness * nonNegative(config.lakeStrength));
  const river = resolveBodyPreset(base.river, config, murkiness * nonNegative(config.riverStrength));
  if (lake === base.lake && river === base.river) return base;

  return {
    ocean: base.ocean,
    lake,
    river,
    pond: base.pond,
    marsh: base.marsh,
  };
}

export function resolveGlacialWaterVisual(
  visual: WaterVisualConfig,
  state: WaterGlacialMurkinessState | null,
): WaterVisualConfig {
  const bodies = resolveGlacialWaterBodyPresets(visual.bodies, visual.glacialMurkiness, state);
  return bodies === visual.bodies ? visual : { ...visual, bodies };
}

function resolveBodyPreset(
  base: WaterBodyVisualPreset,
  config: WaterGlacialMurkinessConfig,
  amount: number,
): WaterBodyVisualPreset {
  const blend = clampFraction(amount);
  if (blend <= 0) return base;

  const absorptionMultiplier = config.absorptionMultiplier.map((value) => Math.max(1, finiteOr(value, 1))) as [
    number,
    number,
    number,
  ];
  const turbidityAdd = nonNegative(config.turbidityAdd);
  const reflectionMinimum = Math.min(base.reflectionDamping, clampFraction(config.reflectionDampingMin));

  return {
    shallowColor: [...base.shallowColor],
    deepColor: [...base.deepColor],
    absorption: [
      base.absorption[0] * lerp(1, absorptionMultiplier[0], blend),
      base.absorption[1] * lerp(1, absorptionMultiplier[1], blend),
      base.absorption[2] * lerp(1, absorptionMultiplier[2], blend),
    ],
    turbidity: clampFraction(base.turbidity + turbidityAdd * blend),
    reflectionDamping: lerp(base.reflectionDamping, reflectionMinimum, blend),
  };
}

function nonNegative(value: number): number {
  return Math.max(0, finiteOr(value, 0));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, finiteOr(value, 0)));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
