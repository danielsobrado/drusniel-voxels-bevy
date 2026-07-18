import type { HydrologyGravelBarsConfig } from "./hydrologyConfig.js";
import { HYDROLOGY_BODY_RIVER, type HydrologySample } from "./hydrologyGrid.js";

const TAU = Math.PI * 2;
const UINT_SCALE = 1 / 0xffff_ffff;

export function gravelBarBodyPhase(bodyId: number): number {
  if (!Number.isFinite(bodyId) || bodyId <= 0) return 0;
  let value = Math.floor(bodyId) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) * UINT_SCALE;
}

export function gravelBarSeedPhase(seedSalt: number): number {
  return gravelBarBodyPhase((Number.isFinite(seedSalt) ? Math.floor(seedSalt) : 0) + 1);
}

export function evaluateGravelBarMask(
  x: number,
  z: number,
  sample: HydrologySample,
  config: HydrologyGravelBarsConfig,
): number {
  if (!config.enabled || config.strength <= 0) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !validSample(sample)) return 0;
  if (sample.bodyKind !== HYDROLOGY_BODY_RIVER || sample.bodyId <= 0) return 0;
  if (sample.bodyMask <= 0.02 || sample.depth <= 0) return 0;

  const flowLength = Math.hypot(sample.flowX, sample.flowZ);
  if (flowLength <= 1e-5) return 0;
  const directionX = sample.flowX / flowLength;
  const directionZ = sample.flowZ / flowLength;
  const along = (x * directionX + z * directionZ) / config.longitudinalPeriodM;
  const across = (x * -directionZ + z * directionX) / config.crossPeriodM;
  const phase = gravelBarBodyPhase(sample.bodyId) + gravelBarSeedPhase(config.seedSalt);

  const longitudinalWave = unitSin(along + phase);
  const sideWave = unitSin(across + along * 0.47 + phase * 1.73);
  const breakupWave = unitSin(along * 2.17 - across * 1.31 + phase * 3.11);
  const longitudinalGate = smoothRamp(config.patternStart, config.patternEnd, longitudinalWave);
  const sideGate = smoothRamp(0.42, 0.72, sideWave);
  const breakupGate = smoothRamp(0.22, 0.78, breakupWave);
  const pattern = longitudinalGate * sideGate * mix(1, breakupGate, config.breakupStrength);

  const shoreGate = softBand(sample.shoreDistance, config.minShoreDistanceM, config.maxShoreDistanceM);
  const depthGate = softBand(sample.depth, config.minDepthM, config.maxDepthM);
  const flowGate = softBand(sample.flowStrength, config.minFlowStrength, config.maxFlowStrength);

  return clamp01(
    config.strength
      * clamp01(sample.bodyMask)
      * pattern
      * shoreGate
      * depthGate
      * flowGate,
  );
}

function validSample(sample: HydrologySample): boolean {
  return Number.isFinite(sample.depth)
    && Number.isFinite(sample.bodyMask)
    && Number.isFinite(sample.flowX)
    && Number.isFinite(sample.flowZ)
    && Number.isFinite(sample.flowStrength)
    && Number.isFinite(sample.bodyKind)
    && Number.isFinite(sample.bodyId)
    && Number.isFinite(sample.shoreDistance);
}

function unitSin(value: number): number {
  return Math.sin(value * TAU) * 0.5 + 0.5;
}

function softBand(value: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(value) || !(maxValue > minValue)) return 0;
  const width = Math.max(0.001, (maxValue - minValue) * 0.25);
  return smoothRamp(minValue, Math.min(maxValue, minValue + width), value)
    * (1 - smoothRamp(Math.max(minValue, maxValue - width), maxValue, value));
}

function smoothRamp(start: number, end: number, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!(end > start)) return value >= end ? 1 : 0;
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * clamp01(amount);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
