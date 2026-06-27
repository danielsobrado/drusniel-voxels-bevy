import { load } from "js-yaml";

export interface BorderCoastBeachConfig {
  waterlineOffset: number;
  backshoreHeightAboveWater: number;
  beachShelfCells: number;
}

export interface BorderCoastCliffConfig {
  minHeightAboveWater: number;
  inlandBoost: number;
}

export interface BorderCoastBandConfig {
  oceanStartCells: number;
  oceanFullDepthCells: number;
  shoreBackshoreCells: number;
  shorelineCellCells: number;
  cliffHeadlandThreshold: number;
  cliffModulo: number;
  beach: BorderCoastBeachConfig;
  cliff: BorderCoastCliffConfig;
}

export interface BorderOceanConfig {
  surfaceY: number;
  minDepth: number;
  maxDepth: number;
}

export interface DeepOceanRenderConfig {
  enabled: boolean;
  extendCells: number;
  surfaceY: number;
  segments: number;
}

export interface BorderCoastOceanConfig {
  enabled: boolean;
  coast: BorderCoastBandConfig;
  ocean: BorderOceanConfig;
  deepOcean: DeepOceanRenderConfig;
}

export const DEFAULT_BORDER_COAST_OCEAN_CONFIG: BorderCoastOceanConfig = {
  enabled: true,
  coast: {
    oceanStartCells: 48,
    oceanFullDepthCells: 16,
    shoreBackshoreCells: 32,
    shorelineCellCells: 32,
    cliffHeadlandThreshold: 0.58,
    cliffModulo: 7,
    beach: {
      waterlineOffset: -0.25,
      backshoreHeightAboveWater: 5.0,
      beachShelfCells: 8,
    },
    cliff: {
      minHeightAboveWater: 16.0,
      inlandBoost: 4.0,
    },
  },
  ocean: {
    surfaceY: 18,
    minDepth: 2.0,
    maxDepth: 16.0,
  },
  deepOcean: {
    enabled: true,
    extendCells: 384,
    surfaceY: 18,
    segments: 64,
  },
};

type YamlRecord = Record<string, unknown>;

function readRecord(value: unknown): YamlRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as YamlRecord : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readIntegerAtLeast(value: unknown, fallback: number, min: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, n);
}

function cloneDefaults(): BorderCoastOceanConfig {
  const defaults = DEFAULT_BORDER_COAST_OCEAN_CONFIG;
  return {
    enabled: defaults.enabled,
    coast: {
      ...defaults.coast,
      beach: { ...defaults.coast.beach },
      cliff: { ...defaults.coast.cliff },
    },
    ocean: { ...defaults.ocean },
    deepOcean: { ...defaults.deepOcean },
  };
}

function parseLegacyConfig(root: YamlRecord): BorderCoastOceanConfig {
  const defaults = DEFAULT_BORDER_COAST_OCEAN_CONFIG;
  const coast = readRecord(root.coast);
  const beach = readRecord(coast?.beach);
  const cliff = readRecord(coast?.cliff);
  const ocean = readRecord(root.ocean);
  const deepOcean = readRecord(root.deep_ocean);

  return {
    enabled: readBoolean(root.enabled, defaults.enabled),
    coast: {
      oceanStartCells: readIntegerAtLeast(coast?.ocean_start_cells, defaults.coast.oceanStartCells, 1),
      oceanFullDepthCells: readIntegerAtLeast(coast?.ocean_full_depth_cells, defaults.coast.oceanFullDepthCells, 0),
      shoreBackshoreCells: readIntegerAtLeast(coast?.shore_backshore_cells, defaults.coast.shoreBackshoreCells, 1),
      shorelineCellCells: readIntegerAtLeast(coast?.shoreline_cell_cells, defaults.coast.shorelineCellCells, 1),
      cliffHeadlandThreshold: readNumber(coast?.cliff_headland_threshold, defaults.coast.cliffHeadlandThreshold),
      cliffModulo: readIntegerAtLeast(coast?.cliff_modulo, defaults.coast.cliffModulo, 2),
      beach: {
        waterlineOffset: readNumber(beach?.waterline_offset, defaults.coast.beach.waterlineOffset),
        backshoreHeightAboveWater: readNumber(beach?.backshore_height_above_water, defaults.coast.beach.backshoreHeightAboveWater),
        beachShelfCells: readIntegerAtLeast(beach?.beach_shelf_cells, defaults.coast.beach.beachShelfCells, 0),
      },
      cliff: {
        minHeightAboveWater: readNumber(cliff?.min_height_above_water, defaults.coast.cliff.minHeightAboveWater),
        inlandBoost: readNumber(cliff?.inland_boost, defaults.coast.cliff.inlandBoost),
      },
    },
    ocean: {
      surfaceY: readNumber(ocean?.surface_y, defaults.ocean.surfaceY),
      minDepth: readNumber(ocean?.min_depth, defaults.ocean.minDepth),
      maxDepth: readNumber(ocean?.max_depth, defaults.ocean.maxDepth),
    },
    deepOcean: {
      enabled: readBoolean(deepOcean?.enabled, defaults.deepOcean.enabled),
      extendCells: readIntegerAtLeast(deepOcean?.extend_cells, defaults.deepOcean.extendCells, 1),
      surfaceY: readNumber(deepOcean?.surface_y, defaults.deepOcean.surfaceY),
      segments: readIntegerAtLeast(deepOcean?.segments, defaults.deepOcean.segments, 4),
    },
  };
}

function parseUnifiedConfig(root: YamlRecord): BorderCoastOceanConfig {
  const defaults = DEFAULT_BORDER_COAST_OCEAN_CONFIG;
  const world = readRecord(root.world);
  const coast = readRecord(root.coast);
  const band = readRecord(coast?.band);
  const beach = readRecord(coast?.beach);
  const cliff = readRecord(coast?.cliff);
  const deepOcean = readRecord(root.deep_ocean);

  const waterLevel = readNumber(world?.water_level, defaults.ocean.surfaceY);
  const bandWidth = readIntegerAtLeast(band?.width_m, defaults.coast.oceanStartCells + defaults.coast.shoreBackshoreCells, 1);
  const backshore = readIntegerAtLeast(band?.inner_fade_m, defaults.coast.shoreBackshoreCells, 1);
  const oceanStart = Math.max(1, bandWidth - backshore);

  return {
    enabled: readBoolean(coast?.enabled, defaults.enabled),
    coast: {
      oceanStartCells: oceanStart,
      oceanFullDepthCells: Math.min(oceanStart, readIntegerAtLeast(band?.outer_fade_m, defaults.coast.oceanFullDepthCells, 0)),
      shoreBackshoreCells: backshore,
      shorelineCellCells: readIntegerAtLeast(band?.segment_length_m, defaults.coast.shorelineCellCells, 1),
      cliffHeadlandThreshold: defaults.coast.cliffHeadlandThreshold,
      cliffModulo: defaults.coast.cliffModulo,
      beach: {
        waterlineOffset: defaults.coast.beach.waterlineOffset,
        backshoreHeightAboveWater: defaults.coast.beach.backshoreHeightAboveWater,
        beachShelfCells: readIntegerAtLeast(beach?.wet_sand_width_m, defaults.coast.beach.beachShelfCells, 0),
      },
      cliff: {
        minHeightAboveWater: readNumber(cliff?.min_height_m, defaults.coast.cliff.minHeightAboveWater),
        inlandBoost: defaults.coast.cliff.inlandBoost,
      },
    },
    ocean: {
      surfaceY: waterLevel,
      minDepth: defaults.ocean.minDepth,
      maxDepth: defaults.ocean.maxDepth,
    },
    deepOcean: {
      enabled: readBoolean(deepOcean?.enabled, defaults.deepOcean.enabled),
      extendCells: readIntegerAtLeast(deepOcean?.visual_extent_m, defaults.deepOcean.extendCells, 1),
      surfaceY: waterLevel,
      segments: readIntegerAtLeast(deepOcean?.far_subdivisions, defaults.deepOcean.segments, 4),
    },
  };
}

export function parseBorderCoastOceanConfig(text: string): BorderCoastOceanConfig {
  if (!text.trim()) return cloneDefaults();

  const raw = readRecord(load(text));
  if (!raw) return cloneDefaults();

  const legacy = readRecord(raw.border_coast_ocean);
  if (legacy) return parseLegacyConfig(legacy);

  return parseUnifiedConfig(raw);
}
