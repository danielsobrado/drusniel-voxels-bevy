import { load } from "js-yaml";
import {
  PROBE_GI_CASCADE_IDS,
  PROBE_GI_DIMENSIONS,
  PROBE_GI_FIXED_CASCADES,
  PROBE_GI_SCHEMA_VERSION,
} from "./constants.js";
import type {
  ProbeGiCascadeConfig,
  ProbeGiConfig,
  ProbeGiDebugMode,
  ProbeGiDimensions,
  ProbeGiQualityPreset,
  ProbeGiVec3,
} from "./types.js";

const ROOT_KEYS = new Set(["probe_gi"]);
const CONFIG_KEYS = new Set([
  "schema_version",
  "enabled",
  "quality_presets",
  "lighting_change_boost_frames",
  "history_blend",
  "boosted_history_blend",
  "ray_spread",
  "hemisphere_floor_strength",
  "screen_space_bounce_max_fraction",
  "cascades",
  "canopy",
  "relocation",
  "positioning",
  "dynamic_proxies",
  "debug",
]);
const QUALITY_KEYS = new Set(["rays_per_probe", "probes_per_frame", "boosted_probes_per_frame"]);
const CASCADE_KEYS = new Set([
  "id",
  "dimensions",
  "spacing_m",
  "layer_heights_m",
  "maximum_trace_distance_m",
  "purpose_bias",
]);
const CANOPY_KEYS = new Set(["sigma_rgb", "transmitted_rgb", "transmitted_energy_cap"]);
const RELOCATION_KEYS = new Set(["enabled", "maximum_spacing_fraction", "invalid_after_failed_axes"]);
const POSITIONING_KEYS = new Set(["max_ms_per_frame", "max_columns_per_frame", "unknown_retry_frames"]);
const PROXY_KEYS = new Set(["update_hz", "near_cascade_only"]);
const DEBUG_KEYS = new Set(["enabled", "mode", "freeze_updates"]);
export const PROBE_GI_DEBUG_MODES = new Set<ProbeGiDebugMode>([
  "positions",
  "validity",
  "age",
  "cascade",
  "relocation",
  "irradiance",
  "sh_lobe",
  "first_hit",
  "unknown",
  "canopy_extinction",
]);

export function parseProbeGiConfig(text: string): ProbeGiConfig {
  const document = asObject(load(text), "probe GI YAML root");
  assertKnownKeys(document, ROOT_KEYS, "probe GI YAML root");
  const raw = asObject(document.probe_gi, "probe_gi");
  assertKnownKeys(raw, CONFIG_KEYS, "probe_gi");

  const cascadesRaw = asArray(raw.cascades, "probe_gi.cascades");
  if (cascadesRaw.length !== PROBE_GI_CASCADE_IDS.length) {
    throw new Error(`probe_gi.cascades must contain exactly ${PROBE_GI_CASCADE_IDS.length} entries`);
  }
  const cascades = cascadesRaw.map((entry, index) => parseCascade(entry, index));

  return {
    schemaVersion: integer(raw.schema_version, "probe_gi.schema_version", PROBE_GI_SCHEMA_VERSION),
    enabled: boolean(raw.enabled, "probe_gi.enabled"),
    qualityPresets: parseQualityPresets(raw.quality_presets),
    lightingChangeBoostFrames: positiveInteger(raw.lighting_change_boost_frames, "probe_gi.lighting_change_boost_frames"),
    historyBlend: fraction(raw.history_blend, "probe_gi.history_blend"),
    boostedHistoryBlend: fraction(raw.boosted_history_blend, "probe_gi.boosted_history_blend"),
    raySpread: positive(raw.ray_spread, "probe_gi.ray_spread"),
    hemisphereFloorStrength: fraction(raw.hemisphere_floor_strength, "probe_gi.hemisphere_floor_strength"),
    screenSpaceBounceMaxFraction: fraction(raw.screen_space_bounce_max_fraction, "probe_gi.screen_space_bounce_max_fraction"),
    cascades,
    canopy: parseCanopy(raw.canopy),
    relocation: parseRelocation(raw.relocation),
    positioning: parsePositioning(raw.positioning),
    dynamicProxies: parseDynamicProxies(raw.dynamic_proxies),
    debug: parseDebug(raw.debug),
  };
}

function parseQualityPresets(value: unknown): ProbeGiConfig["qualityPresets"] {
  const raw = asObject(value, "probe_gi.quality_presets");
  assertKnownKeys(raw, new Set(["ultra", "balanced", "perf", "potato"]), "probe_gi.quality_presets");
  return {
    ultra: parseQuality(raw.ultra, "ultra"),
    balanced: parseQuality(raw.balanced, "balanced"),
    perf: parseQuality(raw.perf, "perf"),
    potato: parseQuality(raw.potato, "potato"),
  };
}

function parseQuality(value: unknown, id: string): ProbeGiQualityPreset {
  const raw = asObject(value, `probe_gi.quality_presets.${id}`);
  assertKnownKeys(raw, QUALITY_KEYS, `probe_gi.quality_presets.${id}`);
  return {
    raysPerProbe: positiveInteger(raw.rays_per_probe, `${id}.rays_per_probe`),
    probesPerFrame: positiveInteger(raw.probes_per_frame, `${id}.probes_per_frame`),
    boostedProbesPerFrame: positiveInteger(raw.boosted_probes_per_frame, `${id}.boosted_probes_per_frame`),
  };
}

function parseCascade(value: unknown, index: number): ProbeGiCascadeConfig {
  const raw = asObject(value, `probe_gi.cascades[${index}]`);
  assertKnownKeys(raw, CASCADE_KEYS, `probe_gi.cascades[${index}]`);
  const expectedId = PROBE_GI_CASCADE_IDS[index];
  if (raw.id !== expectedId) throw new Error(`probe_gi.cascades[${index}].id must be ${expectedId}`);
  const dimensions = tuple3(raw.dimensions, `probe_gi.cascades[${index}].dimensions`, true);
  if (dimensions.some((value, axis) => value !== PROBE_GI_DIMENSIONS[axis])) {
    throw new Error(`probe_gi.cascades[${index}].dimensions must be [32, 8, 32]`);
  }
  const layerHeightsM = numberArray(raw.layer_heights_m, `probe_gi.cascades[${index}].layer_heights_m`);
  if (layerHeightsM.length !== dimensions[1]) {
    throw new Error(`probe_gi.cascades[${index}].layer_heights_m must match Y dimension`);
  }
  assertStrictlyIncreasing(layerHeightsM, `probe_gi.cascades[${index}].layer_heights_m`);
  const spacingM = positive(raw.spacing_m, `probe_gi.cascades[${index}].spacing_m`);
  const maximumTraceDistanceM = positive(raw.maximum_trace_distance_m, `probe_gi.cascades[${index}].maximum_trace_distance_m`);
  const purposeBias = finite(raw.purpose_bias, `probe_gi.cascades[${index}].purpose_bias`);
  const fixed = PROBE_GI_FIXED_CASCADES[index];
  if (
    spacingM !== fixed.spacingM
    || maximumTraceDistanceM !== fixed.maximumTraceDistanceM
    || purposeBias !== fixed.purposeBias
    || !sameNumbers(layerHeightsM, fixed.layerHeightsM)
  ) {
    throw new Error(`probe_gi.cascades[${index}] does not match the fixed ${expectedId} architecture`);
  }
  return {
    id: expectedId,
    dimensions,
    spacingM,
    layerHeightsM,
    maximumTraceDistanceM,
    purposeBias,
  };
}

function parseCanopy(value: unknown): ProbeGiConfig["canopy"] {
  const raw = asObject(value, "probe_gi.canopy");
  assertKnownKeys(raw, CANOPY_KEYS, "probe_gi.canopy");
  return {
    sigmaRgb: tuple3(raw.sigma_rgb, "probe_gi.canopy.sigma_rgb", false),
    transmittedRgb: tuple3(raw.transmitted_rgb, "probe_gi.canopy.transmitted_rgb", false),
    transmittedEnergyCap: fraction(raw.transmitted_energy_cap, "probe_gi.canopy.transmitted_energy_cap"),
  };
}

function parseRelocation(value: unknown): ProbeGiConfig["relocation"] {
  const raw = asObject(value, "probe_gi.relocation");
  assertKnownKeys(raw, RELOCATION_KEYS, "probe_gi.relocation");
  const invalidAfterFailedAxes = positiveInteger(raw.invalid_after_failed_axes, "probe_gi.relocation.invalid_after_failed_axes");
  if (invalidAfterFailedAxes !== 6) throw new Error("probe_gi.relocation.invalid_after_failed_axes must be 6");
  return {
    enabled: boolean(raw.enabled, "probe_gi.relocation.enabled"),
    maximumSpacingFraction: fraction(raw.maximum_spacing_fraction, "probe_gi.relocation.maximum_spacing_fraction"),
    invalidAfterFailedAxes,
  };
}

function parsePositioning(value: unknown): ProbeGiConfig["positioning"] {
  const raw = asObject(value, "probe_gi.positioning");
  assertKnownKeys(raw, POSITIONING_KEYS, "probe_gi.positioning");
  return {
    maxMsPerFrame: positive(raw.max_ms_per_frame, "probe_gi.positioning.max_ms_per_frame"),
    maxColumnsPerFrame: positiveInteger(raw.max_columns_per_frame, "probe_gi.positioning.max_columns_per_frame"),
    unknownRetryFrames: positiveInteger(raw.unknown_retry_frames, "probe_gi.positioning.unknown_retry_frames"),
  };
}

function parseDynamicProxies(value: unknown): ProbeGiConfig["dynamicProxies"] {
  const raw = asObject(value, "probe_gi.dynamic_proxies");
  assertKnownKeys(raw, PROXY_KEYS, "probe_gi.dynamic_proxies");
  return {
    updateHz: positive(raw.update_hz, "probe_gi.dynamic_proxies.update_hz"),
    nearCascadeOnly: boolean(raw.near_cascade_only, "probe_gi.dynamic_proxies.near_cascade_only"),
  };
}

function parseDebug(value: unknown): ProbeGiConfig["debug"] {
  const raw = asObject(value, "probe_gi.debug");
  assertKnownKeys(raw, DEBUG_KEYS, "probe_gi.debug");
  const mode = raw.mode;
  if (typeof mode !== "string" || !PROBE_GI_DEBUG_MODES.has(mode as ProbeGiDebugMode)) {
    throw new Error(`probe_gi.debug.mode is invalid: ${String(mode)}`);
  }
  return {
    enabled: boolean(raw.enabled, "probe_gi.debug.enabled"),
    mode: mode as ProbeGiDebugMode,
    freezeUpdates: boolean(raw.freeze_updates, "probe_gi.debug.freeze_updates"),
  };
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function assertKnownKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new Error(`${path} contains unknown key: ${key}`);
  }
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be finite`);
  return value;
}

function positive(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result <= 0) throw new Error(`${path} must be > 0`);
  return result;
}

function integer(value: unknown, path: string, expected?: number): number {
  const result = finite(value, path);
  if (!Number.isInteger(result)) throw new Error(`${path} must be an integer`);
  if (expected !== undefined && result !== expected) throw new Error(`${path} must be ${expected}`);
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  const result = integer(value, path);
  if (result <= 0) throw new Error(`${path} must be > 0`);
  return result;
}

function fraction(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0 || result > 1) throw new Error(`${path} must be within [0, 1]`);
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
  return value;
}

function numberArray(value: unknown, path: string): number[] {
  return asArray(value, path).map((entry, index) => finite(entry, `${path}[${index}]`));
}

function tuple3(value: unknown, path: string, integerOnly: boolean): ProbeGiVec3 & ProbeGiDimensions {
  const values = numberArray(value, path);
  if (values.length !== 3) throw new Error(`${path} must contain exactly 3 numbers`);
  if (integerOnly && values.some((entry) => !Number.isInteger(entry) || entry <= 0)) {
    throw new Error(`${path} must contain positive integers`);
  }
  return [values[0], values[1], values[2]];
}

function assertStrictlyIncreasing(values: readonly number[], path: string): void {
  for (let index = 1; index < values.length; index++) {
    if (values[index] <= values[index - 1]) throw new Error(`${path} must be strictly increasing`);
  }
}

export function isProbeGiDebugMode(value: string): value is ProbeGiDebugMode {
  return PROBE_GI_DEBUG_MODES.has(value as ProbeGiDebugMode);
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
