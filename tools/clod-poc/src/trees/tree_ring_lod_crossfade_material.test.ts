import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./tree_config.js";
import { treeLodCrossfadeHalfBandM } from "./tree_lod_transition.js";
import {
  treeRingCrossfadeKeeps,
  treeRingCrossfadeState,
  treeRingStableDitherNoise,
} from "./tree_ring_lod_crossfade_material.js";

const SAMPLE_NOISE = [0, 0.001, 0.1, 0.25, 0.5, 0.75, 0.999];

function configuredSettings() {
  const settings = cloneTreeSettings();
  settings.distanceM = 420;
  settings.lod.farFraction = 0.62;
  settings.lod.crossfadeEnabled = true;
  settings.lod.ditherEnabled = true;
  settings.lod.crossfadeBandM = 10;
  return settings;
}

describe("GPU tree ring LOD crossfade material", () => {
  it("keeps far and impostor pixels complementary through the compute overlap band", () => {
    const settings = configuredSettings();
    const threshold = settings.distanceM * settings.lod.farFraction;
    const halfBand = treeLodCrossfadeHalfBandM(settings);

    for (const distance of [
      threshold - halfBand,
      threshold - halfBand / 2,
      threshold,
      threshold + halfBand / 2,
      threshold + halfBand,
    ]) {
      const far = treeRingCrossfadeState(distance, "far", settings);
      const impostor = treeRingCrossfadeState(distance, "impostor", settings);
      expect(far.fade + impostor.fade).toBeCloseTo(1, 8);
      expect(far.role).toBe("primary");
      expect(impostor.role).toBe("secondary");
      for (const noise of SAMPLE_NOISE) {
        const kept = Number(treeRingCrossfadeKeeps(noise, far))
          + Number(treeRingCrossfadeKeeps(noise, impostor));
        expect(kept).toBe(1);
      }
    }
  });

  it("uses one stable dither decision for a tree regardless of screen position", () => {
    const expected = treeRingStableDitherNoise(37, -12, 7331);
    const screenPositions = [[0, 0], [320, 180], [960, 540], [1919, 1079]];

    for (const screenPosition of screenPositions) {
      expect(screenPosition).toHaveLength(2);
      expect(treeRingStableDitherNoise(37, -12, 7331)).toBe(expected);
    }
    expect(treeRingStableDitherNoise(38, -12, 7331)).not.toBe(expected);
  });

  it("keeps the full tier outside a transition band and when dithering is disabled", () => {
    const settings = configuredSettings();
    expect(treeRingCrossfadeState(180, "far", settings)).toEqual({ fade: 1, role: "primary" });

    settings.lod.ditherEnabled = false;
    expect(treeRingCrossfadeState(260, "far", settings)).toEqual({ fade: 1, role: "primary" });
  });
});
