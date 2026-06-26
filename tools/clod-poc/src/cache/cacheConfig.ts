import { load } from "js-yaml";
import type { CacheChecksumMode, CacheCompressionMode } from "./cacheTypes.js";
import { CacheConfigError } from "./cacheErrors.js";

export interface ClodCacheMemoryConfig {
  enabled: boolean;
  max_items: number;
  max_bytes: number;
}

export interface ClodCachePersistentConfig {
  enabled: boolean;
  backend: "indexeddb";
  database_name: string;
  object_store_name: string;
  max_items: number;
  max_bytes: number;
  compression: CacheCompressionMode;
  checksum: CacheChecksumMode;
}

export interface ClodCacheInvalidationConfig {
  include_config_hash: boolean;
  include_generator_version: boolean;
  include_builder_version: boolean;
  include_world_seed: boolean;
  include_source_revision: boolean;
  include_source_hash: boolean;
}

export interface ClodCacheStreamingConfig {
  read_budget_per_frame: number;
  write_budget_per_frame: number;
  max_decode_ms_per_frame: number;
  max_encode_ms_per_frame: number;
  keep_stale_until_replacement: boolean;
}

export interface ClodCacheDebugConfig {
  log_cache_hits: boolean;
  log_cache_misses: boolean;
  log_cache_evictions: boolean;
  expose_overlay_stats: boolean;
}

export interface ClodCacheConfig {
  enabled: boolean;
  namespace: string;
  schema_version: number;
  builder_version: string;
  strict: boolean;
  memory: ClodCacheMemoryConfig;
  persistent: ClodCachePersistentConfig;
  invalidation: ClodCacheInvalidationConfig;
  streaming: ClodCacheStreamingConfig;
  debug: ClodCacheDebugConfig;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CacheConfigError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boolAt(raw: Record<string, unknown>, key: string, path: string): boolean {
  const value = raw[key];
  if (typeof value !== "boolean") throw new CacheConfigError(`${path}.${key} must be boolean`);
  return value;
}

function stringAt(raw: Record<string, unknown>, key: string, path: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CacheConfigError(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function intAt(raw: Record<string, unknown>, key: string, path: string, min = 0): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new CacheConfigError(`${path}.${key} must be an integer >= ${min}`);
  }
  return value;
}

function numberAt(raw: Record<string, unknown>, key: string, path: string, min = 0): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new CacheConfigError(`${path}.${key} must be a finite number >= ${min}`);
  }
  return value;
}

function compressionAt(raw: Record<string, unknown>, key: string, path: string): CacheCompressionMode {
  const value = raw[key];
  if (value !== "none" && value !== "gzip") {
    throw new CacheConfigError(`${path}.${key} must be "none" or "gzip"`);
  }
  return value;
}

export function parseClodCacheConfig(text: string): ClodCacheConfig {
  const parsed = load(text);
  const root = asRecord(parsed, "root");
  const cache = asRecord(root.cache, "cache");

  const memory = asRecord(cache.memory, "cache.memory");
  const persistent = asRecord(cache.persistent, "cache.persistent");
  const invalidation = asRecord(cache.invalidation, "cache.invalidation");
  const streaming = asRecord(cache.streaming, "cache.streaming");
  const debug = asRecord(cache.debug, "cache.debug");

  return {
    enabled: boolAt(cache, "enabled", "cache"),
    namespace: stringAt(cache, "namespace", "cache"),
    schema_version: intAt(cache, "schema_version", "cache", 1),
    builder_version: stringAt(cache, "builder_version", "cache"),
    strict: cache.strict === undefined ? false : boolAt(cache, "strict", "cache"),
    memory: {
      enabled: boolAt(memory, "enabled", "cache.memory"),
      max_items: intAt(memory, "max_items", "cache.memory", 1),
      max_bytes: intAt(memory, "max_bytes", "cache.memory", 1),
    },
    persistent: {
      enabled: boolAt(persistent, "enabled", "cache.persistent"),
      backend: "indexeddb",
      database_name: stringAt(persistent, "database_name", "cache.persistent"),
      object_store_name: stringAt(persistent, "object_store_name", "cache.persistent"),
      max_items: intAt(persistent, "max_items", "cache.persistent", 1),
      max_bytes: intAt(persistent, "max_bytes", "cache.persistent", 1),
      compression: compressionAt(persistent, "compression", "cache.persistent"),
      checksum: "sha256",
    },
    invalidation: {
      include_config_hash: boolAt(invalidation, "include_config_hash", "cache.invalidation"),
      include_generator_version: boolAt(invalidation, "include_generator_version", "cache.invalidation"),
      include_builder_version: boolAt(invalidation, "include_builder_version", "cache.invalidation"),
      include_world_seed: boolAt(invalidation, "include_world_seed", "cache.invalidation"),
      include_source_revision: boolAt(invalidation, "include_source_revision", "cache.invalidation"),
      include_source_hash: invalidation.include_source_hash === undefined
        ? true
        : boolAt(invalidation, "include_source_hash", "cache.invalidation"),
    },
    streaming: {
      read_budget_per_frame: intAt(streaming, "read_budget_per_frame", "cache.streaming", 1),
      write_budget_per_frame: intAt(streaming, "write_budget_per_frame", "cache.streaming", 1),
      max_decode_ms_per_frame: numberAt(streaming, "max_decode_ms_per_frame", "cache.streaming", 0),
      max_encode_ms_per_frame: numberAt(streaming, "max_encode_ms_per_frame", "cache.streaming", 0),
      keep_stale_until_replacement: boolAt(streaming, "keep_stale_until_replacement", "cache.streaming"),
    },
    debug: {
      log_cache_hits: boolAt(debug, "log_cache_hits", "cache.debug"),
      log_cache_misses: boolAt(debug, "log_cache_misses", "cache.debug"),
      log_cache_evictions: boolAt(debug, "log_cache_evictions", "cache.debug"),
      expose_overlay_stats: boolAt(debug, "expose_overlay_stats", "cache.debug"),
    },
  };
}

let sessionDisabled = false;

export function setCacheSessionDisabled(disabled: boolean): void {
  sessionDisabled = disabled;
}

export function isCacheSessionDisabled(): boolean {
  return sessionDisabled;
}

export function isCacheEffective(config: ClodCacheConfig): boolean {
  return config.enabled && !sessionDisabled;
}
