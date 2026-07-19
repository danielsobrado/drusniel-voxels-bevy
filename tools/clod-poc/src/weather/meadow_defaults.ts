import { DEFAULT_ENVIRONMENTAL_MASK_SETTINGS } from "../environment_masks/environment_mask_config.js";
import type { MeadowWeatherSettings } from "./meadow_types.js";

export const MEADOW_CELL_SIZE = 12;
export const MEADOW_RING_RADIUS = 42;
export const MEADOW_BOUNDS_RADIUS = 104;
export const MEADOW_PARTICLE_COUNT = 1200;
export const MEADOW_NEAR_COUNT = 550;
export const MEADOW_MID_COUNT = 400;
export const MEADOW_FAR_COUNT = 250;

const moteMask = DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.sunbeamMote;

export const DEFAULT_MEADOW_WEATHER_SETTINGS: MeadowWeatherSettings = {
  enabled: true,
  intensity: 0.7,
  windX: -0.42,
  windZ: 0.18,
  motes: {
    enabled: false,
    strength: moteMask.strength,
    visibilityStart: moteMask.visibilityStart,
    visibilityEnd: moteMask.visibilityEnd,
    maxParticles: moteMask.particles.maxParticles,
    spawnRadiusM: moteMask.particles.spawnRadiusM,
    fadeStartM: moteMask.particles.fadeStartM,
    fadeEndM: moteMask.particles.fadeEndM,
    updatePeriodFrames: moteMask.particles.updatePeriodFrames,
    density: moteMask.particles.density,
    opacity: moteMask.particles.opacity,
    forwardScatterPower: moteMask.particles.forwardScatterPower,
    mistFloor: moteMask.particles.mistFloor,
    warmColorRgb: [...moteMask.particles.warmColorRgb],
    coldColorRgb: [...moteMask.particles.coldColorRgb],
  },
};
