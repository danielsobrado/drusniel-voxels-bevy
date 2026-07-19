import type { WeatherMode } from "../app/clod_constants.js";
import {
  evaluateBiomeVisualState,
  type BiomeVisualState,
  type BiomeVisualStateInput,
} from "./biome_visual_state.js";
import type { BiomeVisualStateSettings } from "./biome_visual_state_config.js";

export const BIOME_VISUAL_SEASON_QUERY_KEYS = ["biomeSeasonT", "biomeSeason"] as const;
export const BIOME_VISUAL_STATE_DEBUG_PROPERTY = "__drusnielBiomeVisualState";

export type BiomeVisualStateOverride = Partial<Pick<BiomeVisualState,
  | "enabled"
  | "seasonT"
  | "green"
  | "autumn"
  | "bloom"
  | "snowlineM"
  | "glacialMurkiness"
  | "morningMist"
  | "pollenAmount"
  | "frostAmount"
  | "wetness"
>>;

let activeBiomeVisualStateRuntime: BiomeVisualStateRuntime | null = null;
let activeBiomeVisualStateOverride: Readonly<BiomeVisualStateOverride> | null = null;
let cachedOverrideBase: BiomeVisualState | null = null;
let cachedOverrideValue: Readonly<BiomeVisualStateOverride> | null = null;
let cachedOverrideState: BiomeVisualState | null = null;

export interface BiomeVisualStateRuntimeOptions {
  readonly settings: BiomeVisualStateSettings;
  readonly getSeasonT: () => number;
  readonly getSunElevationDeg: () => number;
  readonly getWeatherMode: () => WeatherMode;
  readonly getWeatherIntensity: () => number;
}

export interface BiomeVisualStateRuntime {
  current(): BiomeVisualState;
  currentInput(): BiomeVisualStateInput;
}

export function createBiomeVisualStateRuntime(
  options: BiomeVisualStateRuntimeOptions,
): BiomeVisualStateRuntime {
  let cachedSeasonT = Number.NaN;
  let cachedSunElevationDeg = Number.NaN;
  let cachedWetness = Number.NaN;
  let cachedState: BiomeVisualState | null = null;

  const readSeasonT = () => normalizeCycle(options.getSeasonT());
  const readSunElevationDeg = () => finiteOrZero(options.getSunElevationDeg());
  const readWetness = () => deriveBiomeVisualWetness(
    options.getWeatherMode(),
    options.getWeatherIntensity(),
    options.settings.defaultWetness,
  );

  return {
    currentInput() {
      return Object.freeze({
        seasonT: readSeasonT(),
        sunElevationDeg: readSunElevationDeg(),
        wetness: readWetness(),
      });
    },
    current() {
      const seasonT = readSeasonT();
      const sunElevationDeg = readSunElevationDeg();
      const wetness = readWetness();
      if (cachedState
        && cachedSeasonT === seasonT
        && cachedSunElevationDeg === sunElevationDeg
        && cachedWetness === wetness) {
        return cachedState;
      }

      cachedSeasonT = seasonT;
      cachedSunElevationDeg = sunElevationDeg;
      cachedWetness = wetness;
      cachedState = evaluateBiomeVisualState(options.settings, {
        seasonT,
        sunElevationDeg,
        wetness,
      });
      return cachedState;
    },
  };
}

export function bindActiveBiomeVisualStateRuntime(runtime: BiomeVisualStateRuntime | null): void {
  activeBiomeVisualStateRuntime = runtime;
  invalidateOverrideCache();
}

export function readActiveBiomeVisualState(): BiomeVisualState | null {
  const base = activeBiomeVisualStateRuntime?.current() ?? null;
  return base ? applyBiomeVisualStateOverride(base, activeBiomeVisualStateOverride) : null;
}

export function setBiomeVisualStateOverride(override: BiomeVisualStateOverride | null): void {
  activeBiomeVisualStateOverride = override ? sanitizeBiomeVisualStateOverride(override) : null;
  invalidateOverrideCache();
}

export function clearBiomeVisualStateOverride(): void {
  setBiomeVisualStateOverride(null);
}

export function readBiomeVisualStateOverride(): Readonly<BiomeVisualStateOverride> | null {
  return activeBiomeVisualStateOverride;
}

export function applyBiomeVisualStateOverride(
  base: BiomeVisualState,
  override: Readonly<BiomeVisualStateOverride> | null,
): BiomeVisualState {
  if (!override) return base;
  if (cachedOverrideBase === base && cachedOverrideValue === override && cachedOverrideState) {
    return cachedOverrideState;
  }
  cachedOverrideBase = base;
  cachedOverrideValue = override;
  cachedOverrideState = Object.freeze({ ...base, ...override });
  return cachedOverrideState;
}

export function resolveBiomeVisualSeasonT(
  searchParams: URLSearchParams,
  fallbackSeasonT: number,
): number {
  for (const key of BIOME_VISUAL_SEASON_QUERY_KEYS) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return normalizeCycle(parsed);
  }
  return normalizeCycle(fallbackSeasonT);
}

export function deriveBiomeVisualWetness(
  mode: WeatherMode,
  intensity: number,
  defaultWetness: number,
): number {
  const baseline = clampFraction(defaultWetness);
  if (mode !== "rain" && mode !== "storm") return baseline;
  return Math.max(baseline, clampFraction(intensity));
}

export function installBiomeVisualStateDebugProperty(
  target: object,
  runtime: BiomeVisualStateRuntime,
): void {
  Object.defineProperty(target, BIOME_VISUAL_STATE_DEBUG_PROPERTY, {
    configurable: true,
    enumerable: false,
    get: () => applyBiomeVisualStateOverride(runtime.current(), activeBiomeVisualStateOverride),
  });
}

function sanitizeBiomeVisualStateOverride(
  override: BiomeVisualStateOverride,
): Readonly<BiomeVisualStateOverride> {
  const next: BiomeVisualStateOverride = {};
  if (typeof override.enabled === "boolean") next.enabled = override.enabled;
  if (override.seasonT !== undefined) next.seasonT = normalizeCycle(override.seasonT);
  if (override.green !== undefined) next.green = clampFraction(override.green);
  if (override.autumn !== undefined) next.autumn = clampFraction(override.autumn);
  if (override.bloom !== undefined) next.bloom = clampFraction(override.bloom);
  if (override.glacialMurkiness !== undefined) {
    next.glacialMurkiness = clampFraction(override.glacialMurkiness);
  }
  if (override.morningMist !== undefined) next.morningMist = clampFraction(override.morningMist);
  if (override.pollenAmount !== undefined) next.pollenAmount = clampFraction(override.pollenAmount);
  if (override.frostAmount !== undefined) next.frostAmount = clampFraction(override.frostAmount);
  if (override.wetness !== undefined) next.wetness = clampFraction(override.wetness);
  if (override.snowlineM !== undefined && Number.isFinite(override.snowlineM)) {
    next.snowlineM = Math.max(0, override.snowlineM);
  }
  return Object.freeze(next);
}

function invalidateOverrideCache(): void {
  cachedOverrideBase = null;
  cachedOverrideValue = null;
  cachedOverrideState = null;
}

function normalizeCycle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
