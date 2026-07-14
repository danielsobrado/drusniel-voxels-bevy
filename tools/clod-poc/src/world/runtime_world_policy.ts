import { CAVE_TEST_SCENE, CONTINENT_SCENE, INFINITE_ISLANDS_SCENE } from "../app/world_mode.js";

export function usesCameraRelativeRuntimeWorld(scene: string | null): boolean {
  return scene === INFINITE_ISLANDS_SCENE || scene === CONTINENT_SCENE || scene === CAVE_TEST_SCENE;
}

export function runtimeWorldUsesCameraRelativeCoordinates(): boolean {
  if (typeof globalThis.location === "undefined") return false;
  return usesCameraRelativeRuntimeWorld(new URLSearchParams(globalThis.location.search).get("scene"));
}
