import { CAVE_TEST_SCENE, CONTINENT_SCENE } from "../app/world_mode.js";
import { isRpgDensityScene } from "../scenes/rpg_density_scenes.js";

export function usesStreamingRuntimeWorld(scene: string | null): boolean {
  return (scene?.startsWith("infinite-") ?? false)
    || scene === CONTINENT_SCENE
    || isRpgDensityScene(scene);
}

export function usesCameraRelativeRuntimeWorld(scene: string | null): boolean {
  return usesStreamingRuntimeWorld(scene) || scene === CAVE_TEST_SCENE;
}

export function runtimeWorldUsesCameraRelativeCoordinates(): boolean {
  if (typeof globalThis.location === "undefined") return false;
  return usesCameraRelativeRuntimeWorld(new URLSearchParams(globalThis.location.search).get("scene"));
}
