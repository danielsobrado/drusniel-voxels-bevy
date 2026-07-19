import { WEATHER_MODE_OPTIONS } from "../app/clod_constants.js";
import { describe, expect, it } from "vitest";
import {
  validateProjectWaterArchiveState,
  validateProjectWeatherArchiveState,
} from "./project_archive_environment_state.js";

describe("project archive water and weather state", () => {
  it("canonicalizes valid water and every supported weather mode", () => {
    expect(validateProjectWaterArchiveState({
      waterEnabled: true,
      waterDebugMode: "final",
      waterClipmapTint: false,
      waterWireframe: false,
      waterDepthWrite: true,
    }).waterDepthWrite).toBe(true);

    for (const weatherMode of WEATHER_MODE_OPTIONS) {
      expect(validateProjectWeatherArchiveState({
        weatherMode,
        weatherIntensity: 1,
        weatherWindX: -0.5,
        weatherWindZ: 0.75,
      }).weatherMode).toBe(weatherMode);
    }
  });

  it("rejects partial water state", () => {
    expect(() => validateProjectWaterArchiveState({
      waterEnabled: true,
      waterDebugMode: "final",
    })).toThrow(/waterClipmapTint/i);
  });

  it("rejects non-finite or excessive weather state", () => {
    expect(() => validateProjectWeatherArchiveState({
      weatherMode: "rain",
      weatherIntensity: Number.POSITIVE_INFINITY,
      weatherWindX: 0,
      weatherWindZ: 0,
    })).toThrow(/weatherIntensity/i);

    expect(() => validateProjectWeatherArchiveState({
      weatherMode: "rain",
      weatherIntensity: 1,
      weatherWindX: 100_000,
      weatherWindZ: 0,
    })).toThrow(/weatherWindX/i);
  });

  it("rejects unknown weather modes", () => {
    expect(() => validateProjectWeatherArchiveState({
      weatherMode: "volcanic-ash",
      weatherIntensity: 1,
      weatherWindX: 0,
      weatherWindZ: 0,
    })).toThrow(/weatherMode/i);
  });
});
