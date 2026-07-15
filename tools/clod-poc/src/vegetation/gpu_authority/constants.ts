export const VEGETATION_SCHEMA_VERSION = 1 as const;
export const VEGETATION_CLUSTER_SIZE_M = 32 as const;
export const VEGETATION_CLUSTER_PROBE_GRID = 3 as const;
export const VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M = -1_000_000 as const;
export const VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_THRESHOLD_M = -500_000 as const;

export const VEGETATION_CATEGORY = {
  TREE: 1,
  GRASS: 2,
  UNDERSTORY: 3,
  STONE: 4,
  DRESSING: 5,
} as const;

export type VegetationCategory = typeof VEGETATION_CATEGORY[keyof typeof VEGETATION_CATEGORY];
export type VegetationCategoryName = "trees" | "grass" | "understory" | "stones" | "dressing";

export const VEGETATION_CATEGORY_NAMES = [
  "trees",
  "grass",
  "understory",
  "stones",
  "dressing",
] as const satisfies readonly VegetationCategoryName[];

export const VEGETATION_CATEGORY_BY_NAME: Readonly<Record<VegetationCategoryName, VegetationCategory>> = {
  trees: VEGETATION_CATEGORY.TREE,
  grass: VEGETATION_CATEGORY.GRASS,
  understory: VEGETATION_CATEGORY.UNDERSTORY,
  stones: VEGETATION_CATEGORY.STONE,
  dressing: VEGETATION_CATEGORY.DRESSING,
};

export const VEGETATION_CHANNEL = {
  DOMAIN: 0x1001,
  CLUSTER_ID: 0x1002,
  IDENTITY: 0x1003,
  JITTER: 0x1004,
  CLASS: 0x1005,
  SCALE: 0x1006,
  ROTATION: 0x1007,
  WIND: 0x1008,
  AGE: 0x1009,
  HEALTH: 0x100a,
} as const;

export const VEGETATION_CLUSTER_REJECTION = {
  OUTSIDE_WORLD: 1 << 0,
  TERRAIN_HIDDEN: 1 << 1,
  NO_SURFACE_COVERAGE: 1 << 2,
  WATER_ONLY: 1 << 3,
  CAVE_VOID_ONLY: 1 << 4,
  STRUCTURE_EXCLUDED: 1 << 5,
  EDIT_EXCLUDED: 1 << 6,
  DISTANCE_CULLED: 1 << 7,
} as const;

export const VEGETATION_SURFACE_VALIDITY = {
  MISSING: 0,
  COARSE: 1,
  CANONICAL_HEIGHTFIELD: 2,
  CANONICAL_WITH_VOXEL: 3,
} as const;

export type VegetationSurfaceValidity = typeof VEGETATION_SURFACE_VALIDITY[keyof typeof VEGETATION_SURFACE_VALIDITY];

export const VEGETATION_SURFACE_FLAG = {
  TERRAIN_EDITED: 1 << 0,
  STRUCTURE_EXCLUDED: 1 << 1,
  PERSISTENT_EXCLUDED: 1 << 2,
} as const;

export const VEGETATION_AUTHORITY_WORKGROUP_SIZE = {
  CLASSIFY_CLUSTERS: 64,
  GENERATE_ACCEPT: 128,
  CLASSIFY_LOD_SHADOW: 128,
} as const;
