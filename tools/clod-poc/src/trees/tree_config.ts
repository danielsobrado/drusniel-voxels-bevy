import { load } from "js-yaml";

export type TreeSpeciesId = "oak" | "pine" | "dead";
export type TreeLod = "near" | "mid" | "far";

export const TREE_SPECIES: readonly TreeSpeciesId[] = ["oak", "pine", "dead"] as const;
export const TREE_LODS: readonly TreeLod[] = ["near", "mid", "far"] as const;

export interface TreeSpeciesSettings {
  enabled: boolean;
  weight: number;
  minHeightM: number;
  maxHeightM: number;
  trunkHeightM: number;
  trunkRadiusM: number;
  crownRadiusM: number;
}

export interface TreePlacementSettings {
  spacingM: number;
  jitter: number;
  slopeMinY: number;
  minHeightM: number;
  maxHeightM: number;
  minGroundWeight: number;
  minSpacingM: number;
}

export interface TreeLodSettings {
  nearFraction: number;
  midFraction: number;
  farFraction: number;
}

export interface TreeRenderSettings {
  shadowsNearOnly: boolean;
  debugColorByLod: boolean;
}

export interface TreeSettings {
  enabled: boolean;
  seed: number;
  distanceM: number;
  refreshDistanceM: number;
  maxNewPatchesPerFrame: number;
  maxInstances: number;
  placement: TreePlacementSettings;
  lod: TreeLodSettings;
  species: Record<TreeSpeciesId, TreeSpeciesSettings>;
  render: TreeRenderSettings;
}

interface TreeYamlSpecies {
  enabled?: boolean;
  weight?: number;
  min_height_m?: number;
  max_height_m?: number;
  trunk_height_m?: number;
  trunk_radius_m?: number;
  crown_radius_m?: number;
}

interface TreeYamlConfig {
  trees?: {
    enabled?: boolean;
    seed?: number;
    distance_m?: number;
    refresh_distance_m?: number;
    max_new_patches_per_frame?: number;
    max_instances?: number;
    placement?: {
      spacing_m?: number;
      jitter?: number;
      slope_min_y?: number;
      min_height_m?: number;
      max_height_m?: number;
      min_ground_weight?: number;
      min_spacing_m?: number;
    };
    lod?: {
      near_fraction?: number;
      mid_fraction?: number;
      far_fraction?: number;
    };
    species?: Partial<Record<TreeSpeciesId, TreeYamlSpecies>>;
    render?: {
      shadows_near_only?: boolean;
      debug_color_by_lod?: boolean;
    };
  };
}

export const DEFAULT_TREE_SETTINGS: TreeSettings = {
  enabled: true,
  seed: 7331,
  distanceM: 220,
  refreshDistanceM: 16,
  maxNewPatchesPerFrame: 1,
  maxInstances: 2500,
  placement: {
    spacingM: 14,
    jitter: 0.42,
    slopeMinY: 0.78,
    minHeightM: 12,
    maxHeightM: 48,
    minGroundWeight: 0.2,
    minSpacingM: 8,
  },
  lod: {
    nearFraction: 0.35,
    midFraction: 0.70,
    farFraction: 1.0,
  },
  species: {
    oak: {
      enabled: true,
      weight: 0.55,
      minHeightM: 12,
      maxHeightM: 34,
      trunkHeightM: 4.5,
      trunkRadiusM: 0.35,
      crownRadiusM: 2.8,
    },
    pine: {
      enabled: true,
      weight: 0.35,
      minHeightM: 18,
      maxHeightM: 48,
      trunkHeightM: 6.5,
      trunkRadiusM: 0.28,
      crownRadiusM: 2.4,
    },
    dead: {
      enabled: true,
      weight: 0.10,
      minHeightM: 18,
      maxHeightM: 46,
      trunkHeightM: 5.2,
      trunkRadiusM: 0.25,
      crownRadiusM: 0.0,
    },
  },
  render: {
    shadowsNearOnly: false,
    debugColorByLod: false,
  },
};

export function cloneTreeSettings(settings: TreeSettings = DEFAULT_TREE_SETTINGS): TreeSettings {
  return {
    ...settings,
    placement: { ...settings.placement },
    lod: { ...settings.lod },
    render: { ...settings.render },
    species: {
      oak: { ...settings.species.oak },
      pine: { ...settings.species.pine },
      dead: { ...settings.species.dead },
    },
  };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNumberAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readSpecies(base: TreeSpeciesSettings, raw: TreeYamlSpecies | undefined): TreeSpeciesSettings {
  return {
    enabled: readBoolean(raw?.enabled, base.enabled),
    weight: readNumberAtLeast(raw?.weight, base.weight, 0),
    minHeightM: readNumber(raw?.min_height_m, base.minHeightM),
    maxHeightM: readNumber(raw?.max_height_m, base.maxHeightM),
    trunkHeightM: readNumberAtLeast(raw?.trunk_height_m, base.trunkHeightM, 0.1),
    trunkRadiusM: readNumberAtLeast(raw?.trunk_radius_m, base.trunkRadiusM, 0.01),
    crownRadiusM: readNumberAtLeast(raw?.crown_radius_m, base.crownRadiusM, 0),
  };
}

function warnTreeConfig(message: string, warn?: (message: string) => void): void {
  warn?.(`[tree-config] ${message}`);
}

export function parseTreeConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): TreeSettings {
  const fallback = cloneTreeSettings();
  if (!text || text.trim() === "") return fallback;

  let rawConfig: TreeYamlConfig;
  try {
    rawConfig = (load(text) ?? {}) as TreeYamlConfig;
  } catch (error) {
    warnTreeConfig(`failed to parse config/trees.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`, warn ?? undefined);
    return fallback;
  }

  const raw = rawConfig.trees ?? {};
  return {
    enabled: readBoolean(raw.enabled, fallback.enabled),
    seed: Math.floor(readNumber(raw.seed, fallback.seed)),
    distanceM: readNumberAtLeast(raw.distance_m, fallback.distanceM, 0),
    refreshDistanceM: readNumberAtLeast(raw.refresh_distance_m, fallback.refreshDistanceM, 0.1),
    maxNewPatchesPerFrame: Math.floor(readNumberAtLeast(
      raw.max_new_patches_per_frame,
      fallback.maxNewPatchesPerFrame,
      1,
    )),
    maxInstances: Math.floor(readNumberAtLeast(raw.max_instances, fallback.maxInstances, 0)),
    placement: {
      spacingM: readNumberAtLeast(raw.placement?.spacing_m, fallback.placement.spacingM, 0.5),
      jitter: readNumberAtLeast(raw.placement?.jitter, fallback.placement.jitter, 0),
      slopeMinY: readNumber(raw.placement?.slope_min_y, fallback.placement.slopeMinY),
      minHeightM: readNumber(raw.placement?.min_height_m, fallback.placement.minHeightM),
      maxHeightM: readNumber(raw.placement?.max_height_m, fallback.placement.maxHeightM),
      minGroundWeight: readNumberAtLeast(raw.placement?.min_ground_weight, fallback.placement.minGroundWeight, 0),
      minSpacingM: readNumberAtLeast(raw.placement?.min_spacing_m, fallback.placement.minSpacingM, 0),
    },
    lod: {
      nearFraction: readNumberAtLeast(raw.lod?.near_fraction, fallback.lod.nearFraction, 0),
      midFraction: readNumberAtLeast(raw.lod?.mid_fraction, fallback.lod.midFraction, 0),
      farFraction: readNumberAtLeast(raw.lod?.far_fraction, fallback.lod.farFraction, 0),
    },
    species: {
      oak: readSpecies(fallback.species.oak, raw.species?.oak),
      pine: readSpecies(fallback.species.pine, raw.species?.pine),
      dead: readSpecies(fallback.species.dead, raw.species?.dead),
    },
    render: {
      shadowsNearOnly: readBoolean(raw.render?.shadows_near_only, fallback.render.shadowsNearOnly),
      debugColorByLod: readBoolean(raw.render?.debug_color_by_lod, fallback.render.debugColorByLod),
    },
  };
}
