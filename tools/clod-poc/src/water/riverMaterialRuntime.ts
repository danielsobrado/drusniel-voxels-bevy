export interface RiverMaterialSettings {
  geometryThalwegDip: number;
  geometryBankLift: number;
  geometryRiffleStrength: number;
  geometrySideRiffleStrength: number;
  geometryMaxOffset: number;
  cascadeDropStart: number;
  cascadeDropEnd: number;
  cascadeStepStrength: number;
  cascadeRoughnessStrength: number;
  cascadeWhitewaterBoost: number;
  wetBankStrength: number;
  wetBankDistanceM: number;
  wetRockDarkening: number;
  foamResidueStrength: number;
  foamResidueDropStart: number;
  foamResidueDropEnd: number;
  bankNormalStrength: number;
  rapidScale: number;
  flowNormalStrength: number;
  crossCurrentStrength: number;
  rapidNormalBoost: number;
  bankFoamStrength: number;
  rapidFoamStrength: number;
  foamStreakStrength: number;
  shallowBankTintStrength: number;
  centerChannelDarkening: number;
}

export const DEFAULT_RIVER_MATERIAL_SETTINGS: RiverMaterialSettings = {
  geometryThalwegDip: 0.055,
  geometryBankLift: 0.034,
  geometryRiffleStrength: 0.045,
  geometrySideRiffleStrength: 0.022,
  geometryMaxOffset: 0.18,
  cascadeDropStart: 0.45,
  cascadeDropEnd: 2.2,
  cascadeStepStrength: 0.16,
  cascadeRoughnessStrength: 0.08,
  cascadeWhitewaterBoost: 1.65,
  wetBankStrength: 0.72,
  wetBankDistanceM: 5.5,
  wetRockDarkening: 0.42,
  foamResidueStrength: 0.58,
  foamResidueDropStart: 0.55,
  foamResidueDropEnd: 4.0,
  bankNormalStrength: 1.0,
  rapidScale: 0.5,
  flowNormalStrength: 1.4,
  crossCurrentStrength: 0.9,
  rapidNormalBoost: 1.35,
  bankFoamStrength: 0.45,
  rapidFoamStrength: 1.0,
  foamStreakStrength: 1.0,
  shallowBankTintStrength: 1.0,
  centerChannelDarkening: 1.0,
};

const PARAM_KEYS: Record<keyof RiverMaterialSettings, string> = {
  geometryThalwegDip: "riverGeomThalweg",
  geometryBankLift: "riverGeomBankLift",
  geometryRiffleStrength: "riverGeomRiffle",
  geometrySideRiffleStrength: "riverGeomSideRiffle",
  geometryMaxOffset: "riverGeomMaxOffset",
  cascadeDropStart: "riverCascadeDropStart",
  cascadeDropEnd: "riverCascadeDropEnd",
  cascadeStepStrength: "riverCascadeStep",
  cascadeRoughnessStrength: "riverCascadeRoughness",
  cascadeWhitewaterBoost: "riverCascadeWhitewater",
  wetBankStrength: "riverWetBank",
  wetBankDistanceM: "riverWetBankDistance",
  wetRockDarkening: "riverWetRockDarkening",
  foamResidueStrength: "riverFoamResidue",
  foamResidueDropStart: "riverFoamResidueDrop",
  foamResidueDropEnd: "riverFoamResidueDropEnd",
  bankNormalStrength: "riverBankNormal",
  rapidScale: "riverRapidScale",
  flowNormalStrength: "riverFlowNormal",
  crossCurrentStrength: "riverCrossCurrent",
  rapidNormalBoost: "riverRapidNormal",
  bankFoamStrength: "riverBankFoam",
  rapidFoamStrength: "riverRapidFoam",
  foamStreakStrength: "riverFoamStreak",
  shallowBankTintStrength: "riverShallowTint",
  centerChannelDarkening: "riverCenterDark",
};

function runtimeParams(): URLSearchParams | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
}

function readNumber(params: URLSearchParams | null, key: string, fallback: number): number {
  const raw = params?.get(key);
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeRiverMaterialSettings(settings: RiverMaterialSettings): RiverMaterialSettings {
  const d = DEFAULT_RIVER_MATERIAL_SETTINGS;
  const cascadeDropStart = clampFinite(settings.cascadeDropStart, 0, 8, d.cascadeDropStart);
  const cascadeDropEnd = Math.max(
    cascadeDropStart + 0.05,
    clampFinite(settings.cascadeDropEnd, 0.05, 16, d.cascadeDropEnd),
  );
  return {
    geometryThalwegDip: clampFinite(settings.geometryThalwegDip, 0, 0.35, d.geometryThalwegDip),
    geometryBankLift: clampFinite(settings.geometryBankLift, 0, 0.25, d.geometryBankLift),
    geometryRiffleStrength: clampFinite(settings.geometryRiffleStrength, 0, 0.30, d.geometryRiffleStrength),
    geometrySideRiffleStrength: clampFinite(settings.geometrySideRiffleStrength, 0, 0.20, d.geometrySideRiffleStrength),
    geometryMaxOffset: clampFinite(settings.geometryMaxOffset, 0, 0.60, d.geometryMaxOffset),
    cascadeDropStart,
    cascadeDropEnd,
    cascadeStepStrength: clampFinite(settings.cascadeStepStrength, 0, 0.60, d.cascadeStepStrength),
    cascadeRoughnessStrength: clampFinite(settings.cascadeRoughnessStrength, 0, 0.40, d.cascadeRoughnessStrength),
    cascadeWhitewaterBoost: clampFinite(settings.cascadeWhitewaterBoost, 0, 5, d.cascadeWhitewaterBoost),
    wetBankStrength: clampFinite(settings.wetBankStrength, 0, 2, d.wetBankStrength),
    wetBankDistanceM: clampFinite(settings.wetBankDistanceM, 0.5, 24, d.wetBankDistanceM),
    wetRockDarkening: clampFinite(settings.wetRockDarkening, 0, 1, d.wetRockDarkening),
    foamResidueStrength: clampFinite(settings.foamResidueStrength, 0, 2, d.foamResidueStrength),
    foamResidueDropStart: clampFinite(settings.foamResidueDropStart, 0, 8, d.foamResidueDropStart),
    foamResidueDropEnd: clampFinite(settings.foamResidueDropEnd, 0.05, 24, d.foamResidueDropEnd),
    bankNormalStrength: clampFinite(settings.bankNormalStrength, 0, 3, d.bankNormalStrength),
    rapidScale: clampFinite(settings.rapidScale, 0.02, 1.0, d.rapidScale),
    flowNormalStrength: clampFinite(settings.flowNormalStrength, 0, 4, d.flowNormalStrength),
    crossCurrentStrength: clampFinite(settings.crossCurrentStrength, 0, 4, d.crossCurrentStrength),
    rapidNormalBoost: clampFinite(settings.rapidNormalBoost, 0, 4, d.rapidNormalBoost),
    bankFoamStrength: clampFinite(settings.bankFoamStrength, 0, 3, d.bankFoamStrength),
    rapidFoamStrength: clampFinite(settings.rapidFoamStrength, 0, 3, d.rapidFoamStrength),
    foamStreakStrength: clampFinite(settings.foamStreakStrength, 0, 3, d.foamStreakStrength),
    shallowBankTintStrength: clampFinite(settings.shallowBankTintStrength, 0, 3, d.shallowBankTintStrength),
    centerChannelDarkening: clampFinite(settings.centerChannelDarkening, 0, 3, d.centerChannelDarkening),
  };
}

export function readRiverMaterialSettings(): RiverMaterialSettings {
  const params = runtimeParams();
  const d = DEFAULT_RIVER_MATERIAL_SETTINGS;
  return sanitizeRiverMaterialSettings({
    geometryThalwegDip: readNumber(params, PARAM_KEYS.geometryThalwegDip, d.geometryThalwegDip),
    geometryBankLift: readNumber(params, PARAM_KEYS.geometryBankLift, d.geometryBankLift),
    geometryRiffleStrength: readNumber(params, PARAM_KEYS.geometryRiffleStrength, d.geometryRiffleStrength),
    geometrySideRiffleStrength: readNumber(params, PARAM_KEYS.geometrySideRiffleStrength, d.geometrySideRiffleStrength),
    geometryMaxOffset: readNumber(params, PARAM_KEYS.geometryMaxOffset, d.geometryMaxOffset),
    cascadeDropStart: readNumber(params, PARAM_KEYS.cascadeDropStart, d.cascadeDropStart),
    cascadeDropEnd: readNumber(params, PARAM_KEYS.cascadeDropEnd, d.cascadeDropEnd),
    cascadeStepStrength: readNumber(params, PARAM_KEYS.cascadeStepStrength, d.cascadeStepStrength),
    cascadeRoughnessStrength: readNumber(params, PARAM_KEYS.cascadeRoughnessStrength, d.cascadeRoughnessStrength),
    cascadeWhitewaterBoost: readNumber(params, PARAM_KEYS.cascadeWhitewaterBoost, d.cascadeWhitewaterBoost),
    wetBankStrength: readNumber(params, PARAM_KEYS.wetBankStrength, d.wetBankStrength),
    wetBankDistanceM: readNumber(params, PARAM_KEYS.wetBankDistanceM, d.wetBankDistanceM),
    wetRockDarkening: readNumber(params, PARAM_KEYS.wetRockDarkening, d.wetRockDarkening),
    foamResidueStrength: readNumber(params, PARAM_KEYS.foamResidueStrength, d.foamResidueStrength),
    foamResidueDropStart: readNumber(params, PARAM_KEYS.foamResidueDropStart, d.foamResidueDropStart),
    foamResidueDropEnd: readNumber(params, PARAM_KEYS.foamResidueDropEnd, d.foamResidueDropEnd),
    bankNormalStrength: readNumber(params, PARAM_KEYS.bankNormalStrength, d.bankNormalStrength),
    rapidScale: readNumber(params, PARAM_KEYS.rapidScale, d.rapidScale),
    flowNormalStrength: readNumber(params, PARAM_KEYS.flowNormalStrength, d.flowNormalStrength),
    crossCurrentStrength: readNumber(params, PARAM_KEYS.crossCurrentStrength, d.crossCurrentStrength),
    rapidNormalBoost: readNumber(params, PARAM_KEYS.rapidNormalBoost, d.rapidNormalBoost),
    bankFoamStrength: readNumber(params, PARAM_KEYS.bankFoamStrength, d.bankFoamStrength),
    rapidFoamStrength: readNumber(params, PARAM_KEYS.rapidFoamStrength, d.rapidFoamStrength),
    foamStreakStrength: readNumber(params, PARAM_KEYS.foamStreakStrength, d.foamStreakStrength),
    shallowBankTintStrength: readNumber(params, PARAM_KEYS.shallowBankTintStrength, d.shallowBankTintStrength),
    centerChannelDarkening: readNumber(params, PARAM_KEYS.centerChannelDarkening, d.centerChannelDarkening),
  });
}

export function reloadWithRiverMaterialSettings(settings: RiverMaterialSettings): void {
  if (typeof window === "undefined") return;
  const sanitized = sanitizeRiverMaterialSettings(settings);
  const url = new URL(window.location.href);
  for (const [key, param] of Object.entries(PARAM_KEYS) as Array<[keyof RiverMaterialSettings, string]>) {
    url.searchParams.set(param, sanitized[key].toFixed(3));
  }
  window.location.assign(url.toString());
}
