import { load } from "js-yaml";
import spellsYamlText from "../../config/spells.yaml?raw";

export type SpellColor = [number, number, number];

export interface FireSpellVfxConfig {
  flameScale: number;
  worldWidth: number;
  worldHeight: number;
  handForwardM: number;
  handRightM: number;
  handUpM: number;
  glowColor: SpellColor;
  glowIntensity: number;
  glowDistance: number;
  glowDecay: number;
  glowLocalYRatio: number;
}

export type WaterSpellVfxConfig = FireSpellVfxConfig;
export type AirSpellVfxConfig = FireSpellVfxConfig;

export interface EarthSpellVfxConfig {
  handForwardM: number;
  handRightM: number;
  handUpM: number;
  impactRadius: number;
  crackRadius: number;
  dustRadius: number;
  shardCount: number;
  shardMinHeight: number;
  shardMaxHeight: number;
  shardLifetimeMs: number;
  glowColor: SpellColor;
  glowIntensity: number;
  glowDistance: number;
  glowDecay: number;
}

export interface LightningSpellVfxConfig {
  handForwardM: number;
  handRightM: number;
  handUpM: number;
  maxRange: number;
  segmentCount: number;
  branchCount: number;
  branchLengthMin: number;
  branchLengthMax: number;
  jitter: number;
  coreWidth: number;
  glowWidth: number;
  refreshHz: number;
  impactRadius: number;
  sparkCount: number;
  coreColor: SpellColor;
  glowColor: SpellColor;
  sourceLightIntensity: number;
  impactLightIntensity: number;
  glowDistance: number;
  glowDecay: number;
}

export interface FireSpellAudioConfig {
  volume: number;
}

export type WaterSpellAudioConfig = FireSpellAudioConfig;
export type AirSpellAudioConfig = FireSpellAudioConfig;
export type EarthSpellAudioConfig = FireSpellAudioConfig;
export type LightningSpellAudioConfig = FireSpellAudioConfig;

export interface SpellConfig {
  menu: {
    rootId: string;
    title: string;
  };
  fire: {
    id: "fire";
    label: string;
    castDurationMs: number;
    audio: FireSpellAudioConfig;
    vfx: FireSpellVfxConfig;
  };
  water: {
    id: "water";
    label: string;
    castDurationMs: number;
    audio: WaterSpellAudioConfig;
    vfx: WaterSpellVfxConfig;
  };
  air: {
    id: "air";
    label: string;
    castDurationMs: number;
    audio: AirSpellAudioConfig;
    vfx: AirSpellVfxConfig;
  };
  earth: {
    id: "earth";
    label: string;
    castDurationMs: number;
    audio: EarthSpellAudioConfig;
    vfx: EarthSpellVfxConfig;
  };
  lightning: {
    id: "lightning";
    label: string;
    castDurationMs: number;
    audio: LightningSpellAudioConfig;
    vfx: LightningSpellVfxConfig;
  };
}

const DEFAULT_SPELL_CONFIG: SpellConfig = {
  menu: { rootId: "spell-menu", title: "Spells" },
  fire: {
    id: "fire",
    label: "Fire",
    castDurationMs: 2600,
    audio: { volume: 0.38 },
    vfx: {
      flameScale: 1.0,
      worldWidth: 1.6,
      worldHeight: 5.0,
      handForwardM: 0.5,
      handRightM: 0.35,
      handUpM: -0.35,
      glowColor: [1.0, 0.48, 0.14],
      glowIntensity: 3.6,
      glowDistance: 8.5,
      glowDecay: 2.0,
      glowLocalYRatio: 0.34,
    },
  },
  water: {
    id: "water",
    label: "Water",
    castDurationMs: 2200,
    audio: { volume: 0.34 },
    vfx: {
      flameScale: 1.0,
      worldWidth: 1.2,
      worldHeight: 4.5,
      handForwardM: 0.5,
      handRightM: 0.35,
      handUpM: -0.35,
      glowColor: [0.35, 0.78, 1.0],
      glowIntensity: 1.8,
      glowDistance: 6.5,
      glowDecay: 2.0,
      glowLocalYRatio: 0.38,
    },
  },
  air: {
    id: "air",
    label: "Air",
    castDurationMs: 1800,
    audio: { volume: 0.28 },
    vfx: {
      flameScale: 1.0,
      worldWidth: 1.45,
      worldHeight: 5.4,
      handForwardM: 0.5,
      handRightM: 0.35,
      handUpM: -0.35,
      glowColor: [0.84, 0.98, 1.0],
      glowIntensity: 1.2,
      glowDistance: 6.0,
      glowDecay: 2.0,
      glowLocalYRatio: 0.42,
    },
  },
  earth: {
    id: "earth",
    label: "Earth",
    castDurationMs: 1700,
    audio: { volume: 0.32 },
    vfx: {
      handForwardM: 0.5,
      handRightM: 0.35,
      handUpM: -0.35,
      impactRadius: 3.2,
      crackRadius: 4.5,
      dustRadius: 3.8,
      shardCount: 24,
      shardMinHeight: 0.45,
      shardMaxHeight: 1.8,
      shardLifetimeMs: 1300,
      glowColor: [0.75, 0.48, 0.22],
      glowIntensity: 0.7,
      glowDistance: 5.0,
      glowDecay: 2.0,
    },
  },
  lightning: {
    id: "lightning",
    label: "Lightning",
    castDurationMs: 1250,
    audio: { volume: 0.36 },
    vfx: {
      handForwardM: 0.58,
      handRightM: 0.34,
      handUpM: -0.32,
      maxRange: 28,
      segmentCount: 52,
      branchCount: 12,
      branchLengthMin: 0.7,
      branchLengthMax: 2.4,
      jitter: 0.42,
      coreWidth: 0.035,
      glowWidth: 0.18,
      refreshHz: 28,
      impactRadius: 0.8,
      sparkCount: 36,
      coreColor: [1.0, 1.0, 1.0],
      glowColor: [0.18, 0.62, 1.0],
      sourceLightIntensity: 4.5,
      impactLightIntensity: 7.5,
      glowDistance: 12,
      glowDecay: 2.0,
    },
  },
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readNumber(record: Record<string, unknown> | undefined, key: string, fallback: number, min: number, max: number): number {
  const value = Number(record?.[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readInteger(record: Record<string, unknown> | undefined, key: string, fallback: number, min: number, max: number): number {
  return Math.floor(readNumber(record, key, fallback, min, max));
}

function readColor(record: Record<string, unknown> | undefined, key: string, fallback: SpellColor): SpellColor {
  const value = record?.[key];
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const color = value.map(Number);
  if (!color.every(Number.isFinite)) return fallback;
  return [
    Math.min(1, Math.max(0, color[0]!)),
    Math.min(1, Math.max(0, color[1]!)),
    Math.min(1, Math.max(0, color[2]!)),
  ];
}

function readVfxConfig(record: Record<string, unknown> | undefined, fallback: FireSpellVfxConfig): FireSpellVfxConfig {
  return {
    flameScale: readNumber(record, "flame_scale", fallback.flameScale, 0.25, 3),
    worldWidth: readNumber(record, "world_width", fallback.worldWidth, 0.2, 20),
    worldHeight: readNumber(record, "world_height", fallback.worldHeight, 0.2, 30),
    handForwardM: readNumber(record, "hand_forward_m", fallback.handForwardM, -5, 10),
    handRightM: readNumber(record, "hand_right_m", fallback.handRightM, -5, 5),
    handUpM: readNumber(record, "hand_up_m", fallback.handUpM, -5, 5),
    glowColor: readColor(record, "glow_color", fallback.glowColor),
    glowIntensity: readNumber(record, "glow_intensity", fallback.glowIntensity, 0, 12),
    glowDistance: readNumber(record, "glow_distance", fallback.glowDistance, 0, 30),
    glowDecay: readNumber(record, "glow_decay", fallback.glowDecay, 0, 4),
    glowLocalYRatio: readNumber(record, "glow_local_y_ratio", fallback.glowLocalYRatio, -1, 2),
  };
}

function readEarthVfxConfig(record: Record<string, unknown> | undefined, fallback: EarthSpellVfxConfig): EarthSpellVfxConfig {
  return {
    handForwardM: readNumber(record, "hand_forward_m", fallback.handForwardM, -5, 10),
    handRightM: readNumber(record, "hand_right_m", fallback.handRightM, -5, 5),
    handUpM: readNumber(record, "hand_up_m", fallback.handUpM, -5, 5),
    impactRadius: readNumber(record, "impact_radius", fallback.impactRadius, 0.5, 20),
    crackRadius: readNumber(record, "crack_radius", fallback.crackRadius, 0.5, 30),
    dustRadius: readNumber(record, "dust_radius", fallback.dustRadius, 0.5, 30),
    shardCount: readInteger(record, "shard_count", fallback.shardCount, 0, 128),
    shardMinHeight: readNumber(record, "shard_min_height", fallback.shardMinHeight, 0, 10),
    shardMaxHeight: readNumber(record, "shard_max_height", fallback.shardMaxHeight, 0, 20),
    shardLifetimeMs: readNumber(record, "shard_lifetime_ms", fallback.shardLifetimeMs, 100, 8000),
    glowColor: readColor(record, "glow_color", fallback.glowColor),
    glowIntensity: readNumber(record, "glow_intensity", fallback.glowIntensity, 0, 12),
    glowDistance: readNumber(record, "glow_distance", fallback.glowDistance, 0, 30),
    glowDecay: readNumber(record, "glow_decay", fallback.glowDecay, 0, 4),
  };
}

function readLightningVfxConfig(
  record: Record<string, unknown> | undefined,
  fallback: LightningSpellVfxConfig,
): LightningSpellVfxConfig {
  return {
    handForwardM: readNumber(record, "hand_forward_m", fallback.handForwardM, -5, 10),
    handRightM: readNumber(record, "hand_right_m", fallback.handRightM, -5, 5),
    handUpM: readNumber(record, "hand_up_m", fallback.handUpM, -5, 5),
    maxRange: readNumber(record, "max_range", fallback.maxRange, 2, 80),
    segmentCount: readInteger(record, "segment_count", fallback.segmentCount, 8, 128),
    branchCount: readInteger(record, "branch_count", fallback.branchCount, 0, 32),
    branchLengthMin: readNumber(record, "branch_length_min", fallback.branchLengthMin, 0.1, 10),
    branchLengthMax: readNumber(record, "branch_length_max", fallback.branchLengthMax, 0.1, 16),
    jitter: readNumber(record, "jitter", fallback.jitter, 0, 4),
    coreWidth: readNumber(record, "core_width", fallback.coreWidth, 0.005, 0.5),
    glowWidth: readNumber(record, "glow_width", fallback.glowWidth, 0.01, 2),
    refreshHz: readNumber(record, "refresh_hz", fallback.refreshHz, 1, 60),
    impactRadius: readNumber(record, "impact_radius", fallback.impactRadius, 0.05, 5),
    sparkCount: readInteger(record, "spark_count", fallback.sparkCount, 0, 128),
    coreColor: readColor(record, "core_color", fallback.coreColor),
    glowColor: readColor(record, "glow_color", fallback.glowColor),
    sourceLightIntensity: readNumber(record, "source_light_intensity", fallback.sourceLightIntensity, 0, 20),
    impactLightIntensity: readNumber(record, "impact_light_intensity", fallback.impactLightIntensity, 0, 30),
    glowDistance: readNumber(record, "glow_distance", fallback.glowDistance, 0, 40),
    glowDecay: readNumber(record, "glow_decay", fallback.glowDecay, 0, 4),
  };
}

function parseBeamSpellEntry<TId extends "fire" | "water" | "air">(
  id: TId,
  record: Record<string, unknown> | undefined,
  fallback: SpellConfig[TId],
): SpellConfig[TId] {
  const audio = asRecord(record?.audio);
  const vfx = asRecord(record?.vfx);
  return {
    id,
    label: readString(record, "label", fallback.label),
    castDurationMs: readNumber(record, "cast_duration_ms", fallback.castDurationMs, 250, 8000),
    audio: { volume: readNumber(audio, "volume", fallback.audio.volume, 0, 1) },
    vfx: readVfxConfig(vfx, fallback.vfx),
  } as SpellConfig[TId];
}

function parseEarthSpellEntry(record: Record<string, unknown> | undefined, fallback: SpellConfig["earth"]): SpellConfig["earth"] {
  const audio = asRecord(record?.audio);
  const vfx = asRecord(record?.vfx);
  return {
    id: "earth",
    label: readString(record, "label", fallback.label),
    castDurationMs: readNumber(record, "cast_duration_ms", fallback.castDurationMs, 250, 8000),
    audio: { volume: readNumber(audio, "volume", fallback.audio.volume, 0, 1) },
    vfx: readEarthVfxConfig(vfx, fallback.vfx),
  };
}

function parseLightningSpellEntry(
  record: Record<string, unknown> | undefined,
  fallback: SpellConfig["lightning"],
): SpellConfig["lightning"] {
  const audio = asRecord(record?.audio);
  const vfx = asRecord(record?.vfx);
  return {
    id: "lightning",
    label: readString(record, "label", fallback.label),
    castDurationMs: readNumber(record, "cast_duration_ms", fallback.castDurationMs, 250, 8000),
    audio: { volume: readNumber(audio, "volume", fallback.audio.volume, 0, 1) },
    vfx: readLightningVfxConfig(vfx, fallback.vfx),
  };
}

export function parseSpellConfig(text: string = spellsYamlText): SpellConfig {
  try {
    const parsed = asRecord(load(text));
    const root = asRecord(parsed?.spells);
    const menu = asRecord(root?.menu);
    return {
      menu: {
        rootId: readString(menu, "root_id", DEFAULT_SPELL_CONFIG.menu.rootId),
        title: readString(menu, "title", DEFAULT_SPELL_CONFIG.menu.title),
      },
      fire: parseBeamSpellEntry("fire", asRecord(root?.fire), DEFAULT_SPELL_CONFIG.fire),
      water: parseBeamSpellEntry("water", asRecord(root?.water), DEFAULT_SPELL_CONFIG.water),
      air: parseBeamSpellEntry("air", asRecord(root?.air), DEFAULT_SPELL_CONFIG.air),
      earth: parseEarthSpellEntry(asRecord(root?.earth), DEFAULT_SPELL_CONFIG.earth),
      lightning: parseLightningSpellEntry(asRecord(root?.lightning), DEFAULT_SPELL_CONFIG.lightning),
    };
  } catch (error) {
    console.warn("[spells] Failed to parse spell config, using defaults.", error);
    return DEFAULT_SPELL_CONFIG;
  }
}

export const defaultSpellConfig = parseSpellConfig();