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
  let cachedInput: BiomeVisualStateInput | null = null;
  let cachedState: BiomeVisualState | null = null;

  const currentInput = (): BiomeVisualStateInput => {
    const weather = options.getWeather();
    return Object.freeze({
      seasonT: normalizeCycle(options.getSeasonT()),
      sunElevationDeg: finiteOrZero(options.getSunElevationDeg()),
      wetness: deriveBiomeVisualWetness(
        weather.mode,
        weather.intensity,
        options.settings.defaultWetness,
      ),
    });
  };

  return {
    currentInput,
    current() {
      const input = currentInput();
      if (cachedInput
        && cachedState
        && cachedInput.seasonT === input.seasonT
        && cachedInput.sunElevationDeg === input.sunElevationDeg
        && cachedInput.wetness === input.wetness) {
        return cachedState;
      }

      cachedInput = input;
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
