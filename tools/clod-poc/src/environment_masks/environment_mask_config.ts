import { load } from "js-yaml";
import type {
  CalmPoolMaskSettings,
  DewMaskSettings,
  EnvironmentalBandSettings,
  EnvironmentalMaskSettings,
  FrostMaskSettings,
  RapidSplashMaskSettings,
  RiverCobbleMaskSettings,
  RiverMistMaskSettings,
  ShoreDebrisMaskSettings,
  SunbeamMoteMaskSettings,
} from "./environment_mask_types.js";

type WarnHandler = (message: string) => void;
type RecordValue = Record<string, unknown>;

export const DEFAULT_ENVIRONMENTAL_MASK_SETTINGS: EnvironmentalMaskSettings = Object.freeze({
  enabled: true,
  riverCobble: Object.freeze({
    enabled: true,
    strength: 1,
    minDepthM: 0.06,
    maxDepthM: 1.4,
    minFlowStrength: 0.015,
    maxFlowStrength: 1.8,
    maxShoreDistanceM: 10,
    minNormalY: 0.58,
  }),
  riverMist: Object.freeze({
    enabled: true,
    strength: 1,
    minFlowStrength: 0.01,
    maxShoreDistanceM: 14,
  }),
  rapidSplash: Object.freeze({
    enabled: true,
    strength: 1,
    flowStart: 0.35,
    flowEnd: 1.2,
    bedDropStart: 0.35,
    bedDropEnd: 1.8,
  }),
  sunbeamMote: Object.freeze({
    enabled: true,
    strength: 1,
    visibilityStart: 0.45,
    visibilityEnd: 0.9,
  }),
  calmPool: Object.freeze({
    enabled: true,
    strength: 1,
    minDepthM: 0.45,
    maxFlowStrength: 0.08,
  }),
  frost: Object.freeze({
    enabled: true,
    strength: 1,
    visibilityStart: 0.2,
    visibilityEnd: 0.85,
    wetnessSuppression: 0.7,
  }),
  dew: Object.freeze({
    enabled: true,
    strength: 1,
    wetnessStart: 0.25,
    wetnessEnd: 0.85,
  }),
  shoreDebris: Object.freeze({
    enabled: true,
    strength: 1,
    shoreStartM: 0.2,
    shoreEndM: 4.5,
    maxFlowStrength: 0.55,
  }),
});

export function cloneEnvironmentalMaskSettings(
  settings: EnvironmentalMaskSettings = DEFAULT_ENVIRONMENTAL_MASK_SETTINGS,
): EnvironmentalMaskSettings {
  return {
    enabled: settings.enabled,
    riverCobble: { ...settings.riverCobble },
    riverMist: { ...settings.riverMist },
    rapidSplash: { ...settings.rapidSplash },
    sunbeamMote: { ...settings.sunbeamMote },
    calmPool: { ...settings.calmPool },
    frost: { ...settings.frost },
    dew: { ...settings.dew },
    shoreDebris: { ...settings.shoreDebris },
  };
}

export function parseEnvironmentalMaskConfig(
  text: string | null | undefined,
  warn: WarnHandler | null = console.warn,
): EnvironmentalMaskSettings {
  const root = readRoot(text, warn);
  const defaults = DEFAULT_ENVIRONMENTAL_MASK_SETTINGS;
  return {
    enabled: readBoolean(root.enabled, defaults.enabled),
    riverCobble: parseRiverCobble(record(root.river_cobble ?? root.riverCobble), defaults.riverCobble),
    riverMist: parseRiverMist(record(root.river_mist ?? root.riverMist), defaults.riverMist),
    rapidSplash: parseRapidSplash(record(root.rapid_splash ?? root.rapidSplash), defaults.rapidSplash),
    sunbeamMote: parseSunbeamMote(record(root.sunbeam_mote ?? root.sunbeamMote), defaults.sunbeamMote),
    calmPool: parseCalmPool(record(root.calm_pool ?? root.calmPool), defaults.calmPool),
    frost: parseFrost(record(root.frost), defaults.frost),
    dew: parseDew(record(root.dew), defaults.dew),
    shoreDebris: parseShoreDebris(record(root.shore_debris ?? root.shoreDebris), defaults.shoreDebris),
  };
}

function parseBand(raw: RecordValue, defaults: EnvironmentalBandSettings): EnvironmentalBandSettings {
  return {
    enabled: readBoolean(raw.enabled, defaults.enabled),
    strength: readFraction(raw.strength, defaults.strength),
  };
}

function parseRiverCobble(raw: RecordValue, defaults: RiverCobbleMaskSettings): RiverCobbleMaskSettings {
  const band = parseBand(raw, defaults);
  const minDepthM = readNonNegative(raw.min_depth_m ?? raw.minDepthM, defaults.minDepthM);
  const maxDepthM = Math.max(minDepthM, readNonNegative(raw.max_depth_m ?? raw.maxDepthM, defaults.maxDepthM));
  const minFlowStrength = readNonNegative(raw.min_flow_strength ?? raw.minFlowStrength, defaults.minFlowStrength);
  const maxFlowStrength = Math.max(minFlowStrength, readNonNegative(raw.max_flow_strength ?? raw.maxFlowStrength, defaults.maxFlowStrength));
  return {
    ...band,
    minDepthM,
    maxDepthM,
    minFlowStrength,
    maxFlowStrength,
    maxShoreDistanceM: readNonNegative(raw.max_shore_distance_m ?? raw.maxShoreDistanceM, defaults.maxShoreDistanceM),
    minNormalY: readFraction(raw.min_normal_y ?? raw.minNormalY, defaults.minNormalY),
  };
}

function parseRiverMist(raw: RecordValue, defaults: RiverMistMaskSettings): RiverMistMaskSettings {
  return {
    ...parseBand(raw, defaults),
    minFlowStrength: readNonNegative(raw.min_flow_strength ?? raw.minFlowStrength, defaults.minFlowStrength),
    maxShoreDistanceM: readNonNegative(raw.max_shore_distance_m ?? raw.maxShoreDistanceM, defaults.maxShoreDistanceM),
  };
}

function parseRapidSplash(raw: RecordValue, defaults: RapidSplashMaskSettings): RapidSplashMaskSettings {
  const flowStart = readNonNegative(raw.flow_start ?? raw.flowStart, defaults.flowStart);
  const bedDropStart = readNonNegative(raw.bed_drop_start ?? raw.bedDropStart, defaults.bedDropStart);
  return {
    ...parseBand(raw, defaults),
    flowStart,
    flowEnd: Math.max(flowStart, readNonNegative(raw.flow_end ?? raw.flowEnd, defaults.flowEnd)),
    bedDropStart,
    bedDropEnd: Math.max(bedDropStart, readNonNegative(raw.bed_drop_end ?? raw.bedDropEnd, defaults.bedDropEnd)),
  };
}

function parseSunbeamMote(raw: RecordValue, defaults: SunbeamMoteMaskSettings): SunbeamMoteMaskSettings {
  const visibilityStart = readFraction(raw.visibility_start ?? raw.visibilityStart, defaults.visibilityStart);
  return {
    ...parseBand(raw, defaults),
    visibilityStart,
    visibilityEnd: Math.max(visibilityStart, readFraction(raw.visibility_end ?? raw.visibilityEnd, defaults.visibilityEnd)),
  };
}

function parseCalmPool(raw: RecordValue, defaults: CalmPoolMaskSettings): CalmPoolMaskSettings {
  return {
    ...parseBand(raw, defaults),
    minDepthM: readNonNegative(raw.min_depth_m ?? raw.minDepthM, defaults.minDepthM),
    maxFlowStrength: readNonNegative(raw.max_flow_strength ?? raw.maxFlowStrength, defaults.maxFlowStrength),
  };
}

function parseFrost(raw: RecordValue, defaults: FrostMaskSettings): FrostMaskSettings {
  const visibilityStart = readFraction(raw.visibility_start ?? raw.visibilityStart, defaults.visibilityStart);
  return {
    ...parseBand(raw, defaults),
    visibilityStart,
    visibilityEnd: Math.max(visibilityStart, readFraction(raw.visibility_end ?? raw.visibilityEnd, defaults.visibilityEnd)),
    wetnessSuppression: readFraction(raw.wetness_suppression ?? raw.wetnessSuppression, defaults.wetnessSuppression),
  };
}

function parseDew(raw: RecordValue, defaults: DewMaskSettings): DewMaskSettings {
  const wetnessStart = readFraction(raw.wetness_start ?? raw.wetnessStart, defaults.wetnessStart);
  return {
    ...parseBand(raw, defaults),
    wetnessStart,
    wetnessEnd: Math.max(wetnessStart, readFraction(raw.wetness_end ?? raw.wetnessEnd, defaults.wetnessEnd)),
  };
}

function parseShoreDebris(raw: RecordValue, defaults: ShoreDebrisMaskSettings): ShoreDebrisMaskSettings {
  const shoreStartM = readNonNegative(raw.shore_start_m ?? raw.shoreStartM, defaults.shoreStartM);
  return {
    ...parseBand(raw, defaults),
    shoreStartM,
    shoreEndM: Math.max(shoreStartM, readNonNegative(raw.shore_end_m ?? raw.shoreEndM, defaults.shoreEndM)),
    maxFlowStrength: readNonNegative(raw.max_flow_strength ?? raw.maxFlowStrength, defaults.maxFlowStrength),
  };
}

function readRoot(text: string | null | undefined, warn: WarnHandler | null): RecordValue {
  try {
    const parsed = text && text.trim() !== "" ? load(text) : {};
    if (isRecord(parsed)) return parsed;
    if (parsed !== null && parsed !== undefined) {
      warn?.("[environment-masks] config root must be an object; using defaults");
    }
  } catch (error) {
    warn?.(`[environment-masks] failed to parse config; using defaults: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {};
}

function record(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNonNegative(value: unknown, fallback: number): number {
  return Math.max(0, readFinite(value, fallback));
}

function readFraction(value: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, readFinite(value, fallback)));
}

function readFinite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
