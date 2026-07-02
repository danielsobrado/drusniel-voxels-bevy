import type { BorderOceanGameplayConfig, CoastTypeWeightsConfig } from "./border_coast_ocean_config_types.js";
import { CONFIG_NAME, HEX_COLOR } from "./border_coast_ocean_config_defaults.js";

export function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) {
    throw new Error(`${CONFIG_NAME}: missing required section '${path}'`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${CONFIG_NAME}: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function numberAt(
  record: Record<string, unknown>,
  key: string,
  path: string,
  min = -Infinity,
  max = Infinity,
): number {
  const value = record[key];
  const field = `${path}.${key}`;
  if (value === undefined) throw new Error(`${CONFIG_NAME}: missing required field '${field}'`);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${CONFIG_NAME}: ${field} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new Error(`${CONFIG_NAME}: ${field} must be in [${min}, ${max}], got ${value}`);
  }
  return value;
}

export function integerAt(
  record: Record<string, unknown>,
  key: string,
  path: string,
  min = -Infinity,
  max = Infinity,
): number {
  const value = numberAt(record, key, path, min, max);
  if (!Number.isInteger(value)) {
    throw new Error(`${CONFIG_NAME}: ${path}.${key} must be an integer, got ${value}`);
  }
  return value;
}

export function booleanAt(record: Record<string, unknown>, key: string, path: string): boolean {
  const value = record[key];
  const field = `${path}.${key}`;
  if (value === undefined) throw new Error(`${CONFIG_NAME}: missing required field '${field}'`);
  if (typeof value !== "boolean") {
    throw new Error(`${CONFIG_NAME}: ${field} must be boolean`);
  }
  return value;
}

export function stringAt(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  const field = `${path}.${key}`;
  if (value === undefined) throw new Error(`${CONFIG_NAME}: missing required field '${field}'`);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${CONFIG_NAME}: ${field} must be a non-empty string`);
  }
  return value;
}

export function colorAt(record: Record<string, unknown>, key: string, path: string): string {
  const value = stringAt(record, key, path);
  if (!HEX_COLOR.test(value)) {
    throw new Error(`${CONFIG_NAME}: ${path}.${key} must be a six-digit hex color`);
  }
  return value;
}

export function probabilityAt(record: Record<string, unknown>, key: string, path: string): number {
  return Math.min(1, Math.max(0, numberAt(record, key, path)));
}

export function normalizeTypeWeights(raw: Record<string, unknown>): CoastTypeWeightsConfig {
  const weights: CoastTypeWeightsConfig = {
    sandy_beach: numberAt(raw, "sandy_beach", "coast.type_weights", 0),
    rocky_beach: numberAt(raw, "rocky_beach", "coast.type_weights", 0),
    cliff: numberAt(raw, "cliff", "coast.type_weights", 0),
    cove: numberAt(raw, "cove", "coast.type_weights", 0),
    reef: numberAt(raw, "reef", "coast.type_weights", 0),
  };
  const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
  if (sum <= 0) {
    throw new Error(`${CONFIG_NAME}: coast.type_weights must contain at least one positive weight`);
  }
  return {
    sandy_beach: weights.sandy_beach / sum,
    rocky_beach: weights.rocky_beach / sum,
    cliff: weights.cliff / sum,
    cove: weights.cove / sum,
    reef: weights.reef / sum,
  };
}

export function validateGameplayRelationships(config: BorderOceanGameplayConfig): void {
  if (config.world_edge_margin_m <= 0) {
    throw new Error(`${CONFIG_NAME}: gameplay.world_edge_margin_m must be greater than 0`);
  }
  if (!config.soft_pushback_enabled) return;
  if (config.pushback_start_inside_world_m <= 0) {
    throw new Error(
      `${CONFIG_NAME}: gameplay.pushback_start_inside_world_m must be greater than 0 when soft pushback is enabled`,
    );
  }
  if (config.pushback_strength <= 0) {
    throw new Error(
      `${CONFIG_NAME}: gameplay.pushback_strength must be greater than 0 when soft pushback is enabled`,
    );
  }
}
