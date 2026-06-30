export interface RiverCascadeParticleSettings {
  enabled: boolean;
  mistStrength: number;
  splashStrength: number;
  foamDriftStrength: number;
  spawnRadiusM: number;
  maxEmittersPerTick: number;
  rapidSpeedStart: number;
  rapidSpeedEnd: number;
  dropStart: number;
  dropEnd: number;
}

export const DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS: RiverCascadeParticleSettings = {
  enabled: true,
  mistStrength: 0.58,
  splashStrength: 0.95,
  foamDriftStrength: 0.72,
  spawnRadiusM: 72,
  maxEmittersPerTick: 24,
  rapidSpeedStart: 0.72,
  rapidSpeedEnd: 1.75,
  dropStart: 0.78,
  dropEnd: 4.4,
};

const PARAM_KEYS: Record<keyof RiverCascadeParticleSettings, string> = {
  enabled: "riverCascadeParticles",
  mistStrength: "riverCascadeMist",
  splashStrength: "riverCascadeSplash",
  foamDriftStrength: "riverCascadeFoamDrift",
  spawnRadiusM: "riverCascadeParticleRadius",
  maxEmittersPerTick: "riverCascadeParticleEmitters",
  rapidSpeedStart: "riverCascadeRapidSpeedStart",
  rapidSpeedEnd: "riverCascadeRapidSpeedEnd",
  dropStart: "riverCascadeParticleDropStart",
  dropEnd: "riverCascadeParticleDropEnd",
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

function readBoolean(params: URLSearchParams | null, key: string, fallback: boolean): boolean {
  const raw = params?.get(key);
  if (raw === null || raw === undefined) return fallback;
  return raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : fallback;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  return Math.floor(clampFinite(value, min, max, fallback));
}

export function sanitizeRiverCascadeParticleSettings(
  settings: RiverCascadeParticleSettings,
): RiverCascadeParticleSettings {
  const d = DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS;
  const rapidSpeedStart = clampFinite(settings.rapidSpeedStart, 0.05, 8, d.rapidSpeedStart);
  const rapidSpeedEnd = Math.max(
    rapidSpeedStart + 0.05,
    clampFinite(settings.rapidSpeedEnd, 0.10, 12, d.rapidSpeedEnd),
  );
  const dropStart = clampFinite(settings.dropStart, 0, 12, d.dropStart);
  const dropEnd = Math.max(
    dropStart + 0.05,
    clampFinite(settings.dropEnd, 0.05, 24, d.dropEnd),
  );
  return {
    enabled: settings.enabled,
    mistStrength: clampFinite(settings.mistStrength, 0, 3, d.mistStrength),
    splashStrength: clampFinite(settings.splashStrength, 0, 3, d.splashStrength),
    foamDriftStrength: clampFinite(settings.foamDriftStrength, 0, 3, d.foamDriftStrength),
    spawnRadiusM: clampFinite(settings.spawnRadiusM, 16, 180, d.spawnRadiusM),
    maxEmittersPerTick: clampInteger(settings.maxEmittersPerTick, 4, 80, d.maxEmittersPerTick),
    rapidSpeedStart,
    rapidSpeedEnd,
    dropStart,
    dropEnd,
  };
}

export function readRiverCascadeParticleSettings(): RiverCascadeParticleSettings {
  const params = runtimeParams();
  const d = DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS;
  return sanitizeRiverCascadeParticleSettings({
    enabled: readBoolean(params, PARAM_KEYS.enabled, d.enabled),
    mistStrength: readNumber(params, PARAM_KEYS.mistStrength, d.mistStrength),
    splashStrength: readNumber(params, PARAM_KEYS.splashStrength, d.splashStrength),
    foamDriftStrength: readNumber(params, PARAM_KEYS.foamDriftStrength, d.foamDriftStrength),
    spawnRadiusM: readNumber(params, PARAM_KEYS.spawnRadiusM, d.spawnRadiusM),
    maxEmittersPerTick: readNumber(params, PARAM_KEYS.maxEmittersPerTick, d.maxEmittersPerTick),
    rapidSpeedStart: readNumber(params, PARAM_KEYS.rapidSpeedStart, d.rapidSpeedStart),
    rapidSpeedEnd: readNumber(params, PARAM_KEYS.rapidSpeedEnd, d.rapidSpeedEnd),
    dropStart: readNumber(params, PARAM_KEYS.dropStart, d.dropStart),
    dropEnd: readNumber(params, PARAM_KEYS.dropEnd, d.dropEnd),
  });
}

export function reloadWithRiverCascadeParticleSettings(settings: RiverCascadeParticleSettings): void {
  if (typeof window === "undefined") return;
  const sanitized = sanitizeRiverCascadeParticleSettings(settings);
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM_KEYS.enabled, sanitized.enabled ? "1" : "0");
  url.searchParams.set(PARAM_KEYS.mistStrength, sanitized.mistStrength.toFixed(3));
  url.searchParams.set(PARAM_KEYS.splashStrength, sanitized.splashStrength.toFixed(3));
  url.searchParams.set(PARAM_KEYS.foamDriftStrength, sanitized.foamDriftStrength.toFixed(3));
  url.searchParams.set(PARAM_KEYS.spawnRadiusM, sanitized.spawnRadiusM.toFixed(1));
  url.searchParams.set(PARAM_KEYS.maxEmittersPerTick, String(sanitized.maxEmittersPerTick));
  url.searchParams.set(PARAM_KEYS.rapidSpeedStart, sanitized.rapidSpeedStart.toFixed(3));
  url.searchParams.set(PARAM_KEYS.rapidSpeedEnd, sanitized.rapidSpeedEnd.toFixed(3));
  url.searchParams.set(PARAM_KEYS.dropStart, sanitized.dropStart.toFixed(3));
  url.searchParams.set(PARAM_KEYS.dropEnd, sanitized.dropEnd.toFixed(3));
  window.location.assign(url.toString());
}
