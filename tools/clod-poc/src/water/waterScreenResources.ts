// Screen-space resource detection for the water material.
//
// On WebGPU, Three.js TSL provides viewportSharedTexture() and viewportDepthTexture()
// for depth-validated refraction and SSR. On WebGL, these are not available and the
// material falls back to its existing fake shading.
//
// This module detects availability once at init time and exposes it for the material.
let available = false;
let warnedOnce = false;

export interface WaterScreenResources {
  /** Whether viewport depth/color textures are available (WebGPU only). */
  readonly available: boolean;
}

export function initWaterScreenResources(isWebGpu: boolean): WaterScreenResources {
  available = isWebGpu;
  if (!isWebGpu && !warnedOnce) {
    console.info("[water] screen-space refraction/SSR disabled: requires WebGPU renderer");
    warnedOnce = true;
  }
  return { get available() { return available; } };
}

export function getWaterScreenResources(): WaterScreenResources {
  return { available };
}
