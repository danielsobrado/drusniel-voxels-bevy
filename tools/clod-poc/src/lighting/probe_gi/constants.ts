export const PROBE_GI_SCHEMA_VERSION = 1;
export const PROBE_GI_CASCADE_IDS = ["near", "mid", "far"] as const;
export const PROBE_GI_DIMENSIONS = [32, 8, 32] as const;
export const PROBE_GI_PROBES_PER_CASCADE = 32 * 8 * 32;
export const PROBE_GI_TOTAL_PROBES = PROBE_GI_PROBES_PER_CASCADE * 3;
export const PROBE_GI_RECORD_BYTES = 96;
export const PROBE_GI_RECORD_FLOAT_COMPONENTS = 20;
export const PROBE_GI_RECORD_U32_COMPONENTS = 4;
export const PROBE_GI_RECORD_WORD_STRIDE = PROBE_GI_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT;
export const PROBE_GI_SH_TEXTURE_COUNT_PER_CASCADE = 3;
export const PROBE_GI_PUBLICATION_BUFFER_COUNT = 2;
export const PROBE_GI_RELOCATION_AXIS_SAMPLE_FRACTION = 0.5;
export const PROBE_GI_VALIDITY_EPSILON = 1e-5;
export const PROBE_GI_COLUMN_TAG_EMPTY = -2_147_483_648;

export const PROBE_GI_FIXED_CASCADES = [
  {
    id: "near",
    spacingM: 4,
    layerHeightsM: [1, 2.5, 5, 9, 15, 24, 38, 60],
    maximumTraceDistanceM: 96,
    purposeBias: -0.25,
  },
  {
    id: "mid",
    spacingM: 16,
    layerHeightsM: [2, 5, 10, 18, 30, 48, 76, 120],
    maximumTraceDistanceM: 384,
    purposeBias: 0.25,
  },
  {
    id: "far",
    spacingM: 64,
    layerHeightsM: [4, 10, 20, 36, 60, 96, 152, 240],
    maximumTraceDistanceM: 1536,
    purposeBias: 0.75,
  },
] as const;

export const PROBE_GI_FLAGS = {
  valid: 1 << 0,
  relocated: 1 << 1,
  terrainUnknown: 1 << 2,
  enclosed: 1 << 3,
} as const;
