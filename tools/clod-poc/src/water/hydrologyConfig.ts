export interface HydrologyFillConfig {
  enabled: boolean;
  iterations: number;
  epsilonPerCell: number;
  lakeDelta: number;
  marshDelta: number;
}

export interface HydrologyAccumulationConfig {
  particles: number;
  maxSteps: number;
  flatGradientStop: number;
  inertia: number;
  jitterSeed: number;
}

export interface HydrologyRiversConfig {
  riverThresholdAdd: number;
  visibleWaterThresholdAdd: number;
  widenRadius: number;
  carveDepthM: number;
  carvePower: number;
  visibleDepthM: number;
  visibleDepthPower: number;
  slopeGateStart: number;
  slopeGateEnd: number;
  minVisibleDepth: number;
  /** Ensures at least one visible trunk river if particle accumulation is too weak. */
  guaranteeFallbackRivers: boolean;
  /** Enables the main fallback trunk river corridor. */
  fallbackMainRiver: boolean;
  /** Enables secondary fallback tributary corridors. */
  fallbackTributaries: boolean;
  /** Multiplies river render-flow speed after hydrology direction/strength are known. */
  flowSpeedMultiplier: number;
  /** Metres to lower lake surfaces below the fill spill level (and recede the
   *  shoreline to the new contour). Higher = lower, smaller lakes. */
  lakeSurfaceDropM: number;
}

export interface HydrologyWaterSurfaceConfig {
  wetSmoothIterations: number;
  wetToWetCliffSlopeMax: number;
  farReduceFactor: number;
  farLevelMinCellSize: number;
  drySentinelDepth: number;
  farLakeDominance: number;
  farRiverDominance: number;
  farWetThreshold: number;
}

export interface HydrologyMoistureConfig {
  enabled: boolean;
  blurRadius: number;
  lakeSource: number;
  riverSource: number;
  marshSource: number;
  dryDecay: number;
}

export interface HydrologyTalusConfig {
  enabled: boolean;
  iterations: number;
  strength: number;
}

export interface HydrologyInfiniteConfig {
  /** Analytic per-basin tracing or the persisted continent graph. */
  source: "traced" | "graph";
  /** World metres covered by one hydrology tile (edge length). */
  tileSizeM: number;
  /** Cells per tile edge; arrays store (tileRes+1)^2 vertex samples so neighbours share edges. */
  tileRes: number;
  /** LRU budget for resident tiles; 0 disables the tile cache (direct analytic sampling). */
  maxResidentTiles: number;
  /** Uses the traced/tile authority inside the startup world as well as outside it. */
  unifiedStartup: boolean;
  /** Width (metres) of the legacy band inside the startup-world edge where grid hydrology
   *  blends into the infinite field. Ignored when unifiedStartup is enabled. */
  boundaryBlendM: number;
  /** Edge length (tiles) of the streaming GPU hydrology atlas that gives vegetation
   *  placement compute real hydrology outside the startup world; 0 disables the atlas
   *  (GPU consumers fall back to clamping the startup texture). */
  atlasTilesPerSide: number;
}

export interface HydrologyDebugConfig {
  showFill: boolean;
  showAccumulation: boolean;
  showCarvedBed: boolean;
  showWaterY: boolean;
  dumpFields: boolean;
  dumpDir: string;
}

export interface HydrologyConfig {
  enabled: boolean;
  simRes: number;
  drySentinelDepth: number;
  fill: HydrologyFillConfig;
  accumulation: HydrologyAccumulationConfig;
  rivers: HydrologyRiversConfig;
  waterSurface: HydrologyWaterSurfaceConfig;
  moisture: HydrologyMoistureConfig;
  talus: HydrologyTalusConfig;
  infinite: HydrologyInfiniteConfig;
  debug: HydrologyDebugConfig;
}

export const DEFAULT_HYDROLOGY_CONFIG: HydrologyConfig = {
  enabled: true,
  simRes: 256,
  drySentinelDepth: 2.0,
  fill: {
    enabled: true,
    iterations: 900,
    epsilonPerCell: 0.0045,
    lakeDelta: 2.2,
    marshDelta: 0.15,
  },
  accumulation: {
    particles: 350_000,
    maxSteps: 220,
    flatGradientStop: 0.012,
    inertia: 0.45,
    jitterSeed: 12345,
  },
  rivers: {
    riverThresholdAdd: 14,
    visibleWaterThresholdAdd: 320,
    widenRadius: 2,
    carveDepthM: 7.5,
    carvePower: 1.35,
    visibleDepthM: 3.3,
    visibleDepthPower: 2.2,
    slopeGateStart: 0.50,
    slopeGateEnd: 0.24,
    minVisibleDepth: 0.05,
    guaranteeFallbackRivers: true,
    fallbackMainRiver: true,
    fallbackTributaries: true,
    flowSpeedMultiplier: 1.0,
    lakeSurfaceDropM: 2.0,
  },
  waterSurface: {
    wetSmoothIterations: 2,
    wetToWetCliffSlopeMax: 0.35,
    farReduceFactor: 8,
    farLevelMinCellSize: 12.0,
    drySentinelDepth: 2.0,
    farLakeDominance: 0.4,
    farRiverDominance: 0.3,
    farWetThreshold: 0.1,
  },
  moisture: {
    enabled: true,
    blurRadius: 4,
    lakeSource: 1.0,
    riverSource: 0.85,
    marshSource: 0.65,
    dryDecay: 0.82,
  },
  talus: {
    enabled: true,
    iterations: 8,
    strength: 0.12,
  },
  infinite: {
    source: "traced",
    tileSizeM: 256,
    tileRes: 64,
    maxResidentTiles: 96,
    unifiedStartup: true,
    boundaryBlendM: 48,
    atlasTilesPerSide: 6,
  },
  debug: {
    showFill: false,
    showAccumulation: false,
    showCarvedBed: false,
    showWaterY: false,
    dumpFields: false,
    dumpDir: "qa-runs/hydrology-fields",
  },
};

export function cloneHydrologyConfig(config: HydrologyConfig = DEFAULT_HYDROLOGY_CONFIG): HydrologyConfig {
  return {
    ...config,
    fill: { ...config.fill },
    accumulation: { ...config.accumulation },
    rivers: { ...config.rivers },
    waterSurface: { ...config.waterSurface },
    moisture: { ...config.moisture },
    talus: { ...config.talus },
    infinite: { ...config.infinite },
    debug: { ...config.debug },
  };
}
