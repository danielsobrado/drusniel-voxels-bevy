import type { ShoreSurfBandSettings, ClipmapExclusionBandSettings } from "./water_field_types.js";

export const DEFAULT_SHORE_SURF_BAND_SETTINGS: ShoreSurfBandSettings = {
  enabled: false,
  startDistance: 48,
  fullSurfDistance: 16,
  level: 18,
  maxShallowDepth: 2.5,
};

export const DEFAULT_CLIPMAP_EXCLUSION_BAND_SETTINGS: ClipmapExclusionBandSettings = {
  enabled: false,
  distance: 0,
};
