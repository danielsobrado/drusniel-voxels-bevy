import type { RenderResolutionConfig } from "./render_resolution.js";

export const DEFAULT_RENDER_RESOLUTION_PRESET = "high";

export const DEFAULT_RENDER_RESOLUTION_CONFIG: RenderResolutionConfig = {
  dprCap: 1.5,
  renderScale: 1.0,
  minEffectivePixelRatio: 0.5,
  maxEffectivePixelRatio: 2.0,
  presets: {
    performance100: {
      dprCap: 1.0,
      renderScale: 0.85,
    },
    low: {
      dprCap: 1.0,
      renderScale: 0.75,
    },
    medium: {
      dprCap: 1.25,
      renderScale: 0.9,
    },
    high: {
      dprCap: 1.5,
      renderScale: 1.0,
    },
    ultra: {
      dprCap: 2.0,
      renderScale: 1.0,
    },
  },
};
