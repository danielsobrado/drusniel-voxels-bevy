import type { WeatherMode } from "../app/clod_constants.js";
import {
  evaluateBiomeVisualState,
  type BiomeVisualState,
  type BiomeVisualStateInput,
} from "./biome_visual_state.js";
import type { BiomeVisualStateSettings } from "./biome_visual_state_config.js";

export const BIOME_VISUAL_SEASON_QUERY_KEYS = ["biomeSeasonT", "biomeSeason"] as const;
export const BIOME_VISUAL_STATE_DEBUG_PROPERTY = "__drusnielBiomeVisualState";

export interface BiomeVisualWeatherInput {
  readonly mode: WeatherMode;
  readonly intensity: number;
}

export interface BiomeVisualStateRuntimeOptions {
  readonly settings: BiomeVisualStateSettings;
  readonly getSeasonT: () => number;
  readonly getSunElevationDeg: () => number;
  readonly getWeather: () => BiomeVisualWeatherInput;
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

  const readValues = () => {
    const weather = options.getWeather();
    return {
      seasonT: normalizeCycle(options.getSeasonT()),
      sunElevationDeg: finiteOrZero(options.getSunElevationDeg()),
      wetness: deriveBiomeVisualWetness(
        weather.mode,
        weather.intensity,
        options.settings.defaultWetness,
      ),
    };
  };

  return {
    currentInput() {
      return Object.freeze(readValues());
    },
    current() {
      const values = readValues();
      if (cachedState
        && cachedSeasonT === values.seasonT
        && cachedSunElevationDeg === values.sunElevationDeg
        && cachedWetness === values.wetness) {
        return cachedState;
      }

      const input = Object.freeze(values);
      cachedSeasonT = input.seasonT;
      cachedSunElevationDeg = input.sunElevationDeg;
      cachedWetness = input.wetness ?? options.settings.defaultWetness;
      cachedState = evaluateBiomeVisualState(options.settings, input);
      return cachedState;
    },
  };
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
    get: () => runtime.current(),
  });
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
