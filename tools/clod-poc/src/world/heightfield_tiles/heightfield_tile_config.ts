import { load } from "js-yaml";

export interface HeightfieldTileConfig {
  enabled: boolean;
  radiusM: number;
  maxResidentTiles: number;
  maxInflightBatches: number;
  maxTilesPerBatch: number;
  evictDistanceMultiplier: number;
  retryCooldownFrames: number;
  predictionSeconds: number;
  backgroundBuildIntervalFrames?: number;
  persistenceEnabled: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("heightfield tile config must be an object");
  }
  return value as Record<string, unknown>;
}

function booleanValue(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key];
  if (typeof value !== "boolean") throw new Error(`heightfield_tiles.${key} must be boolean`);
  return value;
}

function numberValue(raw: Record<string, unknown>, key: string, min: number): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new Error(`heightfield_tiles.${key} must be a finite number >= ${min}`);
  }
  return value;
}

function integerValue(raw: Record<string, unknown>, key: string, min: number): number {
  const value = numberValue(raw, key, min);
  if (!Number.isInteger(value)) throw new Error(`heightfield_tiles.${key} must be an integer`);
  return value;
}

export function parseHeightfieldTileConfig(text: string): HeightfieldTileConfig {
  const raw = asRecord(load(text));
  return Object.freeze({
    enabled: booleanValue(raw, "enabled"),
    radiusM: numberValue(raw, "radius_m", 0),
    maxResidentTiles: integerValue(raw, "max_resident_tiles", 1),
    maxInflightBatches: integerValue(raw, "max_inflight_batches", 1),
    maxTilesPerBatch: integerValue(raw, "max_tiles_per_batch", 1),
    evictDistanceMultiplier: numberValue(raw, "evict_distance_multiplier", 1),
    retryCooldownFrames: integerValue(raw, "retry_cooldown_frames", 0),
    predictionSeconds: numberValue(raw, "prediction_seconds", 0),
    backgroundBuildIntervalFrames: integerValue(raw, "background_build_interval_frames", 1),
    persistenceEnabled: booleanValue(raw, "persistence_enabled"),
  });
}

export function heightfieldTilesEnabled(
  config: HeightfieldTileConfig,
  searchParams: URLSearchParams,
  worldMode: string,
): boolean {
  const raw = searchParams.get("heightTiles") ?? searchParams.get("height_tiles");
  const requested = raw === null ? (worldMode === "continent" || config.enabled) : raw !== "0" && raw !== "false";
  return requested && (worldMode === "infinite_islands" || worldMode === "continent");
}
