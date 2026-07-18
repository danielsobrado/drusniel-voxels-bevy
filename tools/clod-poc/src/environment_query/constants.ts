export const ENVIRONMENT_QUERY_SOURCE_NAMES = [
  "live-terrain",
  "terrain-tile",
  "clod-summary",
  "far-summary",
  "hydrology-atlas",
  "hydrology-cpu",
  "sun-visibility-cache",
  "fallback",
] as const;

export const ENVIRONMENT_QUERY_FIELD_NAMES = [
  "surface",
  "normal",
  "material",
  "water",
  "river",
  "visibility",
] as const;

export const ENVIRONMENT_QUERY_FIELD = {
  surface: 1 << 0,
  normal: 1 << 1,
  material: 1 << 2,
  water: 1 << 3,
  river: 1 << 4,
  visibility: 1 << 5,
} as const;

export const ENVIRONMENT_QUERY_ALL_FIELDS =
  ENVIRONMENT_QUERY_FIELD.surface |
  ENVIRONMENT_QUERY_FIELD.normal |
  ENVIRONMENT_QUERY_FIELD.material |
  ENVIRONMENT_QUERY_FIELD.water |
  ENVIRONMENT_QUERY_FIELD.river |
  ENVIRONMENT_QUERY_FIELD.visibility;

export const DEFAULT_ENVIRONMENT_SAMPLE_HINT_M = 1;
export const MIN_ENVIRONMENT_SAMPLE_HINT_M = 0.01;
export const MAX_ENVIRONMENT_SAMPLE_HINT_M = 65_536;
