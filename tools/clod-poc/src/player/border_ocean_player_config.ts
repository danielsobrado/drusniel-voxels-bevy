import { load } from "js-yaml";
import {
  DEFAULT_PLAYER_CONFIG,
  type PlayerConfig,
} from "../player_controller.js";

export interface BorderOceanGameplayConfig {
  softPushbackEnabled: boolean;
  worldEdgeMarginM: number;
  pushbackStartInsideWorldM: number;
  pushbackStrength: number;
}

const DEFAULT_GAMEPLAY_CONFIG: BorderOceanGameplayConfig = {
  softPushbackEnabled: true,
  worldEdgeMarginM: DEFAULT_PLAYER_CONFIG.worldEdgeMargin,
  pushbackStartInsideWorldM: DEFAULT_PLAYER_CONFIG.worldEdgePushbackBand,
  pushbackStrength: DEFAULT_PLAYER_CONFIG.worldEdgePushbackAcceleration,
};

type YamlRecord = Record<string, unknown>;

function record(value: unknown): YamlRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as YamlRecord : null;
}

function readNumber(value: unknown, fallback: number, min = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, value)
    : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseBorderOceanGameplayConfig(text: string): BorderOceanGameplayConfig {
  const root = record(load(text));
  const gameplay = record(root?.gameplay);
  if (!gameplay) return { ...DEFAULT_GAMEPLAY_CONFIG };

  return {
    softPushbackEnabled: readBoolean(
      gameplay.soft_pushback_enabled ?? gameplay.softPushbackEnabled,
      DEFAULT_GAMEPLAY_CONFIG.softPushbackEnabled,
    ),
    worldEdgeMarginM: readNumber(
      gameplay.world_edge_margin_m ?? gameplay.worldEdgeMarginM,
      DEFAULT_GAMEPLAY_CONFIG.worldEdgeMarginM,
    ),
    pushbackStartInsideWorldM: readNumber(
      gameplay.pushback_start_inside_world_m ?? gameplay.pushbackStartInsideWorldM,
      DEFAULT_GAMEPLAY_CONFIG.pushbackStartInsideWorldM,
    ),
    pushbackStrength: readNumber(
      gameplay.pushback_strength ?? gameplay.pushbackStrength,
      DEFAULT_GAMEPLAY_CONFIG.pushbackStrength,
    ),
  };
}

export function resolvePlayerConfigForBorderOcean(
  base: Readonly<PlayerConfig>,
  gameplay: BorderOceanGameplayConfig,
): PlayerConfig {
  return {
    ...base,
    worldEdgeMargin: gameplay.worldEdgeMarginM,
    worldEdgePushbackBand: gameplay.softPushbackEnabled
      ? gameplay.pushbackStartInsideWorldM
      : 0,
    worldEdgePushbackAcceleration: gameplay.softPushbackEnabled
      ? gameplay.pushbackStrength
      : 0,
  };
}
