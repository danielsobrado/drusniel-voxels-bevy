import * as THREE from "three";
import type {
  RainWeatherSettings,
  SandstormWeatherSettings,
  SnowWeatherSettings,
  StormWeatherSettings,
} from "./rain_types.js";
import type { RainWeatherShaderHandle } from "./rainShaderMaterial.js";

export type WindWeatherSettings = RainWeatherSettings | SnowWeatherSettings | SandstormWeatherSettings;

export function clampWindWeatherSettings<T extends WindWeatherSettings>(settings: T): T {
  return {
    ...settings,
    enabled: settings.enabled,
    intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
    windX: THREE.MathUtils.clamp(settings.windX, -5, 5),
    windZ: THREE.MathUtils.clamp(settings.windZ, -5, 5),
  };
}

export function clampStormWeatherSettings(settings: StormWeatherSettings): StormWeatherSettings {
  return {
    enabled: settings.enabled,
    intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
  };
}

export function isWeatherVisible(settings: Pick<WindWeatherSettings, "enabled" | "intensity">): boolean {
  return settings.enabled && settings.intensity > 0.001;
}

export function applyWindWeatherToMaterials(settings: WindWeatherSettings, materials: readonly RainWeatherShaderHandle[]): void {
  for (const material of materials) {
    material.setIntensity(settings.intensity);
    material.setWind(settings.windX, settings.windZ);
  }
}

export function applyStormWeatherToMaterials(settings: StormWeatherSettings, materials: readonly RainWeatherShaderHandle[]): void {
  for (const material of materials) material.setIntensity(settings.intensity);
}
