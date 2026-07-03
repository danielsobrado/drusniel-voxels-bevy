import type { DynamicResolutionConfig, RenderResolutionConfig } from "./render_resolution.js";

export const DEFAULT_RENDER_RESOLUTION_PRESET = "high";

export const DEFAULT_DYNAMIC_RESOLUTION_CONFIG: DynamicResolutionConfig = {
  enabled: true,
  targetMs: 16.6,
  minScale: 0.7,
  maxScale: 1.0,
  stepUp: 0.025,
  stepDown: 0.05,
  sampleWindowFrames: 30,
  settleFrames: 20,
  upscaleHeadroomMs: 2.0,
  downscaleOverMs: 1.0,
};

export const DEFAULT_RENDER_RESOLUTION_CONFIG: RenderResolutionConfig = {
  dprCap: 1.5,
  renderScale: 1.0,
  minEffectivePixelRatio: 0.5,
  maxEffectivePixelRatio: 2.0,
  dynamic: DEFAULT_DYNAMIC_RESOLUTION_CONFIG,
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
