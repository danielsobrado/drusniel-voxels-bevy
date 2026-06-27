// Screen-space resource detection for the water material.
//
// The TSL water material is dynamically imported only on the WebGPU path, where
// Three.js exposes viewportSharedTexture() and viewportDepthTexture(). The WebGL
// fallback never imports that material. Keep this module as the single capability
// switch so tests/tools can explicitly disable advanced water without changing
// material code.
let available = true;
let initialized = false;
let warnedOnce = false;

export interface WaterScreenResources {
  /** Whether viewport depth/color textures are available for advanced water. */
  readonly available: boolean;
}

export function initWaterScreenResources(isWebGpu: boolean): WaterScreenResources {
  initialized = true;
  available = isWebGpu;
  if (!isWebGpu && !warnedOnce) {
    console.info("[water] screen-space refraction/SSR disabled: requires WebGPU renderer");
    warnedOnce = true;
  }
  return { get available() { return available; } };
}

export function getWaterScreenResources(): WaterScreenResources {
  if (!initialized && !warnedOnce) {
    console.info("[water] screen-space refraction/SSR using WebGPU default capability");
    warnedOnce = true;
  }
  return { available };
}
