import { load } from "js-yaml";
import treesYaml from "../config/trees.yaml?raw";
import type { MaterialClass } from "../terrain/material/material_classifier.js";

export const TREE_LODS = ["near", "mid", "far", "impostor"] as const;
export type TreeLod = typeof TREE_LODS[number];

export const TREE_SPECIES = ["oak", "birch", "pine", "willow", "palm", "dead"] as const;
export type TreeSpeciesId = typeof TREE_SPECIES[number];

export interface TreeSettings {
  enabled: boolean;
  seed: number;
  distanceM: number;
  refreshDistanceM: number;
  maxInstances: number;
  species: Record<TreeSpeciesId, TreeSpeciesSettings>;
  placement: TreePlacementSettings;
  lod: TreeLodSettings;
  impostors: TreeImpostorSettings;
  trunk: TreeTrunkSettings;
  canopy: TreeCanopySettings;
  wind: TreeWindSettings;
  render: TreeRenderSettings;
  gpu: TreeGpuSettings;
  ecology: TreeEcologySettings;
}

export interface TreeSpeciesSettings {
  enabled: boolean;
  weight: number;
  minHeightM: number;
  maxHeightM: number;
  minScale: number;
  maxScale: number;
  minSlopeY: number;
  maxSlopeY?: number;
  maxWaterDistanceM?: number;
  minWaterDistanceM?: number;
  minMoisture?: number;
  maxMoisture?: number;
  altitudePreference: "lowland" | "mid" | "highland" | "any";
  materialWeights: Partial<Record<MaterialClass, number>>;
  tint: string;
}

export interface TreePlacementSettings {
  spacingM: number;
  jitter: number;
  slopeMinY: number;
  minHeightM: number;
  maxHeightM: number;
  minGroundWeight: number;
  minSpacingM: number;
}

export interface TreeLodSettings {
  nearFraction: number;
  midFraction: number;
  farFraction: number;
  impostorFraction: number;
  hysteresisM: number;
  crossfadeEnabled: boolean;
  crossfadeBandM: number;
  ditherEnabled: boolean;
  shadowsMaxLod: TreeLod | "none";
  budgets: Record<TreeLod, { maxVertices: number }>;
}

export interface TreeImpostorSettings {
  enabled: boolean;
  bakeOnStart: boolean;
  fallbackToPlaceholder: boolean;
  sourceLod: Exclude<TreeLod, "impostor">;
  resolutionPx: number;
  octahedralGridSize: number;
  atlasPaddingPx: number;
  alphaTest: number;
  frameUpdateDistanceM: number;
  axialBillboard: boolean;
  preserveVertical: boolean;
  maxBakesPerFrame: number;
  debugShowFrames: boolean;
  debugFreezeFrame: number;
  futureNormalDepth: boolean;
}

export interface TreeTrunkSettings {
  radialSegments: number;
  heightSegments: number;
  baseRadiusM: number;
  taper: number;
  barkNoiseStrength: number;
  bendStrength: number;
  color: string;
}

export interface TreeCanopySpeciesSettings {
  cardCountNear: number;
  cardCountMid: number;
  cardCountFar: number;
  cardWidthM: number;
  cardHeightM: number;
  cardSizeVariation: number;
  clusterSpreadM: number;
  crownFlattening: number;
  tintVariation: number;
  edgeNoise: number;
  lobeCount: number;
  cutoutRoundness: number;
}

export type TreeCanopySettings = Record<TreeSpeciesId, TreeCanopySpeciesSettings>;

export interface TreeWindSettings {
  enabled: boolean;
  strength: number;
  speed: number;
  gustStrength: number;
  trunkSwayStrength: number;
  leafFlutterStrength: number;
}

export interface TreeRenderSettings {
  alphaTest: number;
  castShadows: boolean;
  receiveShadows: boolean;
  depthPrepass: boolean;
  debugColorByLod: boolean;
}

export interface TreeGpuSettings {
  enabled: boolean;
  preferWebGpu: boolean;
  fallbackToCpu: boolean;
  scatterEnabled: boolean;
  cullEnabled: boolean;
  maxVisible: number;
  workgroupSize: number;
  readbackVisibleLists: boolean;
  debugForceCpu: boolean;
  debugShowGpuCounts: boolean;
  debugValidateAgainstCpu: boolean;
}

export interface TreeEcologySettings {
  density: {
    baseDensity: number;
    lowlandHeightM: number;
    highlandHeightM: number;
    heightFadeM: number;
    slopeFadeStartY: number;
    slopeFadeEndY: number;
    materialWeightPower: number;
  };
  clumping: {
    parentCellM: number;
    strength: number;
    threshold: number;
  };
  hydrology: {
    waterClearanceM: number;
    moistureInfluence: number;
  };
  ridge: {
    enabled: boolean;
    sampleStepM: number;
    rejectStrength: number;
    ridgeSlopeY: number;
    minCurvature: number;
  };
  materialReject: Partial<Record<MaterialClass, number>>;
}

function colorFromString(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function boolFrom(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberFrom(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function treeLodFrom(value: unknown, fallback: TreeLod): TreeLod {
  return TREE_LODS.includes(value as TreeLod) ? value as TreeLod : fallback;
}

function shadowLodFrom(value: unknown, fallback: TreeLod | "none"): TreeLod | "none" {
  return value === "none" || TREE_LODS.includes(value as TreeLod) ? value as TreeLod | "none" : fallback;
}

function speciesIdFrom(value: unknown, fallback: TreeSpeciesId): TreeSpeciesId {
  return TREE_SPECIES.includes(value as TreeSpeciesId) ? value as TreeSpeciesId : fallback;
}

function altitudePreferenceFrom(value: unknown, fallback: TreeSpeciesSettings["altitudePreference"]): TreeSpeciesSettings["altitudePreference"] {
  return value === "lowland" || value === "mid" || value === "highland" || value === "any" ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function partialMaterialWeights(value: unknown, fallback: Partial<Record<MaterialClass, number>>): Partial<Record<MaterialClass, number>> {
  const out: Partial<Record<MaterialClass, number>> = { ...fallback };
  const source = record(value);
  for (const [key, raw] of Object.entries(source)) {
    const n = Number(raw);
    if (Number.isFinite(n)) out[key as MaterialClass] = n;
  }
  return out;
}

function parseSpeciesSettings(raw: unknown, fallback: TreeSpeciesSettings): TreeSpeciesSettings {
  const src = record(raw);
  return {
    enabled: boolFrom(src.enabled, fallback.enabled),
    weight: numberFrom(src.weight, fallback.weight),
    minHeightM: numberFrom(src.min_height_m, fallback.minHeightM),
    maxHeightM: numberFrom(src.max_height_m, fallback.maxHeightM),
    minScale: numberFrom(src.min_scale, fallback.minScale),
    maxScale: numberFrom(src.max_scale, fallback.maxScale),
    minSlopeY: numberFrom(src.min_slope_y, fallback.minSlopeY),
    maxSlopeY: src.max_slope_y === undefined ? fallback.maxSlopeY : numberFrom(src.max_slope_y, fallback.maxSlopeY ?? 1),
    maxWaterDistanceM: src.max_water_distance_m === undefined ? fallback.maxWaterDistanceM : numberFrom(src.max_water_distance_m, fallback.maxWaterDistanceM ?? 0),
    minWaterDistanceM: src.min_water_distance_m === undefined ? fallback.minWaterDistanceM : numberFrom(src.min_water_distance_m, fallback.minWaterDistanceM ?? 0),
    minMoisture: src.min_moisture === undefined ? fallback.minMoisture : numberFrom(src.min_moisture, fallback.minMoisture ?? 0),
    maxMoisture: src.max_moisture === undefined ? fallback.maxMoisture : numberFrom(src.max_moisture, fallback.maxMoisture ?? 1),
    altitudePreference: altitudePreferenceFrom(src.altitude_preference, fallback.altitudePreference),
    materialWeights: partialMaterialWeights(src.material_weights, fallback.materialWeights),
    tint: colorFromString(src.tint, fallback.tint),
  };
}

function parseCanopySettings(raw: unknown, fallback: TreeCanopySpeciesSettings): TreeCanopySpeciesSettings {
  const src = record(raw);
  return {
    cardCountNear: Math.max(0, Math.floor(numberFrom(src.card_count_near, fallback.cardCountNear))),
    cardCountMid: Math.max(0, Math.floor(numberFrom(src.card_count_mid, fallback.cardCountMid))),
    cardCountFar: Math.max(0, Math.floor(numberFrom(src.card_count_far, fallback.cardCountFar))),
    cardWidthM: numberFrom(src.card_width_m, fallback.cardWidthM),
    cardHeightM: numberFrom(src.card_height_m, fallback.cardHeightM),
    cardSizeVariation: numberFrom(src.card_size_variation, fallback.cardSizeVariation),
    clusterSpreadM: numberFrom(src.cluster_spread_m, fallback.clusterSpreadM),
    crownFlattening: numberFrom(src.crown_flattening, fallback.crownFlattening),
    tintVariation: numberFrom(src.tint_variation, fallback.tintVariation),
    edgeNoise: numberFrom(src.edge_noise, fallback.edgeNoise),
    lobeCount: Math.max(1, Math.floor(numberFrom(src.lobe_count, fallback.lobeCount))),
    cutoutRoundness: numberFrom(src.cutout_roundness, fallback.cutoutRoundness),
  };
}

export const DEFAULT_TREE_SPECIES_SETTINGS: Record<TreeSpeciesId, TreeSpeciesSettings> = {
  oak: {
    enabled: true,
    weight: 0.26,
    minHeightM: 5,
    maxHeightM: 95,
    minScale: 0.9,
    maxScale: 1.45,
    minSlopeY: 0.55,
    maxSlopeY: 0.98,
    minWaterDistanceM: 3,
    minMoisture: 0.1,
    maxMoisture: 0.85,
    altitudePreference: "mid",
    materialWeights: { grass: 1.05, dirt: 0.55, rock: 0.08, sand: 0.04 },
    tint: "#4f7b3f",
  },
  birch: {
    enabled: true,
    weight: 0.18,
    minHeightM: 12,
    maxHeightM: 105,
    minScale: 0.85,
    maxScale: 1.3,
    minSlopeY: 0.58,
    maxSlopeY: 0.99,
    minWaterDistanceM: 2,
    minMoisture: 0.18,
    maxMoisture: 0.95,
    altitudePreference: "mid",
    materialWeights: { grass: 0.95, dirt: 0.45, rock: 0.05, sand: 0.03 },
    tint: "#77a85b",
  },
  pine: {
    enabled: true,
    weight: 0.26,
    minHeightM: 35,
    maxHeightM: 145,
    minScale: 0.95,
    maxScale: 1.55,
    minSlopeY: 0.48,
    maxSlopeY: 0.96,
    minWaterDistanceM: 6,
    minMoisture: 0.05,
    maxMoisture: 0.7,
    altitudePreference: "highland",
    materialWeights: { grass: 0.55, dirt: 0.25, rock: 0.18, snow: 0.08 },
    tint: "#2f6249",
  },
  willow: {
    enabled: true,
    weight: 0.08,
    minHeightM: 1,
    maxHeightM: 85,
    minScale: 0.9,
    maxScale: 1.5,
    minSlopeY: 0.66,
    maxWaterDistanceM: 18,
    minMoisture: 0.45,
    altitudePreference: "lowland",
    materialWeights: { grass: 0.75, dirt: 0.45, sand: 0.12 },
    tint: "#6f9f45",
  },
  palm: {
    enabled: true,
    weight: 0.12,
    minHeightM: 0,
    maxHeightM: 50,
    minScale: 0.8,
    maxScale: 1.25,
    minSlopeY: 0.68,
    maxWaterDistanceM: 35,
    minWaterDistanceM: 2,
    minMoisture: 0.25,
    altitudePreference: "lowland",
    materialWeights: { sand: 1.0, grass: 0.25, dirt: 0.15 },
    tint: "#4b8d45",
  },
  dead: {
    enabled: true,
    weight: 0.1,
    minHeightM: 5,
    maxHeightM: 120,
    minScale: 0.75,
    maxScale: 1.2,
    minSlopeY: 0.35,
    minWaterDistanceM: 8,
    altitudePreference: "any",
    materialWeights: { dirt: 0.55, rock: 0.32, grass: 0.25, snow: 0.08 },
    tint: "#7a6651",
  },
};

export const DEFAULT_TREE_CANOPY_SETTINGS: TreeCanopySettings = {
  oak: {
    cardCountNear: 72,
    cardCountMid: 30,
    cardCountFar: 10,
    cardWidthM: 1.4,
    cardHeightM: 1.15,
    cardSizeVariation: 0.35,
    clusterSpreadM: 2.2,
    crownFlattening: 0.82,
    tintVariation: 0.18,
    edgeNoise: 0.35,
    lobeCount: 7,
    cutoutRoundness: 0.62,
  },
  birch: {
    cardCountNear: 56,
    cardCountMid: 24,
    cardCountFar: 8,
    cardWidthM: 1.05,
    cardHeightM: 1.0,
    cardSizeVariation: 0.3,
    clusterSpreadM: 1.55,
    crownFlattening: 0.78,
    tintVariation: 0.16,
    edgeNoise: 0.28,
    lobeCount: 6,
    cutoutRoundness: 0.7,
  },
  pine: {
    cardCountNear: 82,
    cardCountMid: 34,
    cardCountFar: 12,
    cardWidthM: 1.05,
    cardHeightM: 1.65,
    cardSizeVariation: 0.28,
    clusterSpreadM: 1.65,
    crownFlattening: 1.55,
    tintVariation: 0.12,
    edgeNoise: 0.22,
    lobeCount: 5,
    cutoutRoundness: 0.48,
  },
  willow: {
    cardCountNear: 70,
    cardCountMid: 30,
    cardCountFar: 10,
    cardWidthM: 1.25,
    cardHeightM: 1.45,
    cardSizeVariation: 0.3,
    clusterSpreadM: 1.9,
    crownFlattening: 1.15,
    tintVariation: 0.14,
    edgeNoise: 0.32,
    lobeCount: 8,
    cutoutRoundness: 0.58,
  },
  palm: {
    cardCountNear: 34,
    cardCountMid: 16,
    cardCountFar: 6,
    cardWidthM: 1.8,
    cardHeightM: 0.55,
    cardSizeVariation: 0.28,
    clusterSpreadM: 1.75,
    crownFlattening: 0.35,
    tintVariation: 0.15,
    edgeNoise: 0.18,
    lobeCount: 4,
    cutoutRoundness: 0.54,
  },
  dead: {
    cardCountNear: 18,
    cardCountMid: 8,
    cardCountFar: 0,
    cardWidthM: 0.8,
    cardHeightM: 0.8,
    cardSizeVariation: 0.22,
    clusterSpreadM: 0.9,
    crownFlattening: 0.6,
    tintVariation: 0.06,
    edgeNoise: 0.12,
    lobeCount: 4,
    cutoutRoundness: 0.5,
  },
};

export const DEFAULT_TREE_CANOPY_LOW_POLY_SETTINGS: TreeCanopySettings = {
  oak: {
    cardCountNear: 48,
    cardCountMid: 18,
    cardCountFar: 6,
    cardWidthM: 1.6,
    cardHeightM: 1.25,
    cardSizeVariation: 0.35,
    clusterSpreadM: 2.1,
    crownFlattening: 0.82,
    tintVariation: 0.18,
    edgeNoise: 0.32,
    lobeCount: 6,
    cutoutRoundness: 0.62,
  },
  birch: {
    cardCountNear: 38,
    cardCountMid: 14,
    cardCountFar: 5,
    cardWidthM: 1.2,
    cardHeightM: 1.05,
    cardSizeVariation: 0.3,
    clusterSpreadM: 1.45,
    crownFlattening: 0.78,
    tintVariation: 0.16,
    edgeNoise: 0.25,
    lobeCount: 5,
    cutoutRoundness: 0.7,
  },
  pine: {
    cardCountNear: 54,
    cardCountMid: 24,
    cardCountFar: 8,
    cardWidthM: 1.05,
    cardHeightM: 1.35,
    cardSizeVariation: 0.28,
    clusterSpreadM: 1.8,
    crownFlattening: 1.45,
    tintVariation: 0.12,
    edgeNoise: 0.22,
    lobeCount: 5,
    cutoutRoundness: 0.48,
  },
};

// Impostor atlas budget at defaults: 8x8 tiles * 128px = 1024px atlas.
// Two RGBA8 atlases cost about 8 MiB/species, about 48 MiB for 6 species.
export const DEFAULT_TREE_IMPOSTOR_SETTINGS: TreeImpostorSettings = {
  enabled: true,
  bakeOnStart: true,
  fallbackToPlaceholder: false,
  sourceLod: "mid",
  resolutionPx: 128,
  octahedralGridSize: 8,
  atlasPaddingPx: 2,
  alphaTest: 0.45,
  frameUpdateDistanceM: 2.0,
  axialBillboard: true,
  preserveVertical: true,
  maxBakesPerFrame: 1,
  debugShowFrames: false,
  debugFreezeFrame: -1,
  futureNormalDepth: true,
};

export const DEFAULT_TREE_GPU_SETTINGS: TreeGpuSettings = {
  enabled: false,
  preferWebGpu: true,
  fallbackToCpu: true,
  scatterEnabled: true,
  cullEnabled: true,
  maxVisible: 50_000,
  workgroupSize: 64,
  readbackVisibleLists: false,
  debugForceCpu: false,
  debugShowGpuCounts: false,
  debugValidateAgainstCpu: false,
};

export const DEFAULT_TREE_SETTINGS: TreeSettings = {
  enabled: true,
  seed: 7331,
  distanceM: 620,
  refreshDistanceM: 48,
  maxInstances: 9000,
  species: DEFAULT_TREE_SPECIES_SETTINGS,
  placement: {
    spacingM: 5.5,
    jitter: 0.86,
    slopeMinY: 0.42,
    minHeightM: 0,
    maxHeightM: 150,
    minGroundWeight: 0.28,
    minSpacingM: 2.2,
  },
  lod: {
    nearFraction: 0.18,
    midFraction: 0.45,
    farFraction: 0.78,
    impostorFraction: 1.0,
    hysteresisM: 18,
    crossfadeEnabled: true,
    crossfadeBandM: 32,
    ditherEnabled: true,
    shadowsMaxLod: "mid",
    budgets: {
      near: { maxVertices: 1100 },
      mid: { maxVertices: 420 },
      far: { maxVertices: 150 },
      impostor: { maxVertices: 16 },
    },
  },
  impostors: DEFAULT_TREE_IMPOSTOR_SETTINGS,
  trunk: {
    radialSegments: 7,
    heightSegments: 5,
    baseRadiusM: 0.16,
    taper: 0.62,
    barkNoiseStrength: 0.08,
    bendStrength: 0.05,
    color: "#6a4b35",
  },
  canopy: DEFAULT_TREE_CANOPY_SETTINGS,
  wind: {
    enabled: true,
    strength: 0.18,
    speed: 0.42,
    gustStrength: 0.35,
    trunkSwayStrength: 0.08,
    leafFlutterStrength: 0.26,
  },
  render: {
    alphaTest: 0.38,
    castShadows: true,
    receiveShadows: true,
    depthPrepass: true,
    debugColorByLod: false,
  },
  gpu: DEFAULT_TREE_GPU_SETTINGS,
  ecology: {
    density: {
      baseDensity: 1.2,
      lowlandHeightM: 8,
      highlandHeightM: 118,
      heightFadeM: 18,
      slopeFadeStartY: 0.42,
      slopeFadeEndY: 0.86,
      materialWeightPower: 1.45,
    },
    clumping: {
      parentCellM: 28,
      strength: 0.58,
      threshold: 0.36,
    },
    hydrology: {
      waterClearanceM: 3.5,
      moistureInfluence: 0.45,
    },
    ridge: {
      enabled: true,
      sampleStepM: 10,
      rejectStrength: 0.65,
      ridgeSlopeY: 0.58,
      minCurvature: 0.18,
    },
    materialReject: {
      water: 1,
      snow: 0.5,
      rock: 0.18,
    },
  },
};

export function parseTreeSettings(yamlText = treesYaml): TreeSettings {
  try {
    const root = record(load(yamlText));
    const trees = record(root.trees);
    const speciesRoot = record(trees.species);
    const canopyRoot = record(trees.canopy);
    const placementRoot = record(trees.placement);
    const lodRoot = record(trees.lod);
    const impostorRoot = record(trees.impostors);
    const trunkRoot = record(trees.trunk);
    const windRoot = record(trees.wind);
    const renderRoot = record(trees.render);
    const gpuRoot = record(trees.gpu);
    const ecologyRoot = record(trees.ecology);
    const densityRoot = record(ecologyRoot.density);
    const clumpingRoot = record(ecologyRoot.clumping);
    const hydrologyRoot = record(ecologyRoot.hydrology);
    const ridgeRoot = record(ecologyRoot.ridge);
    const materialRejectRoot = record(ecologyRoot.material_reject);

    const species = { ...DEFAULT_TREE_SPECIES_SETTINGS } as Record<TreeSpeciesId, TreeSpeciesSettings>;
    for (const id of TREE_SPECIES) species[id] = parseSpeciesSettings(speciesRoot[id], DEFAULT_TREE_SPECIES_SETTINGS[id]);
    const canopy = { ...DEFAULT_TREE_CANOPY_SETTINGS } as TreeCanopySettings;
    for (const id of TREE_SPECIES) canopy[id] = parseCanopySettings(canopyRoot[id], DEFAULT_TREE_CANOPY_SETTINGS[id]);

    return {
      enabled: boolFrom(trees.enabled, DEFAULT_TREE_SETTINGS.enabled),
      seed: Math.floor(numberFrom(trees.seed, DEFAULT_TREE_SETTINGS.seed)),
      distanceM: numberFrom(trees.distance_m, DEFAULT_TREE_SETTINGS.distanceM),
      refreshDistanceM: numberFrom(trees.refresh_distance_m, DEFAULT_TREE_SETTINGS.refreshDistanceM),
      maxInstances: Math.floor(numberFrom(trees.max_instances, DEFAULT_TREE_SETTINGS.maxInstances)),
      species,
      placement: {
        spacingM: numberFrom(placementRoot.spacing_m, DEFAULT_TREE_SETTINGS.placement.spacingM),
        jitter: numberFrom(placementRoot.jitter, DEFAULT_TREE_SETTINGS.placement.jitter),
        slopeMinY: numberFrom(placementRoot.slope_min_y, DEFAULT_TREE_SETTINGS.placement.slopeMinY),
        minHeightM: numberFrom(placementRoot.min_height_m, DEFAULT_TREE_SETTINGS.placement.minHeightM),
        maxHeightM: numberFrom(placementRoot.max_height_m, DEFAULT_TREE_SETTINGS.placement.maxHeightM),
        minGroundWeight: numberFrom(placementRoot.min_ground_weight, DEFAULT_TREE_SETTINGS.placement.minGroundWeight),
        minSpacingM: numberFrom(placementRoot.min_spacing_m, DEFAULT_TREE_SETTINGS.placement.minSpacingM),
      },
      lod: {
        nearFraction: numberFrom(lodRoot.near_fraction, DEFAULT_TREE_SETTINGS.lod.nearFraction),
        midFraction: numberFrom(lodRoot.mid_fraction, DEFAULT_TREE_SETTINGS.lod.midFraction),
        farFraction: numberFrom(lodRoot.far_fraction, DEFAULT_TREE_SETTINGS.lod.farFraction),
        impostorFraction: numberFrom(lodRoot.impostor_fraction, DEFAULT_TREE_SETTINGS.lod.impostorFraction),
        hysteresisM: numberFrom(lodRoot.hysteresis_m, DEFAULT_TREE_SETTINGS.lod.hysteresisM),
        crossfadeEnabled: boolFrom(lodRoot.crossfade_enabled, DEFAULT_TREE_SETTINGS.lod.crossfadeEnabled),
        crossfadeBandM: numberFrom(lodRoot.crossfade_band_m, DEFAULT_TREE_SETTINGS.lod.crossfadeBandM),
        ditherEnabled: boolFrom(lodRoot.dither_enabled, DEFAULT_TREE_SETTINGS.lod.ditherEnabled),
        shadowsMaxLod: shadowLodFrom(lodRoot.shadows_max_lod, DEFAULT_TREE_SETTINGS.lod.shadowsMaxLod),
        budgets: {
          near: { maxVertices: Math.floor(numberFrom(record(record(lodRoot.budgets).near).max_vertices, DEFAULT_TREE_SETTINGS.lod.budgets.near.maxVertices)) },
          mid: { maxVertices: Math.floor(numberFrom(record(record(lodRoot.budgets).mid).max_vertices, DEFAULT_TREE_SETTINGS.lod.budgets.mid.maxVertices)) },
          far: { maxVertices: Math.floor(numberFrom(record(record(lodRoot.budgets).far).max_vertices, DEFAULT_TREE_SETTINGS.lod.budgets.far.maxVertices)) },
          impostor: { maxVertices: Math.floor(numberFrom(record(record(lodRoot.budgets).impostor).max_vertices, DEFAULT_TREE_SETTINGS.lod.budgets.impostor.maxVertices)) },
        },
      },
      impostors: {
        enabled: boolFrom(impostorRoot.enabled, DEFAULT_TREE_SETTINGS.impostors.enabled),
        bakeOnStart: boolFrom(impostorRoot.bake_on_start, DEFAULT_TREE_SETTINGS.impostors.bakeOnStart),
        fallbackToPlaceholder: boolFrom(impostorRoot.fallback_to_placeholder, DEFAULT_TREE_SETTINGS.impostors.fallbackToPlaceholder),
        sourceLod: treeLodFrom(impostorRoot.source_lod, DEFAULT_TREE_SETTINGS.impostors.sourceLod) as Exclude<TreeLod, "impostor">,
        resolutionPx: Math.floor(numberFrom(impostorRoot.resolution_px, DEFAULT_TREE_SETTINGS.impostors.resolutionPx)),
        octahedralGridSize: Math.floor(numberFrom(impostorRoot.octahedral_grid_size, DEFAULT_TREE_SETTINGS.impostors.octahedralGridSize)),
        atlasPaddingPx: Math.floor(numberFrom(impostorRoot.atlas_padding_px, DEFAULT_TREE_SETTINGS.impostors.atlasPaddingPx)),
        alphaTest: numberFrom(impostorRoot.alpha_test, DEFAULT_TREE_SETTINGS.impostors.alphaTest),
        frameUpdateDistanceM: numberFrom(impostorRoot.frame_update_distance_m, DEFAULT_TREE_SETTINGS.impostors.frameUpdateDistanceM),
        axialBillboard: boolFrom(impostorRoot.axial_billboard, DEFAULT_TREE_SETTINGS.impostors.axialBillboard),
        preserveVertical: boolFrom(impostorRoot.preserve_vertical, DEFAULT_TREE_SETTINGS.impostors.preserveVertical),
        maxBakesPerFrame: Math.floor(numberFrom(impostorRoot.max_bakes_per_frame, DEFAULT_TREE_SETTINGS.impostors.maxBakesPerFrame)),
        debugShowFrames: boolFrom(impostorRoot.debug_show_frames, DEFAULT_TREE_SETTINGS.impostors.debugShowFrames),
        debugFreezeFrame: Math.floor(numberFrom(impostorRoot.debug_freeze_frame, DEFAULT_TREE_SETTINGS.impostors.debugFreezeFrame)),
        futureNormalDepth: boolFrom(impostorRoot.future_normal_depth, DEFAULT_TREE_SETTINGS.impostors.futureNormalDepth),
      },
      trunk: {
        radialSegments: Math.floor(numberFrom(trunkRoot.radial_segments, DEFAULT_TREE_SETTINGS.trunk.radialSegments)),
        heightSegments: Math.floor(numberFrom(trunkRoot.height_segments, DEFAULT_TREE_SETTINGS.trunk.heightSegments)),
        baseRadiusM: numberFrom(trunkRoot.base_radius_m, DEFAULT_TREE_SETTINGS.trunk.baseRadiusM),
        taper: numberFrom(trunkRoot.taper, DEFAULT_TREE_SETTINGS.trunk.taper),
        barkNoiseStrength: numberFrom(trunkRoot.bark_noise_strength, DEFAULT_TREE_SETTINGS.trunk.barkNoiseStrength),
        bendStrength: numberFrom(trunkRoot.bend_strength, DEFAULT_TREE_SETTINGS.trunk.bendStrength),
        color: colorFromString(trunkRoot.color, DEFAULT_TREE_SETTINGS.trunk.color),
      },
      canopy,
      wind: {
        enabled: boolFrom(windRoot.enabled, DEFAULT_TREE_SETTINGS.wind.enabled),
        strength: numberFrom(windRoot.strength, DEFAULT_TREE_SETTINGS.wind.strength),
        speed: numberFrom(windRoot.speed, DEFAULT_TREE_SETTINGS.wind.speed),
        gustStrength: numberFrom(windRoot.gust_strength, DEFAULT_TREE_SETTINGS.wind.gustStrength),
        trunkSwayStrength: numberFrom(windRoot.trunk_sway_strength, DEFAULT_TREE_SETTINGS.wind.trunkSwayStrength),
        leafFlutterStrength: numberFrom(windRoot.leaf_flutter_strength, DEFAULT_TREE_SETTINGS.wind.leafFlutterStrength),
      },
      render: {
        alphaTest: numberFrom(renderRoot.alpha_test, DEFAULT_TREE_SETTINGS.render.alphaTest),
        castShadows: boolFrom(renderRoot.cast_shadows, DEFAULT_TREE_SETTINGS.render.castShadows),
        receiveShadows: boolFrom(renderRoot.receive_shadows, DEFAULT_TREE_SETTINGS.render.receiveShadows),
        depthPrepass: boolFrom(renderRoot.depth_prepass, DEFAULT_TREE_SETTINGS.render.depthPrepass),
        debugColorByLod: boolFrom(renderRoot.debug_color_by_lod, DEFAULT_TREE_SETTINGS.render.debugColorByLod),
      },
      gpu: {
        enabled: boolFrom(gpuRoot.enabled, DEFAULT_TREE_SETTINGS.gpu.enabled),
        preferWebGpu: boolFrom(gpuRoot.prefer_webgpu, DEFAULT_TREE_SETTINGS.gpu.preferWebGpu),
        fallbackToCpu: boolFrom(gpuRoot.fallback_to_cpu, DEFAULT_TREE_SETTINGS.gpu.fallbackToCpu),
        scatterEnabled: boolFrom(gpuRoot.scatter_enabled, DEFAULT_TREE_SETTINGS.gpu.scatterEnabled),
        cullEnabled: boolFrom(gpuRoot.cull_enabled, DEFAULT_TREE_SETTINGS.gpu.cullEnabled),
        maxVisible: Math.floor(numberFrom(gpuRoot.max_visible, DEFAULT_TREE_SETTINGS.gpu.maxVisible)),
        workgroupSize: Math.floor(numberFrom(gpuRoot.workgroup_size, DEFAULT_TREE_SETTINGS.gpu.workgroupSize)),
        readbackVisibleLists: boolFrom(gpuRoot.readback_visible_lists, DEFAULT_TREE_SETTINGS.gpu.readbackVisibleLists),
        debugForceCpu: boolFrom(gpuRoot.debug_force_cpu, DEFAULT_TREE_SETTINGS.gpu.debugForceCpu),
        debugShowGpuCounts: boolFrom(gpuRoot.debug_show_gpu_counts, DEFAULT_TREE_SETTINGS.gpu.debugShowGpuCounts),
        debugValidateAgainstCpu: boolFrom(gpuRoot.debug_validate_against_cpu, DEFAULT_TREE_SETTINGS.gpu.debugValidateAgainstCpu),
      },
      ecology: {
        density: {
          baseDensity: numberFrom(densityRoot.base_density, DEFAULT_TREE_SETTINGS.ecology.density.baseDensity),
          lowlandHeightM: numberFrom(densityRoot.lowland_height_m, DEFAULT_TREE_SETTINGS.ecology.density.lowlandHeightM),
          highlandHeightM: numberFrom(densityRoot.highland_height_m, DEFAULT_TREE_SETTINGS.ecology.density.highlandHeightM),
          heightFadeM: numberFrom(densityRoot.height_fade_m, DEFAULT_TREE_SETTINGS.ecology.density.heightFadeM),
          slopeFadeStartY: numberFrom(densityRoot.slope_fade_start_y, DEFAULT_TREE_SETTINGS.ecology.density.slopeFadeStartY),
          slopeFadeEndY: numberFrom(densityRoot.slope_fade_end_y, DEFAULT_TREE_SETTINGS.ecology.density.slopeFadeEndY),
          materialWeightPower: numberFrom(densityRoot.material_weight_power, DEFAULT_TREE_SETTINGS.ecology.density.materialWeightPower),
        },
        clumping: {
          parentCellM: numberFrom(clumpingRoot.parent_cell_m, DEFAULT_TREE_SETTINGS.ecology.clumping.parentCellM),
          strength: numberFrom(clumpingRoot.strength, DEFAULT_TREE_SETTINGS.ecology.clumping.strength),
          threshold: numberFrom(clumpingRoot.threshold, DEFAULT_TREE_SETTINGS.ecology.clumping.threshold),
        },
        hydrology: {
          waterClearanceM: numberFrom(hydrologyRoot.water_clearance_m, DEFAULT_TREE_SETTINGS.ecology.hydrology.waterClearanceM),
          moistureInfluence: numberFrom(hydrologyRoot.moisture_influence, DEFAULT_TREE_SETTINGS.ecology.hydrology.moistureInfluence),
        },
        ridge: {
          enabled: boolFrom(ridgeRoot.enabled, DEFAULT_TREE_SETTINGS.ecology.ridge.enabled),
          sampleStepM: numberFrom(ridgeRoot.sample_step_m, DEFAULT_TREE_SETTINGS.ecology.ridge.sampleStepM),
          rejectStrength: numberFrom(ridgeRoot.reject_strength, DEFAULT_TREE_SETTINGS.ecology.ridge.rejectStrength),
          ridgeSlopeY: numberFrom(ridgeRoot.ridge_slope_y, DEFAULT_TREE_SETTINGS.ecology.ridge.ridgeSlopeY),
          minCurvature: numberFrom(ridgeRoot.min_curvature, DEFAULT_TREE_SETTINGS.ecology.ridge.minCurvature),
        },
        materialReject: partialMaterialWeights(materialRejectRoot, DEFAULT_TREE_SETTINGS.ecology.materialReject),
      },
    };
  } catch (error) {
    console.warn("[trees] failed to parse tree config yaml; using defaults", error);
    return DEFAULT_TREE_SETTINGS;
  }
}
