export interface RiverMaterialSettings {
  geometryThalwegDip: number;
  geometryBankLift: number;
  geometryRiffleStrength: number;
  geometrySideRiffleStrength: number;
  geometryMaxOffset: number;
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
  return {
    geometryThalwegDip: clampFinite(settings.geometryThalwegDip, 0, 0.35, d.geometryThalwegDip),
    geometryBankLift: clampFinite(settings.geometryBankLift, 0, 0.25, d.geometryBankLift),
    geometryRiffleStrength: clampFinite(settings.geometryRiffleStrength, 0, 0.30, d.geometryRiffleStrength),
    geometrySideRiffleStrength: clampFinite(settings.geometrySideRiffleStrength, 0, 0.20, d.geometrySideRiffleStrength),
    geometryMaxOffset: clampFinite(settings.geometryMaxOffset, 0, 0.60, d.geometryMaxOffset),
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
