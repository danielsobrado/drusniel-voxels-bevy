import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import { readEnvironmentalMaskSettings } from "../environment_masks/environment_mask_runtime.js";
import type { SunbeamMoteMaskSettings } from "../environment_masks/environment_mask_types.js";

export interface SunbeamMoteRuntimeSettings {
  enabled: boolean;
  strength: number;
  visibilityStart: number;
  visibilityEnd: number;
  maxParticles: number;
  spawnRadiusM: number;
  fadeStartM: number;
  fadeEndM: number;
  updatePeriodFrames: number;
  density: number;
  opacity: number;
  forwardScatterPower: number;
  mistFloor: number;
  warmColorRgb: [number, number, number];
  coldColorRgb: [number, number, number];
}

export interface SunbeamMoteVisualState {
  amount: number;
  coldBlend: number;
  localMist: number;
}

const MAX_PARTICLES = 1_200;
const MAX_RADIUS_M = 96;
const MAX_UPDATE_PERIOD_FRAMES = 120;
const MAX_FORWARD_SCATTER_POWER = 32;

export function sunbeamMoteCapabilityEnabled(): boolean {
  const masks = readEnvironmentalMaskSettings();
  return masks.enabled && masks.sunbeamMote.enabled;
}

export function readSunbeamMoteRuntimeSettings(initialEnabled = false): SunbeamMoteRuntimeSettings {
  const masks = readEnvironmentalMaskSettings();
  return sanitizeSunbeamMoteRuntimeSettings(
    fromMask(masks.sunbeamMote, masks.enabled && masks.sunbeamMote.enabled && initialEnabled),
  );
}

export function sanitizeSunbeamMoteRuntimeSettings(
  input: SunbeamMoteRuntimeSettings,
): SunbeamMoteRuntimeSettings {
  const spawnRadiusM = bounded(input.spawnRadiusM, 4, MAX_RADIUS_M, 42);
  const fadeStartM = bounded(input.fadeStartM, 0, spawnRadiusM, Math.min(34, spawnRadiusM));
  const visibilityStart = fraction(input.visibilityStart, 0.45);
  return {
    enabled: input.enabled === true,
    strength: fraction(input.strength, 1),
    visibilityStart,
    visibilityEnd: Math.max(visibilityStart, fraction(input.visibilityEnd, 0.9)),
    maxParticles: integer(input.maxParticles, 0, MAX_PARTICLES, MAX_PARTICLES),
    spawnRadiusM,
    fadeStartM,
    fadeEndM: Math.max(fadeStartM, bounded(input.fadeEndM, 0, spawnRadiusM, spawnRadiusM)),
    updatePeriodFrames: integer(input.updatePeriodFrames, 1, MAX_UPDATE_PERIOD_FRAMES, 8),
    density: fraction(input.density, 0.72),
    opacity: fraction(input.opacity, 0.82),
    forwardScatterPower: bounded(input.forwardScatterPower, 1, MAX_FORWARD_SCATTER_POWER, 8),
    mistFloor: fraction(input.mistFloor, 0.18),
    warmColorRgb: color(input.warmColorRgb, [0.85, 0.75, 0.45]),
    coldColorRgb: color(input.coldColorRgb, [0.78, 0.9, 1]),
  };
}

export function resolveSunbeamMoteVisualState(
  biome: Pick<BiomeVisualState, "enabled" | "pollenAmount" | "frostAmount" | "morningMist"> | null,
): SunbeamMoteVisualState {
  if (!biome?.enabled) return { amount: 0, coldBlend: 0, localMist: 0 };
  const pollen = fraction(biome.pollenAmount, 0);
  const frost = fraction(biome.frostAmount, 0);
  const total = pollen + frost;
  return {
    amount: fraction(total, 0),
    coldBlend: total > 0.0001 ? frost / total : 0,
    localMist: fraction(biome.morningMist, 0),
  };
}

function fromMask(mask: SunbeamMoteMaskSettings, enabled: boolean): SunbeamMoteRuntimeSettings {
  return {
    enabled,
    strength: mask.strength,
    visibilityStart: mask.visibilityStart,
    visibilityEnd: mask.visibilityEnd,
    maxParticles: mask.particles.maxParticles,
    spawnRadiusM: mask.particles.spawnRadiusM,
    fadeStartM: mask.particles.fadeStartM,
    fadeEndM: mask.particles.fadeEndM,
    updatePeriodFrames: mask.particles.updatePeriodFrames,
    density: mask.particles.density,
    opacity: mask.particles.opacity,
    forwardScatterPower: mask.particles.forwardScatterPower,
    mistFloor: mask.particles.mistFloor,
    warmColorRgb: [...mask.particles.warmColorRgb],
    coldColorRgb: [...mask.particles.coldColorRgb],
  };
}

function integer(value: number, min: number, max: number, fallback: number): number {
  return Math.floor(bounded(value, min, max, fallback));
}

function bounded(value: number, min: number, max: number, fallback: number): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, finite));
}

function fraction(value: number, fallback: number): number {
  return bounded(value, 0, 1, fallback);
}

function color(value: [number, number, number], fallback: [number, number, number]): [number, number, number] {
  return [
    fraction(value?.[0], fallback[0]),
    fraction(value?.[1], fallback[1]),
    fraction(value?.[2], fallback[2]),
  ];
}
