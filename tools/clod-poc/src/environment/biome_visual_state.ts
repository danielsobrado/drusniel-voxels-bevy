import type {
  BiomeVisualSeasonKeyframe,
  BiomeVisualStateSettings,
} from "./biome_visual_state_config.js";

export interface BiomeVisualStateInput {
  readonly seasonT: number;
  readonly sunElevationDeg: number;
  readonly wetness?: number;
}

export interface BiomeVisualState {
  readonly enabled: boolean;
  readonly seasonT: number;
  readonly green: number;
  readonly autumn: number;
  readonly bloom: number;
  readonly snowlineM: number;
  readonly glacialMurkiness: number;
  readonly morningMist: number;
  readonly pollenAmount: number;
  readonly frostAmount: number;
  readonly wetness: number;
}

export function evaluateBiomeVisualState(
  settings: BiomeVisualStateSettings,
  input: BiomeVisualStateInput,
): BiomeVisualState {
  const seasonT = normalizeCycle(input.seasonT);
  const interval = findSeasonInterval(settings.seasonKeyframes, seasonT);
  const lower = interval.lower;
  const upper = interval.upper;
  const blend = interval.blend;

  return Object.freeze({
    enabled: settings.enabled,
    seasonT,
    green: lerp(lower.green, upper.green, blend),
    autumn: lerp(lower.autumn, upper.autumn, blend),
    bloom: lerp(lower.bloom, upper.bloom, blend),
    snowlineM: lerp(lower.snowlineM, upper.snowlineM, blend),
    glacialMurkiness: lerp(lower.glacialMurkiness, upper.glacialMurkiness, blend),
    morningMist: evaluateMorningMist(settings, input.sunElevationDeg),
    pollenAmount: lerp(lower.pollenAmount, upper.pollenAmount, blend),
    frostAmount: lerp(lower.frostAmount, upper.frostAmount, blend),
    wetness: clampFraction(input.wetness ?? settings.defaultWetness),
  });
}

interface SeasonInterval {
  readonly lower: BiomeVisualSeasonKeyframe;
  readonly upper: BiomeVisualSeasonKeyframe;
  readonly blend: number;
}

function findSeasonInterval(
  keyframes: readonly BiomeVisualSeasonKeyframe[],
  seasonT: number,
): SeasonInterval {
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (!first || !last) {
    throw new Error("Biome visual state requires at least one season keyframe");
  }

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const lower = keyframes[index];
    const upper = keyframes[index + 1];
    if (lower && upper && seasonT >= lower.at && seasonT < upper.at) {
      return { lower, upper, blend: inverseLerp(lower.at, upper.at, seasonT) };
    }
  }

  if (seasonT >= last.at) {
    return {
      lower: last,
      upper: first,
      blend: inverseLerp(last.at, first.at + 1, seasonT),
    };
  }

  return {
    lower: last,
    upper: first,
    blend: inverseLerp(last.at - 1, first.at, seasonT),
  };
}

function evaluateMorningMist(settings: BiomeVisualStateSettings, sunElevationDeg: number): number {
  if (!Number.isFinite(sunElevationDeg)) return 0;
  const mist = settings.morningMist;
  if (sunElevationDeg <= mist.startSunElevationDeg || sunElevationDeg >= mist.endSunElevationDeg) {
    return 0;
  }
  if (sunElevationDeg <= mist.peakSunElevationDeg) {
    return mist.strength * inverseLerp(
      mist.startSunElevationDeg,
      mist.peakSunElevationDeg,
      sunElevationDeg,
    );
  }
  return mist.strength * (1 - inverseLerp(
    mist.peakSunElevationDeg,
    mist.endSunElevationDeg,
    sunElevationDeg,
  ));
}

function normalizeCycle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

function inverseLerp(start: number, end: number, value: number): number {
  const width = end - start;
  if (!(width > 0)) return 0;
  return clampFraction((value - start) / width);
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
