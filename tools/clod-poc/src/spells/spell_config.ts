import { load } from "js-yaml";
import spellsYamlText from "../../config/spells.yaml?raw";

export type SpellVec2 = readonly [number, number];

export interface FireSpellVfxConfig {
  layerId: string;
  canvasId: string;
  fallbackWidthPx: number;
  fallbackHeightPx: number;
  maxDpr: number;
  flameScale: number;
  origin: SpellVec2;
  target: SpellVec2;
}

export interface FireSpellAudioConfig {
  volume: number;
}

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
}

const DEFAULT_SPELL_CONFIG: SpellConfig = {
  menu: {
    rootId: "spell-menu",
    title: "Spells",
  },
  fire: {
    id: "fire",
    label: "Fire",
    castDurationMs: 2600,
    audio: {
      volume: 0.38,
    },
    vfx: {
      layerId: "spell-vfx-layer",
      canvasId: "fire-spell-vfx",
      fallbackWidthPx: 1280,
      fallbackHeightPx: 720,
      maxDpr: 1.25,
      flameScale: 1.0,
      origin: [0.33, -0.47],
      target: [0.0, 0.055],
    },
  },
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readNumber(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(record?.[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readVec2(record: Record<string, unknown> | undefined, key: string, fallback: SpellVec2): SpellVec2 {
  const value = record?.[key];
  if (!Array.isArray(value) || value.length < 2) return fallback;

  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return [Math.min(2, Math.max(-2, x)), Math.min(2, Math.max(-2, y))];
}

export function parseSpellConfig(text: string = spellsYamlText): SpellConfig {
  try {
    const parsed = asRecord(load(text));
    const root = asRecord(parsed?.spells);
    const menu = asRecord(root?.menu);
    const fire = asRecord(root?.fire);
    const audio = asRecord(fire?.audio);
    const vfx = asRecord(fire?.vfx);

    return {
      menu: {
        rootId: readString(menu, "root_id", DEFAULT_SPELL_CONFIG.menu.rootId),
        title: readString(menu, "title", DEFAULT_SPELL_CONFIG.menu.title),
      },
      fire: {
        id: "fire",
        label: readString(fire, "label", DEFAULT_SPELL_CONFIG.fire.label),
        castDurationMs: readNumber(fire, "cast_duration_ms", DEFAULT_SPELL_CONFIG.fire.castDurationMs, 250, 8000),
        audio: {
          volume: readNumber(audio, "volume", DEFAULT_SPELL_CONFIG.fire.audio.volume, 0, 1),
        },
        vfx: {
          layerId: readString(vfx, "layer_id", DEFAULT_SPELL_CONFIG.fire.vfx.layerId),
          canvasId: readString(vfx, "canvas_id", DEFAULT_SPELL_CONFIG.fire.vfx.canvasId),
          fallbackWidthPx: readNumber(vfx, "fallback_width_px", DEFAULT_SPELL_CONFIG.fire.vfx.fallbackWidthPx, 160, 2560),
          fallbackHeightPx: readNumber(vfx, "fallback_height_px", DEFAULT_SPELL_CONFIG.fire.vfx.fallbackHeightPx, 120, 1440),
          maxDpr: readNumber(vfx, "max_dpr", DEFAULT_SPELL_CONFIG.fire.vfx.maxDpr, 1, 3),
          flameScale: readNumber(vfx, "flame_scale", DEFAULT_SPELL_CONFIG.fire.vfx.flameScale, 0.25, 3),
          origin: readVec2(vfx, "origin", DEFAULT_SPELL_CONFIG.fire.vfx.origin),
          target: readVec2(vfx, "target", DEFAULT_SPELL_CONFIG.fire.vfx.target),
        },
      },
    };
  } catch (error) {
    console.warn("[spells] Failed to parse spell config, using defaults.", error);
    return DEFAULT_SPELL_CONFIG;
  }
}

export const defaultSpellConfig = parseSpellConfig();
