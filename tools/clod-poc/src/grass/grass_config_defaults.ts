import type {
  GrassBladeSettings,
  GrassDebugSettings,
  GrassLodSettings,
  GrassPatchFallbackSettings,
  GrassPlacementSettings,
  GrassRenderSettings,
  GrassRingSettings,
  GrassSettings,
  GrassWindSettings,
} from "./grass_config_types.js";
import { DEFAULT_GRASS_SHADER_MODE } from "./grass_config_types.js";

export const DEFAULT_GRASS_PLACEMENT_SETTINGS: GrassPlacementSettings = {
  spacingM: 1.45,
  jitter: 0.34,
  slopeMinY: 0.72,
  minHeightM: 12,
  maxHeightM: 28,
  minGrassWeight: 0.05,
};

export const DEFAULT_GRASS_LOD_SETTINGS: GrassLodSettings = {
  nearFraction: 0.42,
  midFraction: 0.78,
  farDensityRatio: 0.14,
  midInstanceFraction: 0.35,
  farInstanceFraction: 0.10,
  ditherBandM: 12,
};

export const DEFAULT_GRASS_BLADE_SETTINGS: GrassBladeSettings = {
  heightM: 1.15,
  heightVariation: 0.75,
  widthM: 0.08,
  nearBladesPerInstance: 5,
  midBladesPerInstance: 3,
  nearSegments: 4,
  midSegments: 2,
  farTuftWidthM: 0.14,
  nearCrossedQuads: true,
  maxWidthCompensation: 1.35,
};

export const DEFAULT_GRASS_WIND_SETTINGS: GrassWindSettings = {
  direction: [0.8, 0.6],
  strength: 0.32,
  speed: 1.35,
  gustStrength: 0.15,
};

export const DEFAULT_GRASS_RENDER_SETTINGS: GrassRenderSettings = {
  alphaToCoverage: false,
  ditherFade: true,
};

export const DEFAULT_GRASS_DEBUG_SETTINGS: GrassDebugSettings = {
  showLodColors: false,
  showPatchBounds: false,
};

export const DEFAULT_GRASS_RING_SETTINGS: GrassRingSettings = {
  grid: 512,
  cell: 0.8,
  maxRadius: 160,
  ringDistance: 160,
  nearMeters: 28,
  midMeters: 80,
  farMeters: 125,
  farDistanceFraction: 0.94,
  bandMeters: DEFAULT_GRASS_LOD_SETTINGS.ditherBandM,
  scruffMeters: 30,
  scruffMinDensity: 0.28,
};

export const DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS: GrassPatchFallbackSettings = {
  maxNewPatchesPerRefresh: 1,
  refreshDistance: 8,
};

export const DEFAULT_GRASS_SETTINGS: GrassSettings = {
  enabled: true,
  shaderMode: DEFAULT_GRASS_SHADER_MODE,
  distanceM: 90,
  refreshDistanceM: DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS.refreshDistance,
  maxNewPatchesPerFrame: DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS.maxNewPatchesPerRefresh,
  maxInstances: 32000,
  placement: { ...DEFAULT_GRASS_PLACEMENT_SETTINGS },
  lod: { ...DEFAULT_GRASS_LOD_SETTINGS },
  blade: { ...DEFAULT_GRASS_BLADE_SETTINGS },
  wind: { ...DEFAULT_GRASS_WIND_SETTINGS },
  render: { ...DEFAULT_GRASS_RENDER_SETTINGS },
  debug: { ...DEFAULT_GRASS_DEBUG_SETTINGS },
  alphaToCoverage: DEFAULT_GRASS_RENDER_SETTINGS.alphaToCoverage,
  nearCrossedQuads: DEFAULT_GRASS_BLADE_SETTINGS.nearCrossedQuads,
  distance: 90,
  bladeSpacing: DEFAULT_GRASS_PLACEMENT_SETTINGS.spacingM,
  bladeHeight: DEFAULT_GRASS_BLADE_SETTINGS.heightM,
  bladeHeightVariation: DEFAULT_GRASS_BLADE_SETTINGS.heightVariation,
  bladeWidth: DEFAULT_GRASS_BLADE_SETTINGS.widthM,
  windStrength: DEFAULT_GRASS_WIND_SETTINGS.strength,
  windSpeed: DEFAULT_GRASS_WIND_SETTINGS.speed,
  slopeMinY: DEFAULT_GRASS_PLACEMENT_SETTINGS.slopeMinY,
  minHeight: DEFAULT_GRASS_PLACEMENT_SETTINGS.minHeightM,
  maxHeight: DEFAULT_GRASS_PLACEMENT_SETTINGS.maxHeightM,
  maxBlades: 32000,
  seed: 1337,
  ring: { ...DEFAULT_GRASS_RING_SETTINGS },
  patchFallback: { ...DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS },
};

export function cloneGrassSettings(settings: GrassSettings = DEFAULT_GRASS_SETTINGS): GrassSettings {
  return {
    ...settings,
    placement: { ...settings.placement },
    lod: { ...settings.lod },
    blade: { ...settings.blade },
    wind: { ...settings.wind, direction: [...settings.wind.direction] },
    render: { ...settings.render },
    debug: { ...settings.debug },
    ring: { ...settings.ring },
    patchFallback: { ...settings.patchFallback },
  };
}
