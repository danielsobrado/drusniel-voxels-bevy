import { WATER_DEBUG_MODES } from "../water/waterConfig.js";
import type {
  ProjectWaterArchiveState,
  ProjectWeatherArchiveState,
} from "./voxel_project_archive_types.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`project.json ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function bool(raw: Record<string, unknown>, key: string, label: string): boolean {
  const value = raw[key];
  if (typeof value !== "boolean") throw new Error(`project.json ${label}.${key} must be a boolean`);
  return value;
}

function finite(
  raw: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
  max: number,
): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`project.json ${label}.${key} must be finite in [${min}, ${max}]`);
  }
  return value;
}

export function validateProjectWaterArchiveState(value: unknown): ProjectWaterArchiveState {
  const raw = record(value, "water");
  const waterDebugMode = raw.waterDebugMode;
  if (typeof waterDebugMode !== "string" || !Object.prototype.hasOwnProperty.call(WATER_DEBUG_MODES, waterDebugMode)) {
    throw new Error("project.json water.waterDebugMode is invalid");
  }
  return {
    waterEnabled: bool(raw, "waterEnabled", "water"),
    waterDebugMode: waterDebugMode as ProjectWaterArchiveState["waterDebugMode"],
    waterClipmapTint: bool(raw, "waterClipmapTint", "water"),
    waterWireframe: bool(raw, "waterWireframe", "water"),
    waterDepthWrite: bool(raw, "waterDepthWrite", "water"),
  };
}

export function validateProjectWeatherArchiveState(value: unknown): ProjectWeatherArchiveState {
  const raw = record(value, "weather");
  const weatherMode = raw.weatherMode;
  if (typeof weatherMode !== "string" || !["off", "rain", "snow", "sandstorm"].includes(weatherMode)) {
    throw new Error("project.json weather.weatherMode is invalid");
  }
  return {
    weatherMode: weatherMode as ProjectWeatherArchiveState["weatherMode"],
    weatherIntensity: finite(raw, "weatherIntensity", "weather", 0, 100),
    weatherWindX: finite(raw, "weatherWindX", "weather", -10_000, 10_000),
    weatherWindZ: finite(raw, "weatherWindZ", "weather", -10_000, 10_000),
  };
}
