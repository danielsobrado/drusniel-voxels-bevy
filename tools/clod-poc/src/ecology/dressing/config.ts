import { load } from "js-yaml";

export type DressingQuality = "ultra" | "balanced" | "perf" | "potato";

export interface DressingConfig {
  readonly schemaVersion: number;
  readonly enabled: boolean;
  readonly clusterSizeM: number;
  readonly generatorSchemaVersion: number;
  readonly persistence: {
    readonly stableEnvironmentalProps: boolean;
    readonly saveCosmeticItems: false;
  };
  readonly densities: {
    readonly deadfallPerHectare: number;
    readonly stumpsPerHectare: number;
    readonly brokenSnagsPerHectare: number;
    readonly mossPatchesPerHectare: number;
    readonly lichenPatchesPerHectare: number;
    readonly litterClustersPerHectare: number;
    readonly twigClustersPerHectare: number;
    readonly riverCobbleClustersPer100m: number;
    readonly driftwoodPer100m: number;
    readonly caveMouthFernsPer100m2: number;
  };
  readonly cosmeticDensityMultiplier: Readonly<Record<DressingQuality, number>>;
  readonly lod: {
    readonly persistent: readonly [number, number, number];
    readonly parentAttached: readonly [number, number, number];
    readonly terrainAttached: readonly [number, number, number];
  };
  readonly shadow: {
    readonly persistentNear: boolean;
    readonly persistentProxyFar: boolean;
    readonly parentAttachedNear: boolean;
    readonly terrainAttachedNear: boolean;
  };
  readonly invalidation: {
    readonly debounceMs: number;
    readonly maximumClustersPerFrame: number;
  };
  readonly debug: {
    readonly showClass: boolean;
    readonly showAnchors: boolean;
    readonly showRejections: boolean;
  };
}

export const DEFAULT_DRESSING_CONFIG: DressingConfig = Object.freeze({
  schemaVersion: 1,
  enabled: true,
  clusterSizeM: 32,
  generatorSchemaVersion: 1,
  persistence: { stableEnvironmentalProps: true, saveCosmeticItems: false as const },
  densities: {
    deadfallPerHectare: 28,
    stumpsPerHectare: 12,
    brokenSnagsPerHectare: 6,
    mossPatchesPerHectare: 180,
    lichenPatchesPerHectare: 90,
    litterClustersPerHectare: 420,
    twigClustersPerHectare: 160,
    riverCobbleClustersPer100m: 18,
    driftwoodPer100m: 2,
    caveMouthFernsPer100m2: 8,
  },
  cosmeticDensityMultiplier: { ultra: 1, balanced: 0.75, perf: 0.5, potato: 0.3 },
  lod: {
    persistent: [45, 180, 700] as const,
    parentAttached: [25, 90, 260] as const,
    terrainAttached: [20, 70, 220] as const,
  },
  shadow: {
    persistentNear: true,
    persistentProxyFar: true,
    parentAttachedNear: false,
    terrainAttachedNear: false,
  },
  invalidation: { debounceMs: 100, maximumClustersPerFrame: 8 },
  debug: { showClass: false, showAnchors: false, showRejections: false },
});

const ROOT_KEYS = new Set(["schema_version", "enabled", "cluster_size_m", "generator_schema_version", "persistence", "densities", "cosmetic_density_multiplier", "lod", "shadow", "invalidation", "debug"]);
const PERSISTENCE_KEYS = new Set(["stable_environmental_props", "save_cosmetic_items"]);
const DENSITY_KEYS = new Set(["deadfall_per_hectare", "stumps_per_hectare", "broken_snags_per_hectare", "moss_patches_per_hectare", "lichen_patches_per_hectare", "litter_clusters_per_hectare", "twig_clusters_per_hectare", "river_cobble_clusters_per_100m", "driftwood_per_100m", "cave_mouth_ferns_per_100m2"]);
const QUALITY_KEYS = new Set(["ultra", "balanced", "perf", "potato"]);
const LOD_KEYS = new Set(["persistent", "parent_attached", "terrain_attached"]);
const SHADOW_KEYS = new Set(["persistent_near", "persistent_proxy_far", "parent_attached_near", "terrain_attached_near"]);
const INVALIDATION_KEYS = new Set(["debounce_ms", "maximum_clusters_per_frame"]);
const DEBUG_KEYS = new Set(["show_class", "show_anchors", "show_rejections"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown ${label} key: ${unknown}`);
}

function finite(value: unknown, fallback: number, label: string, min = 0): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) throw new Error(`${label} must be a finite number >= ${min}`);
  return value;
}

function integer(value: unknown, fallback: number, label: string, min = 0): number {
  const result = finite(value, fallback, label, min);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer`);
  return result;
}

function bool(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function lod(value: unknown, fallback: readonly [number, number, number], label: string): readonly [number, number, number] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain three distances`);
  const result = value.map((entry, index) => finite(entry, fallback[index], `${label}[${index}]`)) as [number, number, number];
  if (result[0] > result[1] || result[1] > result[2]) throw new Error(`${label} distances must be ordered`);
  return result;
}

export function parseDressingConfig(text: string): DressingConfig {
  const document = record(load(text), "dressing config");
  assertKnownKeys(document, new Set(["ecological_dressing"]), "config root");
  const root = record(document.ecological_dressing, "ecological_dressing");
  assertKnownKeys(root, ROOT_KEYS, "ecological_dressing");
  const persistence = record(root.persistence, "persistence");
  const densities = record(root.densities, "densities");
  const multipliers = record(root.cosmetic_density_multiplier, "cosmetic_density_multiplier");
  const lodRoot = record(root.lod, "lod");
  const shadow = record(root.shadow, "shadow");
  const invalidation = record(root.invalidation, "invalidation");
  const debug = record(root.debug, "debug");
  assertKnownKeys(persistence, PERSISTENCE_KEYS, "persistence");
  assertKnownKeys(densities, DENSITY_KEYS, "densities");
  assertKnownKeys(multipliers, QUALITY_KEYS, "cosmetic_density_multiplier");
  assertKnownKeys(lodRoot, LOD_KEYS, "lod");
  assertKnownKeys(shadow, SHADOW_KEYS, "shadow");
  assertKnownKeys(invalidation, INVALIDATION_KEYS, "invalidation");
  assertKnownKeys(debug, DEBUG_KEYS, "debug");
  const fallback = DEFAULT_DRESSING_CONFIG;
  const saveCosmetics = bool(persistence.save_cosmetic_items, false, "save_cosmetic_items");
  if (saveCosmetics) throw new Error("cosmetic dressing items may not be serialized");
  return {
    schemaVersion: integer(root.schema_version, fallback.schemaVersion, "schema_version", 1),
    enabled: bool(root.enabled, fallback.enabled, "enabled"),
    clusterSizeM: finite(root.cluster_size_m, fallback.clusterSizeM, "cluster_size_m", 1),
    generatorSchemaVersion: integer(root.generator_schema_version, fallback.generatorSchemaVersion, "generator_schema_version", 1),
    persistence: {
      stableEnvironmentalProps: bool(persistence.stable_environmental_props, true, "stable_environmental_props"),
      saveCosmeticItems: false,
    },
    densities: {
      deadfallPerHectare: finite(densities.deadfall_per_hectare, fallback.densities.deadfallPerHectare, "deadfall_per_hectare"),
      stumpsPerHectare: finite(densities.stumps_per_hectare, fallback.densities.stumpsPerHectare, "stumps_per_hectare"),
      brokenSnagsPerHectare: finite(densities.broken_snags_per_hectare, fallback.densities.brokenSnagsPerHectare, "broken_snags_per_hectare"),
      mossPatchesPerHectare: finite(densities.moss_patches_per_hectare, fallback.densities.mossPatchesPerHectare, "moss_patches_per_hectare"),
      lichenPatchesPerHectare: finite(densities.lichen_patches_per_hectare, fallback.densities.lichenPatchesPerHectare, "lichen_patches_per_hectare"),
      litterClustersPerHectare: finite(densities.litter_clusters_per_hectare, fallback.densities.litterClustersPerHectare, "litter_clusters_per_hectare"),
      twigClustersPerHectare: finite(densities.twig_clusters_per_hectare, fallback.densities.twigClustersPerHectare, "twig_clusters_per_hectare"),
      riverCobbleClustersPer100m: finite(densities.river_cobble_clusters_per_100m, fallback.densities.riverCobbleClustersPer100m, "river_cobble_clusters_per_100m"),
      driftwoodPer100m: finite(densities.driftwood_per_100m, fallback.densities.driftwoodPer100m, "driftwood_per_100m"),
      caveMouthFernsPer100m2: finite(densities.cave_mouth_ferns_per_100m2, fallback.densities.caveMouthFernsPer100m2, "cave_mouth_ferns_per_100m2"),
    },
    cosmeticDensityMultiplier: {
      ultra: finite(multipliers.ultra, fallback.cosmeticDensityMultiplier.ultra, "ultra", 0),
      balanced: finite(multipliers.balanced, fallback.cosmeticDensityMultiplier.balanced, "balanced", 0),
      perf: finite(multipliers.perf, fallback.cosmeticDensityMultiplier.perf, "perf", 0),
      potato: finite(multipliers.potato, fallback.cosmeticDensityMultiplier.potato, "potato", 0),
    },
    lod: {
      persistent: lod(lodRoot.persistent, fallback.lod.persistent, "lod.persistent"),
      parentAttached: lod(lodRoot.parent_attached, fallback.lod.parentAttached, "lod.parent_attached"),
      terrainAttached: lod(lodRoot.terrain_attached, fallback.lod.terrainAttached, "lod.terrain_attached"),
    },
    shadow: {
      persistentNear: bool(shadow.persistent_near, true, "persistent_near"),
      persistentProxyFar: bool(shadow.persistent_proxy_far, true, "persistent_proxy_far"),
      parentAttachedNear: bool(shadow.parent_attached_near, false, "parent_attached_near"),
      terrainAttachedNear: bool(shadow.terrain_attached_near, false, "terrain_attached_near"),
    },
    invalidation: {
      debounceMs: finite(invalidation.debounce_ms, fallback.invalidation.debounceMs, "debounce_ms"),
      maximumClustersPerFrame: integer(invalidation.maximum_clusters_per_frame, fallback.invalidation.maximumClustersPerFrame, "maximum_clusters_per_frame", 1),
    },
    debug: {
      showClass: bool(debug.show_class, false, "show_class"),
      showAnchors: bool(debug.show_anchors, false, "show_anchors"),
      showRejections: bool(debug.show_rejections, false, "show_rejections"),
    },
  };
}

export function acceptsCosmeticAtQuality(stableIdLowWord: number, quality: DressingQuality, config: DressingConfig): boolean {
  const multiplier = Math.max(0, Math.min(1, config.cosmeticDensityMultiplier[quality]));
  return (stableIdLowWord >>> 0) / 0x1_0000_0000 < multiplier;
}
