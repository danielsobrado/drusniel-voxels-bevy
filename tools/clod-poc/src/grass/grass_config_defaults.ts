import type {
  GrassAppearanceSettings,
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
import { GRASS_DRY_LINEAR, GRASS_SHARED_BASE_LINEAR, GRASS_TIP_LINEAR } from "./grass_palette.js";

export const DEFAULT_GRASS_PLACEMENT_SETTINGS: GrassPlacementSettings = {
  spacingM: 0.85,
  jitter: 0.42,
  slopeMinY: 0.72,
  minHeightM: 12,
  maxHeightM: 28,
  minGrassWeight: 0.05,
};

export const DEFAULT_GRASS_LOD_SETTINGS: GrassLodSettings = {
  nearFraction: 0.30,
  midFraction: 0.68,
  farDensityRatio: 0.16,
  midInstanceFraction: 0.38,
  farInstanceFraction: 0.12,
  ditherBandM: 12,
};

export const DEFAULT_GRASS_BLADE_SETTINGS: GrassBladeSettings = {
  heightM: 0.78,
  heightVariation: 0.52,
  widthM: 0.04,
  nearBladesPerInstance: 7,
  midBladesPerInstance: 4,
  nearSegments: 4,
  midSegments: 2,
  farTuftWidthM: 0.11,
  nearCrossedQuads: true,
  maxWidthCompensation: 1.45,
};

export const DEFAULT_GRASS_WIND_SETTINGS: GrassWindSettings = {
  direction: [0.8, 0.6],
  strength: 0.22,
  speed: 1.15,
  gustStrength: 0.12,
  turbulence: 0.25,
};

export const DEFAULT_GRASS_APPEARANCE_SETTINGS: GrassAppearanceSettings = {
  baseColor: [...GRASS_SHARED_BASE_LINEAR] as [number, number, number],
  tipColor: [...GRASS_TIP_LINEAR] as [number, number, number],
  dryColor: [...GRASS_DRY_LINEAR] as [number, number, number],
  normalPull: 1.0,
  patchScale: 18,
  patchStrength: 0.55,
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
  nearMeters: 32,
  midMeters: 82,
  farMeters: 120,
  farDistanceFraction: 0.96,
  bandMeters: DEFAULT_GRASS_LOD_SETTINGS.ditherBandM,
  scruffMeters: 38,
  scruffMinDensity: 0.42,
};

export const DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS: GrassPatchFallbackSettings = {
  maxNewPatchesPerRefresh: 1,
  refreshDistance: 8,
};

export const DEFAULT_GRASS_SETTINGS: GrassSettings = {
  enabled: true,
  shaderMode: DEFAULT_GRASS_SHADER_MODE,
  distanceM: 125,
  refreshDistanceM: DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS.refreshDistance,
  maxNewPatchesPerFrame: DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS.maxNewPatchesPerRefresh,
  maxInstances: 32000,
  placement: { ...DEFAULT_GRASS_PLACEMENT_SETTINGS },
  lod: { ...DEFAULT_GRASS_LOD_SETTINGS },
  blade: { ...DEFAULT_GRASS_BLADE_SETTINGS },
  wind: { ...DEFAULT_GRASS_WIND_SETTINGS },
  appearance: {
    ...DEFAULT_GRASS_APPEARANCE_SETTINGS,
    baseColor: [...DEFAULT_GRASS_APPEARANCE_SETTINGS.baseColor],
    tipColor: [...DEFAULT_GRASS_APPEARANCE_SETTINGS.tipColor],
    dryColor: [...DEFAULT_GRASS_APPEARANCE_SETTINGS.dryColor],
  },
  render: { ...DEFAULT_GRASS_RENDER_SETTINGS },
  debug: { ...DEFAULT_GRASS_DEBUG_SETTINGS },
  alphaToCoverage: DEFAULT_GRASS_RENDER_SETTINGS.alphaToCoverage,
  nearCrossedQuads: DEFAULT_GRASS_BLADE_SETTINGS.nearCrossedQuads,
  distance: 125,
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
    appearance: {
      ...DEFAULT_GRASS_APPEARANCE_SETTINGS,
      ...settings.appearance,
      baseColor: [...(settings.appearance?.baseColor ?? DEFAULT_GRASS_APPEARANCE_SETTINGS.baseColor)],
      tipColor: [...(settings.appearance?.tipColor ?? DEFAULT_GRASS_APPEARANCE_SETTINGS.tipColor)],
      dryColor: [...(settings.appearance?.dryColor ?? DEFAULT_GRASS_APPEARANCE_SETTINGS.dryColor)],
    },
    render: { ...settings.render },
    debug: { ...settings.debug },
    ring: { ...settings.ring },
    patchFallback: { ...settings.patchFallback },
  };
}
