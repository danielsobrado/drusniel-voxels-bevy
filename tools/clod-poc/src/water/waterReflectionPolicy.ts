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

  // TODO(WATER-302): Switch WebGPU to active SSR once screen-space hit/miss resources
  // are wired. The current shader path uses procedural sky/terrain fallback only.
  if (ssrRequested) {
    return {
      requestedMode: reflection.mode,
      activeMode: "sky_terrain_fallback",
      ssrRequested,
      ssrActive: false,
      fallbackStrength,
      reason: `${backend}: ssr requested but not runtime-wired; using safe sky/terrain fallback`,
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
