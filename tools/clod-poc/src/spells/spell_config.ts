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

export interface FireSpellAudioConfig {
  volume: number;
}

export type WaterSpellAudioConfig = FireSpellAudioConfig;
export type AirSpellAudioConfig = FireSpellAudioConfig;

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

function parseSpellEntry<TId extends "fire" | "water" | "air">(
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
      fire: parseSpellEntry("fire", asRecord(root?.fire), DEFAULT_SPELL_CONFIG.fire),
      water: parseSpellEntry("water", asRecord(root?.water), DEFAULT_SPELL_CONFIG.water),
      air: parseSpellEntry("air", asRecord(root?.air), DEFAULT_SPELL_CONFIG.air),
    };
  } catch (error) {
    console.warn("[spells] Failed to parse spell config, using defaults.", error);
    return DEFAULT_SPELL_CONFIG;
  }
}

export const defaultSpellConfig = parseSpellConfig();
