import type { DeepOceanRenderConfig, RgbColor } from "../terrain/border_coast_config.js";
import type { WaterVisualConfig } from "./waterConfig.js";

const NODE_FOG_DISTANCE_SCALE = 4;

function cloneColor(color: RgbColor): [number, number, number] {
  return [color[0], color[1], color[2]];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function resolveDeepOceanVisual(
  base: WaterVisualConfig,
  config: DeepOceanRenderConfig,
): WaterVisualConfig {
  const shading = config.shading;
  return {
    ...base,
    shallowColor: cloneColor(shading.shallowColor),
    deepColor: cloneColor(shading.deepColor),
    foamColor: cloneColor(shading.foamColor),
    fresnelPower: shading.fresnelPower,
    rippleLoopDistance: Math.max(1, shading.fogFarM / NODE_FOG_DISTANCE_SCALE),
    color: {
      ...base.color,
      turbidity: Math.max(0, shading.fogDensity),
    },
    fresnel: {
      ...base.fresnel,
      base: clamp01(shading.fresnelStrength * 0.08),
      power: shading.fresnelPower,
    },
    reflection: {
      ...base.reflection,
      skyFallbackStrength: Math.max(0, shading.reflectionStrength),
      stepScale: Math.max(0.001, shading.reflectionDistortion),
    },
  };
}
