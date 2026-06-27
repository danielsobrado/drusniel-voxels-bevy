import { load } from "js-yaml";

export type RgbColor = [number, number, number];

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

export interface DeepOceanWaveConfig {
  gravity: number;
  gridK: number;
  activeGpuWaves: number;
  windSpeed: number;
  windDirectionDeg: number;
  heightScale: number;
  choppiness: number;
  coarsePatchM: number;
  finePatchM: number;
  foamThreshold: number;
  foamPower: number;
  foamIntensity: number;
  swellHeightScale: number;
}

export interface DeepOceanShadingConfig {
  deepColor: RgbColor;
  shallowColor: RgbColor;
  foamColor: RgbColor;
  fresnelPower: number;
  fresnelStrength: number;
  reflectionStrength: number;
  reflectionDistortion: number;
  roughness: number;
  fogColor: RgbColor;
  fogNearM: number;
  fogFarM: number;
  fogDensity: number;
}

export interface DeepOceanRenderConfig {
  enabled: boolean;
  startOutsideBorderM: number;
  extendCells: number;
  surfaceY: number;
  segments: number;
  wave: DeepOceanWaveConfig;
  shading: DeepOceanShadingConfig;
}

export interface BorderCoastOceanConfig {
  enabled: boolean;
  coast: BorderCoastBandConfig;
  ocean: BorderOceanConfig;
  deepOcean: DeepOceanRenderConfig;
}

export const DEFAULT_DEEP_OCEAN_WAVE_CONFIG: DeepOceanWaveConfig = {
  gravity: 9.81,
  gridK: 16,
  activeGpuWaves: 48,
  windSpeed: 14.0,
  windDirectionDeg: 45,
  heightScale: 1.3,
  choppiness: 1.6,
  coarsePatchM: 250,
  finePatchM: 37,
  foamThreshold: 0.5,
  foamPower: 1.36,
  foamIntensity: 1.25,
  swellHeightScale: 0.34,
};

export const DEFAULT_DEEP_OCEAN_SHADING_CONFIG: DeepOceanShadingConfig = {
  deepColor: [0.016, 0.173, 0.306],
  shallowColor: [0.039, 0.361, 0.353],
  foamColor: [1.0, 1.0, 1.0],
  fresnelPower: 4.5,
  fresnelStrength: 0.75,
  reflectionStrength: 0.46,
  reflectionDistortion: 0.04,
  roughness: 0.08,
  fogColor: [0.278, 0.380, 0.427],
  fogNearM: 100,
  fogFarM: 1800,
  fogDensity: 0.5,
};

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
    startOutsideBorderM: 64,
    extendCells: 384,
    surfaceY: 18,
    segments: 256,
    wave: { ...DEFAULT_DEEP_OCEAN_WAVE_CONFIG },
    shading: {
      ...DEFAULT_DEEP_OCEAN_SHADING_CONFIG,
      deepColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.deepColor] as RgbColor,
      shallowColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.shallowColor] as RgbColor,
      foamColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.foamColor] as RgbColor,
      fogColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.fogColor] as RgbColor,
    },
  },
};

type YamlRecord = Record<string, unknown>;

function readRecord(value: unknown): YamlRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as YamlRecord : undefined;
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

function readIntegerAtLeast(value: unknown, fallback: number, min: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, n);
}

function readColor(value: unknown, fallback: RgbColor): RgbColor {
  if (typeof value === "string") {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
    if (match) {
      const raw = Number.parseInt(match[1], 16);
      return [
        ((raw >> 16) & 255) / 255,
        ((raw >> 8) & 255) / 255,
        (raw & 255) / 255,
      ];
    }
  }
  if (Array.isArray(value) && value.length >= 3) {
    return [
      readNumber(value[0], fallback[0]),
      readNumber(value[1], fallback[1]),
      readNumber(value[2], fallback[2]),
    ];
  }
  return [...fallback] as RgbColor;
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
    deepOcean: {
      ...defaults.deepOcean,
      wave: { ...defaults.deepOcean.wave },
      shading: {
        ...defaults.deepOcean.shading,
        deepColor: [...defaults.deepOcean.shading.deepColor] as RgbColor,
        shallowColor: [...defaults.deepOcean.shading.shallowColor] as RgbColor,
        foamColor: [...defaults.deepOcean.shading.foamColor] as RgbColor,
        fogColor: [...defaults.deepOcean.shading.fogColor] as RgbColor,
      },
    },
  };
}

function parseDeepOceanWaveConfig(root: YamlRecord | undefined, fallback: DeepOceanWaveConfig): DeepOceanWaveConfig {
  return {
    gravity: readNumberAtLeast(root?.gravity, fallback.gravity, 0.01),
    gridK: readIntegerAtLeast(root?.grid_k ?? root?.gridK, fallback.gridK, 2),
    activeGpuWaves: readIntegerAtLeast(root?.active_gpu_waves ?? root?.activeGpuWaves, fallback.activeGpuWaves, 1),
    windSpeed: readNumberAtLeast(root?.wind_speed ?? root?.windSpeed, fallback.windSpeed, 0.01),
    windDirectionDeg: readNumber(root?.wind_direction_deg ?? root?.windDirectionDeg, fallback.windDirectionDeg),
    heightScale: readNumberAtLeast(root?.height_scale ?? root?.heightScale, fallback.heightScale, 0),
    choppiness: readNumberAtLeast(root?.choppiness, fallback.choppiness, 0),
    coarsePatchM: readNumberAtLeast(root?.coarse_patch_m ?? root?.coarsePatchM, fallback.coarsePatchM, 1),
    finePatchM: readNumberAtLeast(root?.fine_patch_m ?? root?.finePatchM, fallback.finePatchM, 1),
    foamThreshold: readNumberAtLeast(root?.foam_threshold ?? root?.foamThreshold, fallback.foamThreshold, 0),
    foamPower: readNumberAtLeast(root?.foam_power ?? root?.foamPower, fallback.foamPower, 0),
    foamIntensity: readNumberAtLeast(root?.foam_intensity ?? root?.foamIntensity, fallback.foamIntensity, 0),
    swellHeightScale: readNumberAtLeast(root?.swell_height_scale ?? root?.swellHeightScale, fallback.swellHeightScale, 0),
  };
}

function parseDeepOceanShadingConfig(root: YamlRecord | undefined, fallback: DeepOceanShadingConfig): DeepOceanShadingConfig {
  const fogNear = readNumberAtLeast(root?.fog_near_m ?? root?.fogNearM, fallback.fogNearM, 0);
  const fogFar = Math.max(
    fogNear + 1,
    readNumberAtLeast(root?.fog_far_m ?? root?.fogFarM, fallback.fogFarM, 0),
  );
  return {
    deepColor: readColor(root?.deep_color ?? root?.deepColor, fallback.deepColor),
    shallowColor: readColor(root?.shallow_color ?? root?.shallowColor, fallback.shallowColor),
    foamColor: readColor(root?.foam_color ?? root?.foamColor, fallback.foamColor),
    fresnelPower: readNumberAtLeast(root?.fresnel_power ?? root?.fresnelPower, fallback.fresnelPower, 0),
    fresnelStrength: readNumberAtLeast(root?.fresnel_strength ?? root?.fresnelStrength, fallback.fresnelStrength, 0),
    reflectionStrength: readNumberAtLeast(root?.reflection_strength ?? root?.reflectionStrength, fallback.reflectionStrength, 0),
    reflectionDistortion: readNumberAtLeast(root?.reflection_distortion ?? root?.reflectionDistortion, fallback.reflectionDistortion, 0),
    roughness: readNumberAtLeast(root?.roughness, fallback.roughness, 0),
    fogColor: readColor(root?.fog_color ?? root?.fogColor, fallback.fogColor),
    fogNearM: fogNear,
    fogFarM: fogFar,
    fogDensity: readNumberAtLeast(root?.fog_density ?? root?.fogDensity, fallback.fogDensity, 0),
  };
}

function parseDeepOceanConfig(root: YamlRecord | undefined, waterLevel: number, fallback: DeepOceanRenderConfig): DeepOceanRenderConfig {
  const wave = parseDeepOceanWaveConfig(readRecord(root?.wave), fallback.wave);
  const shading = parseDeepOceanShadingConfig(readRecord(root?.shading), fallback.shading);
  return {
    enabled: readBoolean(root?.enabled, fallback.enabled),
    startOutsideBorderM: readNumberAtLeast(root?.start_outside_border_m ?? root?.startOutsideBorderM, fallback.startOutsideBorderM, 0),
    extendCells: readIntegerAtLeast(root?.extend_cells ?? root?.visual_extent_m ?? root?.extendCells, fallback.extendCells, 1),
    surfaceY: readNumber(root?.surface_y ?? root?.surfaceY, waterLevel),
    segments: readIntegerAtLeast(root?.segments ?? root?.far_subdivisions ?? root?.farSubdivisions, fallback.segments, 4),
    wave,
    shading,
  };
}

function parseLegacyConfig(root: YamlRecord): BorderCoastOceanConfig {
  const defaults = DEFAULT_BORDER_COAST_OCEAN_CONFIG;
  const coast = readRecord(root.coast);
  const beach = readRecord(coast?.beach);
  const cliff = readRecord(coast?.cliff);
  const ocean = readRecord(root.ocean);
  const deepOcean = readRecord(root.deep_ocean ?? root.deepOcean);
  const waterLevel = readNumber(ocean?.surface_y ?? ocean?.surfaceY, defaults.ocean.surfaceY);

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
      surfaceY: waterLevel,
      minDepth: readNumber(ocean?.min_depth, defaults.ocean.minDepth),
      maxDepth: readNumber(ocean?.max_depth, defaults.ocean.maxDepth),
    },
    deepOcean: parseDeepOceanConfig(deepOcean, waterLevel, defaults.deepOcean),
  };
}

function parseUnifiedConfig(root: YamlRecord): BorderCoastOceanConfig {
  const defaults = DEFAULT_BORDER_COAST_OCEAN_CONFIG;
  const world = readRecord(root.world);
  const coast = readRecord(root.coast);
  const band = readRecord(coast?.band);
  const beach = readRecord(coast?.beach);
  const cliff = readRecord(coast?.cliff);
  const deepOcean = readRecord(root.deep_ocean ?? root.deepOcean);

  const waterLevel = readNumber(world?.water_level ?? world?.waterLevel, defaults.ocean.surfaceY);
  const bandWidth = readIntegerAtLeast(band?.width_m ?? band?.widthM, defaults.coast.oceanStartCells + defaults.coast.shoreBackshoreCells, 1);
  const backshore = readIntegerAtLeast(band?.inner_fade_m ?? band?.innerFadeM, defaults.coast.shoreBackshoreCells, 1);
  const oceanStart = Math.max(1, bandWidth - backshore);

  return {
    enabled: readBoolean(coast?.enabled, defaults.enabled),
    coast: {
      oceanStartCells: oceanStart,
      oceanFullDepthCells: Math.min(oceanStart, readIntegerAtLeast(band?.outer_fade_m ?? band?.outerFadeM, defaults.coast.oceanFullDepthCells, 0)),
      shoreBackshoreCells: backshore,
      shorelineCellCells: readIntegerAtLeast(band?.segment_length_m ?? band?.segmentLengthM, defaults.coast.shorelineCellCells, 1),
      cliffHeadlandThreshold: defaults.coast.cliffHeadlandThreshold,
      cliffModulo: defaults.coast.cliffModulo,
      beach: {
        waterlineOffset: defaults.coast.beach.waterlineOffset,
        backshoreHeightAboveWater: defaults.coast.beach.backshoreHeightAboveWater,
        beachShelfCells: readIntegerAtLeast(beach?.wet_sand_width_m ?? beach?.wetSandWidthM, defaults.coast.beach.beachShelfCells, 0),
      },
      cliff: {
        minHeightAboveWater: readNumber(cliff?.min_height_m ?? cliff?.minHeightM, defaults.coast.cliff.minHeightAboveWater),
        inlandBoost: defaults.coast.cliff.inlandBoost,
      },
    },
    ocean: {
      surfaceY: waterLevel,
      minDepth: defaults.ocean.minDepth,
      maxDepth: defaults.ocean.maxDepth,
    },
    deepOcean: parseDeepOceanConfig(deepOcean, waterLevel, defaults.deepOcean),
  };
}

export function parseBorderCoastOceanConfig(text: string): BorderCoastOceanConfig {
  if (!text.trim()) return cloneDefaults();

  const raw = readRecord(load(text));
  if (!raw) return cloneDefaults();
  const inner = readRecord(raw.border_coast_ocean) ?? raw;
  if (inner.world || inner.materials || inner.surf) return parseUnifiedConfig(inner);
  return parseLegacyConfig(inner);
}
