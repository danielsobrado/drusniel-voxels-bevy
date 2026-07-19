import type { HydrologyGravelBarsConfig } from "./hydrologyConfig.js";
import type { HydrologySample } from "./hydrologyGrid.js";
import { evaluateGravelBarMask } from "./gravel_bar_field.js";

const ELEVATION_EPSILON_M = 1e-5;

export interface GravelBarBedConfig {
  readonly enabled: boolean;
  readonly maxElevationM: number;
  readonly minWetDepthM: number;
  readonly continuityReserveM: number;
  readonly bankClearanceM: number;
}

export const DEFAULT_GRAVEL_BAR_BED_CONFIG: GravelBarBedConfig = {
  enabled: false,
  maxElevationM: 0.7,
  minWetDepthM: 0.18,
  continuityReserveM: 0.32,
  bankClearanceM: 0.12,
};

export type GravelBarBedRejection =
  | "disabled"
  | "not_candidate"
  | "depth"
  | "continuity"
  | "bank";

export interface GravelBarBedSafety {
  readonly localBankY?: number;
  readonly channelCenterWeight?: number;
}

export interface GravelBarBedDecision {
  readonly mask: number;
  readonly desiredElevationM: number;
  readonly elevationOffsetM: number;
  readonly rejection: GravelBarBedRejection | null;
}

export interface GravelBarBedCounters {
  candidates: number;
  accepted: number;
  rejectedDepth: number;
  rejectedContinuity: number;
  rejectedBank: number;
  maxElevationM: number;
}

export function createGravelBarBedCounters(): GravelBarBedCounters {
  return {
    candidates: 0,
    accepted: 0,
    rejectedDepth: 0,
    rejectedContinuity: 0,
    rejectedBank: 0,
    maxElevationM: 0,
  };
}

export function recordGravelBarBedDecision(
  counters: GravelBarBedCounters,
  decision: GravelBarBedDecision,
): void {
  if (decision.mask <= 0 || decision.rejection === "disabled") return;
  counters.candidates += 1;
  if (decision.elevationOffsetM > ELEVATION_EPSILON_M) {
    counters.accepted += 1;
    counters.maxElevationM = Math.max(counters.maxElevationM, decision.elevationOffsetM);
    return;
  }
  if (decision.rejection === "depth") counters.rejectedDepth += 1;
  else if (decision.rejection === "continuity") counters.rejectedContinuity += 1;
  else if (decision.rejection === "bank") counters.rejectedBank += 1;
}

export function evaluateGravelBarBedElevation(
  x: number,
  z: number,
  sample: HydrologySample,
  fieldConfig: HydrologyGravelBarsConfig,
  bedConfig: GravelBarBedConfig,
  safety: GravelBarBedSafety = {},
): GravelBarBedDecision {
  const mask = evaluateGravelBarMask(x, z, sample, fieldConfig);
  const maxElevationM = nonNegativeFinite(bedConfig.maxElevationM);
  const minWetDepthM = nonNegativeFinite(bedConfig.minWetDepthM);
  const continuityReserveM = nonNegativeFinite(bedConfig.continuityReserveM);
  const bankClearanceM = nonNegativeFinite(bedConfig.bankClearanceM);
  if (!bedConfig.enabled || maxElevationM <= 0) {
    return decision(mask, 0, 0, "disabled");
  }
  if (mask <= 0) return decision(0, 0, 0, "not_candidate");

  const desiredElevationM = mask * maxElevationM;
  const baseBedY = sample.terrainY;
  const waterY = sample.waterY;
  if (!Number.isFinite(baseBedY) || !Number.isFinite(waterY)) {
    return decision(mask, desiredElevationM, 0, "depth");
  }

  const depthCeilingY = waterY - minWetDepthM;
  if (depthCeilingY <= baseBedY + ELEVATION_EPSILON_M) {
    return decision(mask, desiredElevationM, 0, "depth");
  }

  const centerWeight = smoothRamp(
    0.55,
    0.95,
    safety.channelCenterWeight ?? sample.bodyMask,
  );
  const continuityCeilingY = waterY
    - minWetDepthM
    - continuityReserveM * centerWeight;
  if (continuityCeilingY <= baseBedY + ELEVATION_EPSILON_M) {
    return decision(mask, desiredElevationM, 0, "continuity");
  }

  const localBankY = safety.localBankY;
  const bankCeilingY = typeof localBankY === "number" && Number.isFinite(localBankY)
    ? localBankY - bankClearanceM
    : Number.POSITIVE_INFINITY;
  if (bankCeilingY <= baseBedY + ELEVATION_EPSILON_M) {
    return decision(mask, desiredElevationM, 0, "bank");
  }

  const ceilingY = Math.min(depthCeilingY, continuityCeilingY, bankCeilingY);
  const elevationOffsetM = Math.max(0, Math.min(desiredElevationM, ceilingY - baseBedY));
  if (elevationOffsetM <= ELEVATION_EPSILON_M) {
    return decision(
      mask,
      desiredElevationM,
      0,
      limitingRejection(depthCeilingY, continuityCeilingY, bankCeilingY),
    );
  }
  return decision(mask, desiredElevationM, elevationOffsetM, null);
}

function decision(
  mask: number,
  desiredElevationM: number,
  elevationOffsetM: number,
  rejection: GravelBarBedRejection | null,
): GravelBarBedDecision {
  return { mask, desiredElevationM, elevationOffsetM, rejection };
}

function limitingRejection(
  depthCeilingY: number,
  continuityCeilingY: number,
  bankCeilingY: number,
): GravelBarBedRejection {
  if (depthCeilingY <= continuityCeilingY && depthCeilingY <= bankCeilingY) return "depth";
  if (continuityCeilingY <= bankCeilingY) return "continuity";
  return "bank";
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function smoothRamp(start: number, end: number, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!(end > start)) return value >= end ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}
