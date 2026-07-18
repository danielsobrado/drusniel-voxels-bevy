import type { WaterReflectionConfig } from "./waterConfig.js";

export type WaterReflectionBackend = "webgl" | "webgpu";
export type WaterReflectionMode = "sky_terrain_fallback" | "ssr";

export interface WaterReflectionPolicy {
  requestedMode: WaterReflectionConfig["mode"];
  activeMode: WaterReflectionMode;
  ssrRequested: boolean;
  ssrActive: boolean;
  fallbackStrength: number;
  reason: string;
}

export function resolveWaterReflectionPolicy(
  reflection: WaterReflectionConfig,
  backend: WaterReflectionBackend,
): WaterReflectionPolicy {
  const ssrRequested = reflection.mode === "ssr" || reflection.ssrEnabled;
  const fallbackStrength = Math.max(
    0,
    Math.min(1, reflection.skyFallbackStrength + reflection.terrainFallbackStrength),
  );

  if (ssrRequested && backend === "webgpu") {
    return {
      requestedMode: reflection.mode,
      activeMode: "ssr",
      ssrRequested: true,
      ssrActive: true,
      fallbackStrength,
      reason: "webgpu: screen-space reflection with sky/terrain miss fallback",
    };
  }

  if (ssrRequested) {
    return {
      requestedMode: reflection.mode,
      activeMode: "sky_terrain_fallback",
      ssrRequested: true,
      ssrActive: false,
      fallbackStrength,
      reason: `${backend}: ssr requires WebGPU; using safe sky/terrain fallback`,
    };
  }

  return {
    requestedMode: reflection.mode,
    activeMode: "sky_terrain_fallback",
    ssrRequested: false,
    ssrActive: false,
    fallbackStrength,
    reason: `${backend}: fake sky/terrain reflection policy`,
  };
}
