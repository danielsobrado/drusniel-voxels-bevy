import type {
  StoneClass,
  StoneClassConfig,
  StoneSettings,
  StoneTerrainClassWeights,
  StoneTerrainWeights,
} from "./stone_config_types.js";

function defaultTerrainWeights(
  density: number,
  large: number,
  medium: number,
  small: number,
): StoneTerrainClassWeights {
  return { density, large, medium, small };
}

export const DEFAULT_STONE_TERRAIN_WEIGHTS: StoneTerrainWeights = {
  lowHeightM: 26,
  highHeightM: 78,
  heightBlendM: 12,
  grass: defaultTerrainWeights(0.58, 0.45, 0.85, 1.45),
  rock: defaultTerrainWeights(1.25, 1.35, 1.1, 0.82),
  sand: defaultTerrainWeights(0.9, 0.8, 1.1, 1.1),
  snow: defaultTerrainWeights(0.72, 1.75, 1.05, 0.38),
  low: defaultTerrainWeights(0.82, 0.75, 1.0, 1.18),
  mid: defaultTerrainWeights(1.0, 1.0, 1.0, 1.0),
  high: defaultTerrainWeights(1.15, 1.35, 1.0, 0.68),
};

function cloneStoneTerrainWeights(weights: StoneTerrainWeights): StoneTerrainWeights {
  return {
    ...weights,
    grass: { ...weights.grass },
    rock: { ...weights.rock },
    sand: { ...weights.sand },
    snow: { ...weights.snow },
    low: { ...weights.low },
    mid: { ...weights.mid },
    high: { ...weights.high },
  };
}

function cloneStoneClassConfig(config: StoneClassConfig): StoneClassConfig {
  return { ...config, lodDetails: [...config.lodDetails], presets: [...config.presets] };
}

export const CLASS_BASE_WEIGHTS: Record<StoneClass, number> = {
  large: 0.1,
  medium: 0.32,
  small: 0.58,
};

export const DEFAULT_STONE_SETTINGS: StoneSettings = {
  enabled: true,
  seedSalt: 931777,
  cellSizeM: 2.1,
  ringRadiusM: 220,
  ringRefreshDistanceM: 8,
  ringEdgeFadeM: 24,
  maxInstances: 120000,
  density: 1.0,
  slopeReposeStart: 0.78,
  slopeRepose: 0.5,
  waterMarginM: 0.5,
  standingWaterCutoffM: 0.0,
  streamLargeBias: 0.16,
  cliffProbeNearM: 8.0,
  cliffProbeFarM: 18.0,
  cliffRiseStart: 0.7,
  cliffRiseEnd: 1.3,
  streambedSandStart: 0.0,
  streambedSandEnd: 1.0,
  snowFade: 0.85,
  rockExposureWeight: 0.85,
  screeWeight: 0.85,
  cliffAboveWeight: 1.15,
  streamWeight: 1.5,
  baseSoilWeight: 0.16,
  patchClumpMin: 0.35,
  patchClumpCellMult: 3.0,
  sinkSlopeMultiplier: 0.9,
  normalLean: 0.4,
  terrain: cloneStoneTerrainWeights(DEFAULT_STONE_TERRAIN_WEIGHTS),
  debug: {
    classColors: false,
    largeOnly: false,
    mediumOnly: false,
    smallOnly: false,
    rejectedWaterMap: false,
    slopeReposeHeatmap: false,
    streambedHeatmap: false,
    cliffAboveHeatmap: false,
    rockBasePatchHeatmap: false,
    candidateGrid: false,
  },
  classes: {
    large: {
      radiusMin: 0.6,
      radiusMax: 2.2,
      maxDistance: 900,
      sink: 0.3,
      lodDetails: [3, 2],
      variants: 4,
      presets: ["talus", "boulder"],
      shadows: true,
    },
    medium: {
      radiusMin: 0.2,
      radiusMax: 0.6,
      maxDistance: 280,
      sink: 0.26,
      lodDetails: [2, 1],
      variants: 4,
      presets: ["cobble", "talus"],
      shadows: false,
    },
    small: {
      radiusMin: 0.06,
      radiusMax: 0.2,
      maxDistance: 90,
      sink: 0.22,
      lodDetails: [1],
      variants: 4,
      presets: ["cobble"],
      shadows: false,
    },
  },
};

export function cloneStoneSettings(settings: StoneSettings): StoneSettings {
  return {
    ...settings,
    terrain: cloneStoneTerrainWeights(settings.terrain),
    debug: { ...settings.debug },
    classes: {
      large: cloneStoneClassConfig(settings.classes.large),
      medium: cloneStoneClassConfig(settings.classes.medium),
      small: cloneStoneClassConfig(settings.classes.small),
    },
  };
}
