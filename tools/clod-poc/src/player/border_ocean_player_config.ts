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

const CONFIG_NAME = "Border ocean gameplay config";

type YamlRecord = Record<string, unknown>;

function record(value: unknown): YamlRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as YamlRecord : null;
}

function readPresentBoolean(recordValue: YamlRecord, snakeKey: string, camelKey: string): boolean {
  const value = recordValue[snakeKey] ?? recordValue[camelKey];
  if (typeof value !== "boolean") {
    throw new Error(`${CONFIG_NAME}: ${snakeKey} must be boolean`);
  }
  return value;
}

function readPresentNumber(recordValue: YamlRecord, snakeKey: string, camelKey: string): number {
  const value = recordValue[snakeKey] ?? recordValue[camelKey];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${CONFIG_NAME}: ${snakeKey} must be a finite number`);
  }
  if (value < 0) {
    throw new Error(`${CONFIG_NAME}: ${snakeKey} must be >= 0`);
  }
  return value;
}

export function validateBorderOceanGameplayConfig(config: BorderOceanGameplayConfig): void {
  if (!Number.isFinite(config.worldEdgeMarginM) || config.worldEdgeMarginM <= 0) {
    throw new Error(`${CONFIG_NAME}: worldEdgeMarginM must be a finite number > 0`);
  }
  if (!Number.isFinite(config.pushbackStartInsideWorldM) || config.pushbackStartInsideWorldM < 0) {
    throw new Error(`${CONFIG_NAME}: pushbackStartInsideWorldM must be a finite number >= 0`);
  }
  if (!Number.isFinite(config.pushbackStrength) || config.pushbackStrength < 0) {
    throw new Error(`${CONFIG_NAME}: pushbackStrength must be a finite number >= 0`);
  }
  if (!config.softPushbackEnabled) return;
  if (config.pushbackStartInsideWorldM <= 0) {
    throw new Error(
      `${CONFIG_NAME}: pushbackStartInsideWorldM must be > 0 when soft pushback is enabled`,
    );
  }
  if (config.pushbackStrength <= 0) {
    throw new Error(
      `${CONFIG_NAME}: pushbackStrength must be > 0 when soft pushback is enabled`,
    );
  }
}

export function parseBorderOceanGameplayConfig(text: string): BorderOceanGameplayConfig {
  const root = record(load(text));
  const gameplay = record(root?.gameplay);
  if (!gameplay) return { ...DEFAULT_GAMEPLAY_CONFIG };

  const config = {
    softPushbackEnabled: readPresentBoolean(gameplay, "soft_pushback_enabled", "softPushbackEnabled"),
    worldEdgeMarginM: readPresentNumber(gameplay, "world_edge_margin_m", "worldEdgeMarginM"),
    pushbackStartInsideWorldM: readPresentNumber(
      gameplay,
      "pushback_start_inside_world_m",
      "pushbackStartInsideWorldM",
    ),
    pushbackStrength: readPresentNumber(gameplay, "pushback_strength", "pushbackStrength"),
  };
  validateBorderOceanGameplayConfig(config);
  return config;
}

export function resolvePlayerConfigForBorderOcean(
  base: Readonly<PlayerConfig>,
  gameplay: BorderOceanGameplayConfig,
): PlayerConfig {
  validateBorderOceanGameplayConfig(gameplay);
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
