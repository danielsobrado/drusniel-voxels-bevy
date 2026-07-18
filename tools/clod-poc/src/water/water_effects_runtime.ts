import type { WaterVisualConfig } from "./water_config_types.js";

export const WATER_EFFECT_KEYS = [
  "glacialMurkiness",
  "rockFlour",
  "reflectionTiers",
] as const;

export type WaterEffectKey = typeof WATER_EFFECT_KEYS[number];

export interface WaterEffectsState {
  glacialMurkiness: boolean;
  rockFlour: boolean;
  reflectionTiers: boolean;
}

export interface WaterEffectsRuntime {
  current(): Readonly<WaterEffectsState>;
  setEnabled(effect: WaterEffectKey, enabled: boolean): boolean;
  apply(visual: WaterVisualConfig): WaterVisualConfig;
}

export function createWaterEffectsRuntime(
  visual: WaterVisualConfig,
  rockFlourEnabled = visual.rockFlour.enabled,
): WaterEffectsRuntime {
  const state: WaterEffectsState = {
    glacialMurkiness: visual.glacialMurkiness.enabled,
    rockFlour: rockFlourEnabled,
    reflectionTiers: visual.reflection.clipmapTiers.enabled,
  };

  return {
    current: () => state,
    setEnabled(effect, enabled) {
      if (state[effect] === enabled) return false;
      state[effect] = enabled;
      return true;
    },
    apply(currentVisual) {
      return applyWaterEffectsState(currentVisual, state);
    },
  };
}

export function applyWaterEffectsState(
  visual: WaterVisualConfig,
  state: Readonly<WaterEffectsState>,
): WaterVisualConfig {
  const glacialChanged = visual.glacialMurkiness.enabled !== state.glacialMurkiness;
  const rockFlourChanged = visual.rockFlour.enabled !== state.rockFlour;
  const reflectionChanged = visual.reflection.clipmapTiers.enabled !== state.reflectionTiers;
  if (!glacialChanged && !rockFlourChanged && !reflectionChanged) return visual;

  return {
    ...visual,
    glacialMurkiness: glacialChanged
      ? { ...visual.glacialMurkiness, enabled: state.glacialMurkiness }
      : visual.glacialMurkiness,
    rockFlour: rockFlourChanged
      ? { ...visual.rockFlour, enabled: state.rockFlour }
      : visual.rockFlour,
    reflection: reflectionChanged
      ? {
          ...visual.reflection,
          clipmapTiers: {
            ...visual.reflection.clipmapTiers,
            enabled: state.reflectionTiers,
          },
        }
      : visual.reflection,
  };
}
