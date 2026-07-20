import type { ForestCanopyEcologySample } from "../forest_lighting/forest_lighting_texture.js";
import type { WaterVisualConfig } from "./waterConfig.js";

const CANOPY_TERRAIN_FALLBACK_BOOST = 0.35;
const SPECIES_TERRAIN_FALLBACK_BOOST = 0.08;
const CANOPY_SKY_FALLBACK_DAMPING = 0.22;
const MAX_REFLECTION_FALLBACK_STRENGTH = 2;
const REFLECTION_FALLBACK_QUANTIZATION_STEPS = 64;

export function applyCanopyWaterReflectionFallback(
  visual: WaterVisualConfig,
  canopy: ForestCanopyEcologySample | null,
): WaterVisualConfig {
  if (!canopy) return visual;

  const competition = clamp01(Math.max(
    canopy.canopyDensity,
    canopy.competition,
    canopy.grassSuppression,
  ));
  const speciesCoverage = clamp01(canopy.broadleafCoverage + canopy.coniferCoverage);
  const terrainStrength = quantizeStrength(clamp(
    visual.reflection.terrainFallbackStrength *
      (1 + competition * CANOPY_TERRAIN_FALLBACK_BOOST + speciesCoverage * SPECIES_TERRAIN_FALLBACK_BOOST),
    0,
    MAX_REFLECTION_FALLBACK_STRENGTH,
  ));
  const skyStrength = quantizeStrength(clamp(
    visual.reflection.skyFallbackStrength * (1 - competition * CANOPY_SKY_FALLBACK_DAMPING),
    0,
    MAX_REFLECTION_FALLBACK_STRENGTH,
  ));

  if (
    terrainStrength === visual.reflection.terrainFallbackStrength &&
    skyStrength === visual.reflection.skyFallbackStrength
  ) {
    return visual;
  }

  return {
    ...visual,
    reflection: {
      ...visual.reflection,
      terrainFallbackStrength: terrainStrength,
      skyFallbackStrength: skyStrength,
    },
  };
}

function quantizeStrength(value: number): number {
  return Math.round(value * REFLECTION_FALLBACK_QUANTIZATION_STEPS) /
    REFLECTION_FALLBACK_QUANTIZATION_STEPS;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
