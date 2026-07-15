export const EROSION_SCHEMA_VERSION = 2 as const;
export const EROSION_ARTIFACT_MAGIC = "DREROSN2";
export const EROSION_ARTIFACT_HEADER_BYTES = 64;

export const HEIGHT_UNITS_PER_METER = 256;
export const WATER_UNITS_PER_METER = 4096;
export const SEDIMENT_UNITS_PER_METER = 65536;
export const FLUX_UNITS_PER_METER = 65536;
export const VELOCITY_UNITS_PER_CELL = 4096;
export const HARDNESS_MAX = 0xffff;
export const FRACTION_Q16_ONE = 0x10000;
export const WORKGROUP_SIZE_X = 8;
export const WORKGROUP_SIZE_Y = 8;
export const MAX_ZSTD_RAW_BLOCK_BYTES = 128 * 1024;

export const EROSION_ASYNC_ROWS_PER_YIELD = 8;
export const EROSION_ASYNC_CELLS_PER_YIELD = 64 * 1024;
export const EROSION_READBACK_CHUNK_BYTES = 4 * 1024 * 1024;
export const EROSION_GPU_PERSIST_GROUP_MULTIPLIER = 8;

export const CARDINAL_DIRECTIONS = Object.freeze([
  Object.freeze({ dx: -1, dz: 0 }),
  Object.freeze({ dx: 1, dz: 0 }),
  Object.freeze({ dx: 0, dz: -1 }),
  Object.freeze({ dx: 0, dz: 1 }),
] as const);
