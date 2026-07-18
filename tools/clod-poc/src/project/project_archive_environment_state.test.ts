import { describe, expect, it } from "vitest";
import {
  validateProjectWaterArchiveState,
  validateProjectWeatherArchiveState,
} from "./project_archive_environment_state.js";

describe("project archive water and weather state", () => {
  it("canonicalizes valid water and weather settings", () => {
    expect(validateProjectWaterArchiveState({
      waterEnabled: true,
      waterDebugMode: "final",
      waterClipmapTint: false,
      waterWireframe: false,
      waterDepthWrite: true,
    }).waterDepthWrite).toBe(true);

    expect(validateProjectWeatherArchiveState({
      weatherMode: "rain",
      weatherIntensity: 1,
      weatherWindX: -0.5,
      weatherWindZ: 0.75,
    }).weatherMode).toBe("rain");
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
});
