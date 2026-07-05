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
  detailNormalStrength: number;
  detailNormalFadeStartM: number;
  detailNormalFadeEndM: number;
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
  skyZenithColor: RgbColor;
  sssColor: RgbColor;
  sssStrength: number;
  horizonBlendStartM: number;
  horizonBlendEndM: number;
  edgeFadeM: number;
}

export interface DeepOceanRenderConfig {
  enabled: boolean;
  startOutsideBorderM: number;
  extendCells: number;
  surfaceY: number;
  segments: number;
  nearGridSizeM: number;
  midGridSizeM: number;
  farGridSizeM: number;
  nearSubdivisions: number;
  midSubdivisions: number;
  farSubdivisions: number;
  ringInnerBandM: number;
  ringInnerRadialSegments: number;
  ringOuterRadialSegments: number;
  ringTangentialSegments: number;
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
  activeGpuWaves: 24,
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
  detailNormalStrength: 0.35,
  detailNormalFadeStartM: 200,
  detailNormalFadeEndM: 900,
};

export const DEFAULT_DEEP_OCEAN_SHADING_CONFIG: DeepOceanShadingConfig = {
  deepColor: [0.016, 0.161, 0.290],
  shallowColor: [0.051, 0.420, 0.400],
  foamColor: [1.0, 1.0, 1.0],
  fresnelPower: 4.5,
  fresnelStrength: 0.75,
  reflectionStrength: 0.46,
  reflectionDistortion: 0.04,
  roughness: 0.08,
  fogColor: [0.498, 0.596, 0.675],
  fogNearM: 100,
  fogFarM: 2200,
  fogDensity: 1.0,
  skyZenithColor: [0.165, 0.373, 0.620],
  sssColor: [0.055, 0.353, 0.306],
  sssStrength: 0.9,
  horizonBlendStartM: 3520,
  horizonBlendEndM: 4400,
  edgeFadeM: 48,
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
    extendCells: 4096,
    surfaceY: 18,
    segments: 128,
    nearGridSizeM: 512,
    midGridSizeM: 2048,
    farGridSizeM: 2048,
    nearSubdivisions: 128,
    midSubdivisions: 128,
    farSubdivisions: 128,
    ringInnerBandM: 512,
    ringInnerRadialSegments: 64,
    ringOuterRadialSegments: 24,
    ringTangentialSegments: 288,
    wave: { ...DEFAULT_DEEP_OCEAN_WAVE_CONFIG },
    shading: {
      ...DEFAULT_DEEP_OCEAN_SHADING_CONFIG,
      deepColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.deepColor] as RgbColor,
      shallowColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.shallowColor] as RgbColor,
      foamColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.foamColor] as RgbColor,
      fogColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.fogColor] as RgbColor,
      skyZenithColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.skyZenithColor] as RgbColor,
      sssColor: [...DEFAULT_DEEP_OCEAN_SHADING_CONFIG.sssColor] as RgbColor,
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

function cloneShading(shading: DeepOceanShadingConfig): DeepOceanShadingConfig {
  return {
    ...shading,
    deepColor: [...shading.deepColor] as RgbColor,
    shallowColor: [...shading.shallowColor] as RgbColor,
    foamColor: [...shading.foamColor] as RgbColor,
    fogColor: [...shading.fogColor] as RgbColor,
    skyZenithColor: [...shading.skyZenithColor] as RgbColor,
    sssColor: [...shading.sssColor] as RgbColor,
  };
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
      shading: cloneShading(defaults.deepOcean.shading),
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
    detailNormalStrength: readNumberAtLeast(root?.detail_normal_strength ?? root?.detailNormalStrength, fallback.detailNormalStrength, 0),
    detailNormalFadeStartM: readNumberAtLeast(root?.detail_normal_fade_start_m ?? root?.detailNormalFadeStartM, fallback.detailNormalFadeStartM, 0),
    detailNormalFadeEndM: readNumberAtLeast(root?.detail_normal_fade_end_m ?? root?.detailNormalFadeEndM, fallback.detailNormalFadeEndM, 0),
  };
}

function parseDeepOceanShadingConfig(root: YamlRecord | undefined, fallback: DeepOceanShadingConfig): DeepOceanShadingConfig {
  const fogNear = readNumberAtLeast(root?.fog_near_m ?? root?.fogNearM, fallback.fogNearM, 0);
  const fogFar = Math.max(fogNear + 1, readNumberAtLeast(root?.fog_far_m ?? root?.fogFarM, fallback.fogFarM, 0));
  const horizonStart = readNumberAtLeast(root?.horizon_blend_start_m ?? root?.horizonBlendStartM, fallback.horizonBlendStartM, 0);
  const horizonEnd = Math.max(horizonStart + 1, readNumberAtLeast(root?.horizon_blend_end_m ?? root?.horizonBlendEndM, fallback.horizonBlendEndM, 0));
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
    skyZenithColor: readColor(root?.sky_zenith_color ?? root?.skyZenithColor, fallback.skyZenithColor),
    sssColor: readColor(root?.sss_color ?? root?.sssColor, fallback.sssColor),
    sssStrength: readNumberAtLeast(root?.sss_strength ?? root?.sssStrength, fallback.sssStrength, 0),
    horizonBlendStartM: horizonStart,
    horizonBlendEndM: horizonEnd,
    edgeFadeM: readNumberAtLeast(root?.edge_fade_m ?? root?.edgeFadeM, fallback.edgeFadeM, 0),
  };
}

function parseDeepOceanConfig(root: YamlRecord | undefined, waterLevel: number, fallback: DeepOceanRenderConfig): DeepOceanRenderConfig {
  const wave = parseDeepOceanWaveConfig(readRecord(root?.wave), fallback.wave);
  const shading = parseDeepOceanShadingConfig(readRecord(root?.shading), fallback.shading);
  const visualExtent = readIntegerAtLeast(root?.extend_cells ?? root?.visual_extent_m ?? root?.visualExtentM ?? root?.extendCells, fallback.extendCells, 1);
  return {
    enabled: readBoolean(root?.enabled, fallback.enabled),
    startOutsideBorderM: readNumberAtLeast(root?.start_outside_border_m ?? root?.startOutsideBorderM, fallback.startOutsideBorderM, 0),
    extendCells: visualExtent,
    surfaceY: readNumber(root?.surface_y ?? root?.surfaceY, waterLevel),
    segments: readIntegerAtLeast(root?.segments ?? root?.far_subdivisions ?? root?.farSubdivisions, fallback.segments, 4),
    nearGridSizeM: readNumberAtLeast(root?.near_grid_size_m ?? root?.nearGridSizeM, fallback.nearGridSizeM, 1),
    midGridSizeM: readNumberAtLeast(root?.mid_grid_size_m ?? root?.midGridSizeM, fallback.midGridSizeM, 1),
    farGridSizeM: readNumberAtLeast(root?.far_grid_size_m ?? root?.farGridSizeM, fallback.farGridSizeM, 1),
    nearSubdivisions: readIntegerAtLeast(root?.near_subdivisions ?? root?.nearSubdivisions, fallback.nearSubdivisions, 1),
    midSubdivisions: readIntegerAtLeast(root?.mid_subdivisions ?? root?.midSubdivisions, fallback.midSubdivisions, 1),
    farSubdivisions: readIntegerAtLeast(root?.far_subdivisions ?? root?.farSubdivisions, fallback.farSubdivisions, 1),
    ringInnerBandM: readNumberAtLeast(root?.ring_inner_band_m ?? root?.ringInnerBandM, fallback.ringInnerBandM, 0),
    ringInnerRadialSegments: readIntegerAtLeast(root?.ring_inner_radial_segments ?? root?.ringInnerRadialSegments, fallback.ringInnerRadialSegments, 1),
    ringOuterRadialSegments: readIntegerAtLeast(root?.ring_outer_radial_segments ?? root?.ringOuterRadialSegments, fallback.ringOuterRadialSegments, 1),
    ringTangentialSegments: readIntegerAtLeast(root?.ring_tangential_segments ?? root?.ringTangentialSegments, fallback.ringTangentialSegments, 1),
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
