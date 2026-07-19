import { describe, expect, it } from "vitest";
import {
  GLACIAL_WATER_ACCEPTANCE_DEBUG_MODES,
  GLACIAL_WATER_CAPTURE_PROFILES,
  cameraPoseMatches,
  captureFileName,
  glacialWaterProfileUrl,
} from "./glacial-water-acceptance-config.js";

describe("glacial water acceptance config", () => {
  it("uses identical scene order for the baseline and glacial A/B", () => {
    expect(GLACIAL_WATER_CAPTURE_PROFILES.glacial.scenes)
      .toEqual(GLACIAL_WATER_CAPTURE_PROFILES.baseline.scenes);
  });

  it("changes only glacial optical switches in the normal A/B query", () => {
    const baseline = GLACIAL_WATER_CAPTURE_PROFILES.baseline.query;
    const glacial = GLACIAL_WATER_CAPTURE_PROFILES.glacial.query;
    const keys = new Set([...Object.keys(baseline), ...Object.keys(glacial)]);

    for (const key of keys) {
      if (key === "waterGlacialMurkiness" || key === "waterRockFlour") continue;
      expect(glacial[key]).toBe(baseline[key]);
    }
    expect(baseline.waterGlacialMurkiness).toBe("0");
    expect(glacial.waterGlacialMurkiness).toBe("1");
    expect(baseline.waterRockFlour).toBe("0");
    expect(glacial.waterRockFlour).toBe("1");
  });

  it("owns a separate low-sun glitter profile", () => {
    const profile = GLACIAL_WATER_CAPTURE_PROFILES["glacial-low-sun"];
    expect(profile.scenes).toEqual(["low-sun-glitter"]);
    expect(Number(profile.query.sunElevationDeg)).toBeLessThan(10);
    expect(Number.isFinite(Number(profile.query.sunAzimuthDeg))).toBe(true);
  });

  it("preserves base URL parameters while applying the profile", () => {
    const result = new URL(glacialWaterProfileUrl(
      "http://127.0.0.1:5180/?world=16&waterDebug=1",
      GLACIAL_WATER_CAPTURE_PROFILES.glacial,
    ));

    expect(result.searchParams.get("world")).toBe("16");
    expect(result.searchParams.get("waterDebug")).toBe("1");
    expect(result.searchParams.get("waterGlacialMurkiness")).toBe("1");
    expect(result.searchParams.get("waterRockFlour")).toBe("1");
  });

  it("requires exact camera parity within numeric tolerance", () => {
    const pose = { x: 1, z: 2, y: 3, yaw: 4, distance: 5, pitch: -0.2 };
    expect(cameraPoseMatches(pose, { ...pose, x: pose.x + 1e-10 })).toBe(true);
    expect(cameraPoseMatches(pose, { ...pose, x: pose.x + 1e-4 })).toBe(false);
    expect(cameraPoseMatches({ x: 1, z: 2 }, { x: 1, z: 2, yaw: 0 })).toBe(false);
  });

  it("uses stable filenames for camel-case and scatter debug modes", () => {
    expect(captureFileName("clipmapLevel")).toBe("clipmap-level.png");
    expect(captureFileName("ssrHit")).toBe("ssr-hit.png");
    expect(captureFileName("suspendedScatter")).toBe("suspended-scatter.png");
    expect(captureFileName("reflection")).toBe("reflection.png");
    expect(GLACIAL_WATER_ACCEPTANCE_DEBUG_MODES).toContain("ssrHit");
    expect(GLACIAL_WATER_ACCEPTANCE_DEBUG_MODES).toContain("suspendedScatter");
  });
});
