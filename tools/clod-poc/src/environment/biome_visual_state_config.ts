import { load } from "js-yaml";

export interface BiomeVisualSeasonKeyframe {
  readonly at: number;
  readonly green: number;
  readonly autumn: number;
  readonly bloom: number;
  readonly snowlineM: number;
  readonly glacialMurkiness: number;
  readonly pollenAmount: number;
  readonly frostAmount: number;
}

export interface BiomeVisualMorningMistSettings {
  readonly startSunElevationDeg: number;
  readonly peakSunElevationDeg: number;
  readonly endSunElevationDeg: number;
  readonly strength: number;
}

export interface BiomeVisualStateSettings {
  readonly enabled: boolean;
  readonly seasonKeyframes: readonly BiomeVisualSeasonKeyframe[];
  readonly morningMist: BiomeVisualMorningMistSettings;
  readonly defaultWetness: number;
}

interface BiomeVisualStateYaml {
  biome_visual_state?: {
    enabled?: unknown;
    season_keyframes?: unknown;
    morning_mist?: unknown;
    wetness?: unknown;
  };
}

interface SeasonKeyframeYaml {
  at?: unknown;
  green?: unknown;
  autumn?: unknown;
  bloom?: unknown;
  snowline_m?: unknown;
  glacial_murkiness?: unknown;
  pollen_amount?: unknown;
  frost_amount?: unknown;
}

interface MorningMistYaml {
  start_sun_elevation_deg?: unknown;
  peak_sun_elevation_deg?: unknown;
  end_sun_elevation_deg?: unknown;
  strength?: unknown;
}

interface WetnessYaml {
  default?: unknown;
}

export class BiomeVisualStateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiomeVisualStateConfigError";
  }
}

export function parseBiomeVisualStateConfig(text: string): BiomeVisualStateSettings {
  if (text.trim() === "") {
    throw new BiomeVisualStateConfigError("config/biome_visual_state.yaml is empty");
  }

  let document: BiomeVisualStateYaml;
  try {
    document = (load(text) ?? {}) as BiomeVisualStateYaml;
  } catch (error) {
    throw new BiomeVisualStateConfigError(
      `config/biome_visual_state.yaml is not valid YAML: ${errorMessage(error)}`,
    );
  }

  const root = requireRecord(document.biome_visual_state, "biome_visual_state");
  const enabled = requireBoolean(root.enabled, "biome_visual_state.enabled");
  const seasonKeyframes = parseSeasonKeyframes(root.season_keyframes);
  const morningMist = parseMorningMist(root.morning_mist);
  const wetness = requireRecord(root.wetness, "biome_visual_state.wetness") as WetnessYaml;

  return Object.freeze({
    enabled,
    seasonKeyframes,
    morningMist,
    defaultWetness: requireFraction(wetness.default, "biome_visual_state.wetness.default"),
  });
}

function parseSeasonKeyframes(value: unknown): readonly BiomeVisualSeasonKeyframe[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new BiomeVisualStateConfigError(
      "biome_visual_state.season_keyframes must contain at least two keyframes",
    );
  }

  const keyframes = value.map((entry, index) => {
    const path = `biome_visual_state.season_keyframes[${index}]`;
    const raw = requireRecord(entry, path) as SeasonKeyframeYaml;
    const keyframe: BiomeVisualSeasonKeyframe = {
      at: requireNumberInRange(raw.at, `${path}.at`, 0, 1, false),
      green: requireFraction(raw.green, `${path}.green`),
      autumn: requireFraction(raw.autumn, `${path}.autumn`),
      bloom: requireFraction(raw.bloom, `${path}.bloom`),
      snowlineM: requireNumberAtLeast(raw.snowline_m, `${path}.snowline_m`, 0),
      glacialMurkiness: requireFraction(raw.glacial_murkiness, `${path}.glacial_murkiness`),
      pollenAmount: requireFraction(raw.pollen_amount, `${path}.pollen_amount`),
      frostAmount: requireFraction(raw.frost_amount, `${path}.frost_amount`),
    };
    return Object.freeze(keyframe);
  }).sort((left, right) => left.at - right.at);

  for (let index = 1; index < keyframes.length; index += 1) {
    if (keyframes[index]?.at === keyframes[index - 1]?.at) {
      throw new BiomeVisualStateConfigError(
        `biome_visual_state.season_keyframes contains duplicate at=${keyframes[index]?.at}`,
      );
    }
  }

  return Object.freeze(keyframes);
}

function parseMorningMist(value: unknown): BiomeVisualMorningMistSettings {
  const raw = requireRecord(value, "biome_visual_state.morning_mist") as MorningMistYaml;
  const startSunElevationDeg = requireFiniteNumber(
    raw.start_sun_elevation_deg,
    "biome_visual_state.morning_mist.start_sun_elevation_deg",
  );
  const peakSunElevationDeg = requireFiniteNumber(
    raw.peak_sun_elevation_deg,
    "biome_visual_state.morning_mist.peak_sun_elevation_deg",
  );
  const endSunElevationDeg = requireFiniteNumber(
    raw.end_sun_elevation_deg,
    "biome_visual_state.morning_mist.end_sun_elevation_deg",
  );
  if (!(startSunElevationDeg < peakSunElevationDeg && peakSunElevationDeg < endSunElevationDeg)) {
    throw new BiomeVisualStateConfigError(
      "biome_visual_state.morning_mist elevations must satisfy start < peak < end",
    );
  }

  return Object.freeze({
    startSunElevationDeg,
    peakSunElevationDeg,
    endSunElevationDeg,
    strength: requireFraction(raw.strength, "biome_visual_state.morning_mist.strength"),
  });
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BiomeVisualStateConfigError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new BiomeVisualStateConfigError(`${path} must be a boolean`);
  }
  return value;
}

function requireFraction(value: unknown, path: string): number {
  return requireNumberInRange(value, path, 0, 1, true);
}

function requireNumberAtLeast(value: unknown, path: string, minimum: number): number {
  const numberValue = requireFiniteNumber(value, path);
  if (numberValue < minimum) {
    throw new BiomeVisualStateConfigError(`${path} must be >= ${minimum}`);
  }
  return numberValue;
}

function requireNumberInRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  includeMaximum: boolean,
): number {
  const numberValue = requireFiniteNumber(value, path);
  const aboveMaximum = includeMaximum ? numberValue > maximum : numberValue >= maximum;
  if (numberValue < minimum || aboveMaximum) {
    const upperOperator = includeMaximum ? "<=" : "<";
    throw new BiomeVisualStateConfigError(
      `${path} must satisfy ${minimum} <= value ${upperOperator} ${maximum}`,
    );
  }
  return numberValue;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BiomeVisualStateConfigError(`${path} must be a finite number`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
