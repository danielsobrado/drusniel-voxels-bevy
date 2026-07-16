export interface ResidencySnapshot {
  readonly clodCachedKeys: readonly string[];
  readonly farSummaryResidentKeys: readonly string[];
  readonly heightfieldResidentKeys: readonly string[];
  readonly vegetationClusterKeys: readonly string[] | null;
  readonly waterHydrologyKeys: readonly string[] | null;
}

export interface EvictionCategoryEvidence {
  readonly available: boolean;
  readonly targetKeys: readonly string[];
  readonly remainingKeys: readonly string[];
  readonly passed: boolean;
}

export interface RevisitEvictionEvidence {
  readonly clod: EvictionCategoryEvidence;
  readonly farSummary: EvictionCategoryEvidence;
  readonly heightfield: EvictionCategoryEvidence;
  readonly vegetation: EvictionCategoryEvidence;
  readonly waterHydrology: EvictionCategoryEvidence;
  readonly failures: readonly string[];
  readonly passed: boolean;
}

function category(
  name: string,
  startKeys: readonly string[] | null,
  beforeReturnKeys: readonly string[] | null,
  options: { required: boolean; filter?: (key: string) => boolean },
): { evidence: EvictionCategoryEvidence; failure: string | null } {
  const available = startKeys !== null && beforeReturnKeys !== null;
  if (!available) {
    return {
      evidence: { available: false, targetKeys: [], remainingKeys: [], passed: !options.required },
      failure: options.required ? `${name}: stable residency keys are unavailable` : null,
    };
  }
  const targetKeys = [...new Set(startKeys.filter(options.filter ?? (() => true)))].sort();
  const beforeReturn = new Set(beforeReturnKeys);
  const remainingKeys = targetKeys.filter((key) => beforeReturn.has(key));
  const passed = targetKeys.length > 0 && remainingKeys.length === 0;
  const failure = targetKeys.length === 0
    ? `${name}: no target keys were resident at route A`
    : remainingKeys.length > 0
      ? `${name}: ${remainingKeys.length}/${targetKeys.length} route-A target keys remained resident before return`
      : null;
  return { evidence: { available, targetKeys, remainingKeys, passed }, failure };
}

export function evaluateRevisitEviction(
  atRouteA: ResidencySnapshot,
  beforeReturn: ResidencySnapshot,
): RevisitEvictionEvidence {
  const clod = category("CLOD pages", atRouteA.clodCachedKeys, beforeReturn.clodCachedKeys, { required: true });
  const farSummary = category(
    "far-summary tiles",
    atRouteA.farSummaryResidentKeys,
    beforeReturn.farSummaryResidentKeys,
    { required: true, filter: (key) => key.startsWith("r0_") },
  );
  const heightfield = category("heightfield tiles", atRouteA.heightfieldResidentKeys, beforeReturn.heightfieldResidentKeys, { required: true });
  const vegetation = category("vegetation clusters", atRouteA.vegetationClusterKeys, beforeReturn.vegetationClusterKeys, { required: true });
  // Hydrology is explicitly record-either-way in LM4; absence is evidence, not a false pass claim.
  const waterHydrology = category("water/hydrology", atRouteA.waterHydrologyKeys, beforeReturn.waterHydrologyKeys, { required: false });
  const failures = [clod.failure, farSummary.failure, heightfield.failure, vegetation.failure, waterHydrology.failure]
    .filter((failure): failure is string => failure !== null);
  return {
    clod: clod.evidence,
    farSummary: farSummary.evidence,
    heightfield: heightfield.evidence,
    vegetation: vegetation.evidence,
    waterHydrology: waterHydrology.evidence,
    failures,
    passed: failures.length === 0,
  };
}
