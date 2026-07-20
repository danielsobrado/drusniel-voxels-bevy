import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import {
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_MARSH,
  HYDROLOGY_BODY_POND,
  HYDROLOGY_BODY_RIVER,
} from "../water/hydrologyGrid.js";
import type {
  EnvironmentalMaskSettings,
  RiverMistMaskSettings,
} from "./environment_mask_types.js";
import { evaluateSunbeamMoteMaskValue } from "./sunbeam_mote_mask_state.js";

export interface EnvironmentalMaskMathInput {
  readonly settings: EnvironmentalMaskSettings;
  readonly biome: BiomeVisualState;
  readonly waterValid: boolean;
  readonly riverValid: boolean;
  readonly normalValid: boolean;
  readonly visibilityValid: boolean;
  readonly wetMask: number;
  readonly bodyKind: number;
  readonly waterDepth: number;
  readonly shoreDistanceM: number;
  readonly flowStrength: number;
  readonly bedDrop: number;
  readonly rapidMask: number;
  readonly normalY: number;
  readonly sunVisibility: number;
}

export interface RiverMistMaskMathInput {
  readonly settings: RiverMistMaskSettings;
  readonly biomeEnabled: boolean;
  readonly morningMist: number;
  readonly waterValid: boolean;
  readonly riverValid: boolean;
  readonly wetMask: number;
  readonly bodyKind: number;
  readonly waterDepth: number;
  readonly shoreDistanceM: number;
  readonly flowStrength: number;
}

export interface EnvironmentalMaskValues {
  riverCobble: number;
  riverMist: number;
  rapidSplash: number;
  sunbeamMote: number;
  calmPool: number;
  frost: number;
  dew: number;
  shoreDebris: number;
}

export function createEnvironmentalMaskValues(): EnvironmentalMaskValues {
  return {
    riverCobble: 0,
    riverMist: 0,
    rapidSplash: 0,
    sunbeamMote: 0,
    calmPool: 0,
    frost: 0,
    dew: 0,
    shoreDebris: 0,
  };
}

export function evaluateRiverMistMaskValue(input: RiverMistMaskMathInput): number {
  const config = input.settings;
  if (
    !config.enabled
    || !input.biomeEnabled
    || !input.waterValid
    || !input.riverValid
    || input.bodyKind !== HYDROLOGY_BODY_RIVER
    || !Number.isFinite(input.waterDepth)
    || input.waterDepth <= 0.03
    || !Number.isFinite(input.wetMask)
    || input.wetMask <= 0.08
    || !Number.isFinite(input.shoreDistanceM)
    || input.shoreDistanceM < 0
    || !Number.isFinite(input.flowStrength)
  ) {
    return 0;
  }

  const flow = ramp(
    config.minFlowStrength,
    config.minFlowStrength * 3 + 0.001,
    input.flowStrength,
  );
  const shore = inverseRamp(
    config.maxShoreDistanceM * 0.55,
    config.maxShoreDistanceM,
    input.shoreDistanceM,
  );
  return clamp01(
    config.strength
      * clamp01(input.wetMask)
      * clamp01(input.morningMist)
      * flow
      * shore,
  );
}

export function evaluateEnvironmentalMaskValues(
  input: EnvironmentalMaskMathInput,
  output: EnvironmentalMaskValues,
): EnvironmentalMaskValues {
  resetEnvironmentalMaskValues(output);
  if (!input.settings.enabled || !input.biome.enabled) return output;

  const wet = input.waterValid ? clamp01(input.wetMask) : 0;
  const isRiver = input.bodyKind === HYDROLOGY_BODY_RIVER ? 1 : 0;
  const isCalmBody = input.bodyKind === HYDROLOGY_BODY_LAKE
    || input.bodyKind === HYDROLOGY_BODY_POND
    || input.bodyKind === HYDROLOGY_BODY_MARSH
    ? 1
    : 0;
  const flow = input.riverValid ? nonNegative(input.flowStrength) : 0;
  const drop = input.riverValid ? nonNegative(Math.abs(input.bedDrop)) : 0;
  const shore = input.waterValid ? nonNegative(input.shoreDistanceM) : Number.POSITIVE_INFINITY;
  const visibility = input.visibilityValid ? clamp01(input.sunVisibility) : 0;

  if (input.settings.riverCobble.enabled && input.waterValid && input.riverValid && input.normalValid) {
    const config = input.settings.riverCobble;
    output.riverCobble = config.strength
      * wet
      * isRiver
      * softBand(input.waterDepth, config.minDepthM, config.maxDepthM)
      * softBand(flow, config.minFlowStrength, config.maxFlowStrength)
      * inverseRamp(config.maxShoreDistanceM * 0.65, config.maxShoreDistanceM, shore)
      * ramp(config.minNormalY, Math.min(1, config.minNormalY + 0.16), input.normalY);
  }

  output.riverMist = evaluateRiverMistMaskValue({
    settings: input.settings.riverMist,
    biomeEnabled: input.biome.enabled,
    morningMist: input.biome.morningMist,
    waterValid: input.waterValid,
    riverValid: input.riverValid,
    wetMask: input.wetMask,
    bodyKind: input.bodyKind,
    waterDepth: input.waterDepth,
    shoreDistanceM: input.shoreDistanceM,
    flowStrength: input.flowStrength,
  });

  if (input.settings.rapidSplash.enabled && input.waterValid && input.riverValid) {
    const config = input.settings.rapidSplash;
    const configuredRapid = clamp01(input.rapidMask);
    const derivedRapid = clamp01(
      ramp(config.flowStart, config.flowEnd, flow) * 0.58
      + ramp(config.bedDropStart, config.bedDropEnd, drop) * 0.72,
    );
    output.rapidSplash = config.strength * wet * isRiver * Math.max(configuredRapid, derivedRapid);
  }

  output.sunbeamMote = evaluateSunbeamMoteMaskValue({
    settings: input.settings.sunbeamMote,
    biome: input.biome,
    visibilityValid: input.visibilityValid,
    sunVisibility: input.sunVisibility,
  });

  if (input.settings.calmPool.enabled && input.waterValid && input.riverValid) {
    const config = input.settings.calmPool;
    output.calmPool = config.strength
      * wet
      * isCalmBody
      * ramp(config.minDepthM, config.minDepthM * 2 + 0.001, input.waterDepth)
      * inverseRamp(config.maxFlowStrength * 0.35, config.maxFlowStrength, flow);
  }

  if (input.settings.frost.enabled && input.visibilityValid) {
    const config = input.settings.frost;
    const shade = inverseRamp(config.visibilityStart, config.visibilityEnd, visibility);
    const wetnessGate = 1 - clamp01(input.biome.wetness) * config.wetnessSuppression;
    output.frost = config.strength * clamp01(input.biome.frostAmount) * shade * clamp01(wetnessGate);
  }

  if (input.settings.dew.enabled) {
    const config = input.settings.dew;
    const wetness = ramp(config.wetnessStart, config.wetnessEnd, input.biome.wetness);
    const shadeBoost = input.visibilityValid ? 0.65 + 0.35 * (1 - visibility) : 1;
    output.dew = config.strength * wetness * clamp01(input.biome.green) * shadeBoost;
  }

  if (input.settings.shoreDebris.enabled && input.waterValid && input.riverValid) {
    const config = input.settings.shoreDebris;
    const shoreBand = softBand(shore, config.shoreStartM, config.shoreEndM);
    const flowGate = inverseRamp(config.maxFlowStrength * 0.45, config.maxFlowStrength, flow);
    output.shoreDebris = config.strength * shoreBand * flowGate;
  }

  clampEnvironmentalMaskValues(output);
  return output;
}

function resetEnvironmentalMaskValues(output: EnvironmentalMaskValues): void {
  output.riverCobble = 0;
  output.riverMist = 0;
  output.rapidSplash = 0;
  output.sunbeamMote = 0;
  output.calmPool = 0;
  output.frost = 0;
  output.dew = 0;
  output.shoreDebris = 0;
}

function clampEnvironmentalMaskValues(output: EnvironmentalMaskValues): void {
  output.riverCobble = clamp01(output.riverCobble);
  output.riverMist = clamp01(output.riverMist);
  output.rapidSplash = clamp01(output.rapidSplash);
  output.sunbeamMote = clamp01(output.sunbeamMote);
  output.calmPool = clamp01(output.calmPool);
  output.frost = clamp01(output.frost);
  output.dew = clamp01(output.dew);
  output.shoreDebris = clamp01(output.shoreDebris);
}

function softBand(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !(max > min)) return 0;
  const width = Math.max(0.001, (max - min) * 0.25);
  return ramp(min, Math.min(max, min + width), value)
    * inverseRamp(Math.max(min, max - width), max, value);
}

function ramp(start: number, end: number, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!(end > start)) return value >= end ? 1 : 0;
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

function inverseRamp(start: number, end: number, value: number): number {
  return 1 - ramp(start, end, value);
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
