import type { WaterVisualConfig } from "./water_config_types.js";

export const WATER_REFERENCE_PRESET_OPTIONS = {
  "Fable5-inspired (stable)": "fable5",
  "Glacial Valley-inspired": "glacial",
  Custom: "custom",
} as const;

export type WaterReferencePreset = typeof WATER_REFERENCE_PRESET_OPTIONS[keyof typeof WATER_REFERENCE_PRESET_OPTIONS];

export function applyWaterReferencePreset(
  visual: WaterVisualConfig,
  preset: WaterReferencePreset,
): void {
  if (preset === "custom") return;

  visual.fresnel.base = 0.02;
  visual.fresnel.power = 5.0;

  if (preset === "fable5") {
    visual.rippleCycle = 0.45;
    visual.rippleAmp = 0.10;
    visual.rippleSpeed = 1.0;
    visual.rippleScaleA = 0.11;
    visual.rippleScaleB = 0.035;
    visual.rippleStrengthA = 0.10;
    visual.rippleStrengthB = 0.05;
    visual.fresnel.normalFlatten = 0.97;
    visual.glitter.enabled = true;
    visual.glitter.tightExponent = 160;
    visual.glitter.tightGain = 0.28;
    visual.glitter.broadExponent = 48;
    visual.glitter.broadGain = 0.06;
    visual.glitter.lowSunGain = 0.20;
    return;
  }

  visual.rippleCycle = 0.18;
  visual.rippleAmp = 0.20;
  visual.rippleSpeed = 0.85;
  visual.rippleScaleA = 0.20;
  visual.rippleScaleB = 0.08;
  visual.rippleStrengthA = 0.18;
  visual.rippleStrengthB = 0.10;
  visual.fresnel.normalFlatten = 0.92;
  visual.glitter.enabled = true;
  visual.glitter.tightExponent = 320;
  visual.glitter.tightGain = 0.45;
  visual.glitter.broadExponent = 72;
  visual.glitter.broadGain = 0.09;
  visual.glitter.lowSunGain = 0.30;
}
