import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import type { EnvironmentQuery } from "../environment_query/types.js";
import {
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_MARSH,
  HYDROLOGY_BODY_POND,
  HYDROLOGY_BODY_RIVER,
} from "../water/hydrologyGrid.js";
import type {
  EnvironmentalMaskMeta,
  EnvironmentalMaskSample,
  EnvironmentalMaskSettings,
} from "./environment_mask_types.js";

export interface EnvironmentalMaskEvaluationInput {
  readonly query: EnvironmentQuery;
  readonly settings: EnvironmentalMaskSettings;
  readonly biome: BiomeVisualState;
  readonly x: number;
  readonly z: number;
  readonly hintM?: number;
}

export function evaluateEnvironmentalMasks(input: EnvironmentalMaskEvaluationInput): EnvironmentalMaskSample {
  const hintM = input.hintM;
  const water = input.query.water(input.x, input.z, hintM);
  const river = input.query.river(input.x, input.z, hintM);
  const normal = input.query.surfaceNormal(input.x, input.z, hintM);
  const visibility = input.query.visibility(input.x, input.z, hintM);
  const validity = Object.freeze({
    water: water.meta.valid,
    river: river.meta.valid,
    normal: normal.meta.valid,
    visibility: visibility.meta.valid,
  });
  const meta: EnvironmentalMaskMeta = Object.freeze({
    cellSizeM: Math.max(water.meta.cellSizeM, river.meta.cellSizeM, normal.meta.cellSizeM, visibility.meta.cellSizeM),
    revision: Math.max(water.meta.revision, river.meta.revision, normal.meta.revision, visibility.meta.revision),
    validity,
    water: water.meta,
    river: river.meta,
    normal: normal.meta,
    visibility: visibility.meta,
  });

  if (!input.settings.enabled || !input.biome.enabled) return zeroSample(meta);

  const wet = water.meta.valid ? clamp01(water.wetMask) : 0;
  const isRiver = water.bodyKind === HYDROLOGY_BODY_RIVER ? 1 : 0;
  const isCalmBody = water.bodyKind === HYDROLOGY_BODY_LAKE
    || water.bodyKind === HYDROLOGY_BODY_POND
    || water.bodyKind === HYDROLOGY_BODY_MARSH
    ? 1
    : 0;
  const flow = river.meta.valid ? nonNegative(river.flowStrength) : 0;
  const drop = river.meta.valid ? nonNegative(Math.abs(river.bedDrop)) : 0;
  const shore = water.meta.valid ? nonNegative(water.shoreDistanceM) : Number.POSITIVE_INFINITY;
  const sunVisibility = visibility.meta.valid ? clamp01(visibility.sunVisibility) : 0;

  const riverCobble = maskEnabled(input.settings.riverCobble.enabled, () => {
    if (!water.meta.valid || !river.meta.valid || !normal.meta.valid) return 0;
    const config = input.settings.riverCobble;
    return config.strength
      * wet
      * isRiver
      * softBand(water.depth, config.minDepthM, config.maxDepthM)
      * softBand(flow, config.minFlowStrength, config.maxFlowStrength)
      * inverseRamp(config.maxShoreDistanceM * 0.65, config.maxShoreDistanceM, shore)
      * ramp(config.minNormalY, Math.min(1, config.minNormalY + 0.16), normal.y);
  });

  const riverMist = maskEnabled(input.settings.riverMist.enabled, () => {
    if (!water.meta.valid || !river.meta.valid) return 0;
    const config = input.settings.riverMist;
    return config.strength
      * wet
      * isRiver
      * clamp01(input.biome.morningMist)
      * ramp(config.minFlowStrength, config.minFlowStrength * 3 + 0.001, flow)
      * inverseRamp(config.maxShoreDistanceM * 0.55, config.maxShoreDistanceM, shore);
  });

  const rapidSplash = maskEnabled(input.settings.rapidSplash.enabled, () => {
    if (!water.meta.valid || !river.meta.valid) return 0;
    const config = input.settings.rapidSplash;
    const configuredRapid = clamp01(river.rapidMask);
    const derivedRapid = clamp01(
      ramp(config.flowStart, config.flowEnd, flow) * 0.58
      + ramp(config.bedDropStart, config.bedDropEnd, drop) * 0.72,
    );
    return config.strength * wet * isRiver * Math.max(configuredRapid, derivedRapid);
  });

  const sunbeamMote = maskEnabled(input.settings.sunbeamMote.enabled, () => {
    if (!visibility.meta.valid) return 0;
    const config = input.settings.sunbeamMote;
    const airborneAmount = Math.max(input.biome.morningMist, input.biome.pollenAmount * 0.45);
    return config.strength
      * clamp01(airborneAmount)
      * ramp(config.visibilityStart, config.visibilityEnd, sunVisibility);
  });

  const calmPool = maskEnabled(input.settings.calmPool.enabled, () => {
    if (!water.meta.valid || !river.meta.valid) return 0;
    const config = input.settings.calmPool;
    return config.strength
      * wet
      * isCalmBody
      * ramp(config.minDepthM, config.minDepthM * 2 + 0.001, water.depth)
      * inverseRamp(config.maxFlowStrength * 0.35, config.maxFlowStrength, flow);
  });

  const frost = maskEnabled(input.settings.frost.enabled, () => {
    if (!visibility.meta.valid) return 0;
    const config = input.settings.frost;
    const shade = inverseRamp(config.visibilityStart, config.visibilityEnd, sunVisibility);
    const wetnessGate = 1 - clamp01(input.biome.wetness) * config.wetnessSuppression;
    return config.strength * clamp01(input.biome.frostAmount) * shade * clamp01(wetnessGate);
  });

  const dew = maskEnabled(input.settings.dew.enabled, () => {
    const config = input.settings.dew;
    const wetness = ramp(config.wetnessStart, config.wetnessEnd, input.biome.wetness);
    const shadeBoost = visibility.meta.valid ? 0.65 + 0.35 * (1 - sunVisibility) : 1;
    return config.strength * wetness * clamp01(input.biome.green) * shadeBoost;
  });

  const shoreDebris = maskEnabled(input.settings.shoreDebris.enabled, () => {
    if (!water.meta.valid || !river.meta.valid) return 0;
    const config = input.settings.shoreDebris;
    const shoreBand = softBand(shore, config.shoreStartM, config.shoreEndM);
    const flowGate = inverseRamp(config.maxFlowStrength * 0.45, config.maxFlowStrength, flow);
    return config.strength * shoreBand * flowGate;
  });

  return Object.freeze({
    riverCobble: clamp01(riverCobble),
    riverMist: clamp01(riverMist),
    rapidSplash: clamp01(rapidSplash),
    sunbeamMote: clamp01(sunbeamMote),
    calmPool: clamp01(calmPool),
    frost: clamp01(frost),
    dew: clamp01(dew),
    shoreDebris: clamp01(shoreDebris),
    meta,
  });
}

function zeroSample(meta: EnvironmentalMaskMeta): EnvironmentalMaskSample {
  return Object.freeze({
    riverCobble: 0,
    riverMist: 0,
    rapidSplash: 0,
    sunbeamMote: 0,
    calmPool: 0,
    frost: 0,
    dew: 0,
    shoreDebris: 0,
    meta,
  });
}

function maskEnabled(enabled: boolean, evaluate: () => number): number {
  return enabled ? evaluate() : 0;
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
