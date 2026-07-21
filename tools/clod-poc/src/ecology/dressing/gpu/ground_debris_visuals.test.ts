import { describe, expect, it } from "vitest";
import {
  GROUND_DEBRIS_CLASSES,
  groundDebrisVisibility,
  groundDebrisVisualProfile,
  groundDebrisWetMix,
} from "./ground_debris_visuals.js";

function luminance(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
}

describe("ground debris visual profiles", () => {
  it("owns the intended litter, wood-fragment, and pebble classes", () => {
    expect(GROUND_DEBRIS_CLASSES).toEqual([
      "leaf_litter",
      "needle_litter",
      "twig_cluster",
      "bark_chip_cluster",
      "small_talus",
      "river_cobbles",
      "wet_stone_cluster",
    ]);
  });

  it("finishes every stable fade inside the shared dressing radius", () => {
    for (const classId of GROUND_DEBRIS_CLASSES) {
      const profile = groundDebrisVisualProfile(classId);
      expect(profile).not.toBeNull();
      expect(profile!.fadeStartM).toBeGreaterThanOrEqual(0);
      expect(profile!.fadeEndM).toBeGreaterThan(profile!.fadeStartM);
      expect(profile!.fadeEndM).toBeLessThanOrEqual(110);
      expect(groundDebrisVisibility(profile!.fadeStartM, profile!)).toBe(1);
      expect(groundDebrisVisibility(profile!.fadeEndM, profile!)).toBe(0);
    }
  });

  it("darkens and smooths every class when wet", () => {
    for (const classId of GROUND_DEBRIS_CLASSES) {
      const profile = groundDebrisVisualProfile(classId)!;
      expect(luminance(profile.wetColor)).toBeLessThan(luminance(profile.baseColor));
      expect(profile.wetRoughness).toBeLessThan(profile.dryRoughness);
    }
    expect(groundDebrisWetMix(-2)).toBe(0);
    expect(groundDebrisWetMix(2)).toBe(1);
  });

  it("does not claim unrelated ecological dressing classes", () => {
    expect(groundDebrisVisualProfile("dead_log_fresh")).toBeNull();
    expect(groundDebrisVisualProfile("moss_patch")).toBeNull();
    expect(groundDebrisVisualProfile("flower_patch")).toBeNull();
  });
});
