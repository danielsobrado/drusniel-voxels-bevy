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

export function parseBorderCoastOceanConfig(text: string): BorderCoastOceanConfig {
  const defaults = DEFAULT_BORDER_COAST_OCEAN_CONFIG;
  if (!text.trim()) return { ...defaults, coast: { ...defaults.coast, beach: { ...defaults.coast.beach }, cliff: { ...defaults.coast.cliff } }, ocean: { ...defaults.ocean }, deepOcean: { ...defaults.deepOcean } };

  const raw = load(text) as {
    border_coast_ocean?: {
      enabled?: unknown;
      coast?: {
        ocean_start_cells?: unknown;
        ocean_full_depth_cells?: unknown;
        shore_backshore_cells?: unknown;
        shoreline_cell_cells?: unknown;
        cliff_headland_threshold?: unknown;
        cliff_modulo?: unknown;
        beach?: {
          waterline_offset?: unknown;
          backshore_height_above_water?: unknown;
          beach_shelf_cells?: unknown;
        };
        cliff?: {
          min_height_above_water?: unknown;
          inland_boost?: unknown;
        };
      };
      ocean?: {
        surface_y?: unknown;
        min_depth?: unknown;
        max_depth?: unknown;
      };
      deep_ocean?: {
        enabled?: unknown;
        extend_cells?: unknown;
        surface_y?: unknown;
        segments?: unknown;
      };
    };
  };
  const root = raw.border_coast_ocean ?? {};

  return {
    enabled: readBoolean(root.enabled, defaults.enabled),
    coast: {
      oceanStartCells: readIntegerAtLeast(root.coast?.ocean_start_cells, defaults.coast.oceanStartCells, 1),
      oceanFullDepthCells: readIntegerAtLeast(root.coast?.ocean_full_depth_cells, defaults.coast.oceanFullDepthCells, 0),
      shoreBackshoreCells: readIntegerAtLeast(root.coast?.shore_backshore_cells, defaults.coast.shoreBackshoreCells, 1),
      shorelineCellCells: readIntegerAtLeast(root.coast?.shoreline_cell_cells, defaults.coast.shorelineCellCells, 1),
      cliffHeadlandThreshold: readNumber(root.coast?.cliff_headland_threshold, defaults.coast.cliffHeadlandThreshold),
      cliffModulo: readIntegerAtLeast(root.coast?.cliff_modulo, defaults.coast.cliffModulo, 2),
      beach: {
        waterlineOffset: readNumber(root.coast?.beach?.waterline_offset, defaults.coast.beach.waterlineOffset),
        backshoreHeightAboveWater: readNumber(
          root.coast?.beach?.backshore_height_above_water,
          defaults.coast.beach.backshoreHeightAboveWater,
        ),
        beachShelfCells: readIntegerAtLeast(root.coast?.beach?.beach_shelf_cells, defaults.coast.beach.beachShelfCells, 0),
      },
      cliff: {
        minHeightAboveWater: readNumber(root.coast?.cliff?.min_height_above_water, defaults.coast.cliff.minHeightAboveWater),
        inlandBoost: readNumber(root.coast?.cliff?.inland_boost, defaults.coast.cliff.inlandBoost),
      },
    },
    ocean: {
      surfaceY: readNumber(root.ocean?.surface_y, defaults.ocean.surfaceY),
      minDepth: readNumber(root.ocean?.min_depth, defaults.ocean.minDepth),
      maxDepth: readNumber(root.ocean?.max_depth, defaults.ocean.maxDepth),
    },
    deepOcean: {
      enabled: readBoolean(root.deep_ocean?.enabled, defaults.deepOcean.enabled),
      extendCells: readIntegerAtLeast(root.deep_ocean?.extend_cells, defaults.deepOcean.extendCells, 1),
      surfaceY: readNumber(root.deep_ocean?.surface_y, defaults.deepOcean.surfaceY),
      segments: readIntegerAtLeast(root.deep_ocean?.segments, defaults.deepOcean.segments, 4),
    },
  };
}
