import type { DressingClassId } from "../class_registry.js";

export interface GroundDebrisBiomePolicy {
  readonly autumnStrength: number;
  readonly frostStrength: number;
  readonly dewStrength: number;
}

const POLICIES = Object.freeze({
  leaf_litter: policy(0.42, 0.30, 0.72),
  needle_litter: policy(0.24, 0.28, 0.62),
  twig_cluster: policy(0.18, 0.22, 0.48),
  bark_chip_cluster: policy(0.16, 0.20, 0.45),
  small_talus: policy(0, 0.36, 0.38),
  river_cobbles: policy(0, 0.42, 0.72),
  wet_stone_cluster: policy(0, 0.46, 1),
} satisfies Partial<Record<DressingClassId, GroundDebrisBiomePolicy>>);

export function groundDebrisBiomePolicy(
  classId: DressingClassId,
): GroundDebrisBiomePolicy | null {
  return POLICIES[classId as keyof typeof POLICIES] ?? null;
}

export function groundDebrisCombinedWetness(
  instanceWetness: number,
  biomeDew: number,
  policyValue: GroundDebrisBiomePolicy,
): number {
  return Math.max(clamp01(instanceWetness), clamp01(biomeDew) * policyValue.dewStrength);
}

export function groundDebrisFrostAmount(
  biomeFrost: number,
  altitudeSnow: number,
  policyValue: GroundDebrisBiomePolicy,
): number {
  return Math.max(clamp01(biomeFrost), clamp01(altitudeSnow)) * policyValue.frostStrength;
}

function policy(
  autumnStrength: number,
  frostStrength: number,
  dewStrength: number,
): GroundDebrisBiomePolicy {
  return Object.freeze({
    autumnStrength: clamp01(autumnStrength),
    frostStrength: clamp01(frostStrength),
    dewStrength: clamp01(dewStrength),
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
