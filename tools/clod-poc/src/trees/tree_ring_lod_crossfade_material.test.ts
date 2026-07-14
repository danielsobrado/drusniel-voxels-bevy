import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./tree_config.js";
import {
  treeRingCrossfadeKeeps,
  treeRingCrossfadeState,
} from "./tree_ring_lod_crossfade_material.js";

const SAMPLE_NOISE = [0, 0.001, 0.1, 0.25, 0.5, 0.75, 0.999];

describe("GPU tree ring LOD crossfade material", () => {
  it("keeps far and impostor pixels complementary through the compute overlap band", () => {
    const settings = cloneTreeSettings();
    settings.distanceM = 420;
    settings.lod.farFraction = 0.62;
    settings.lod.crossfadeEnabled = true;
    settings.lod.ditherEnabled = true;
    settings.lod.crossfadeBandM = 20;
    const threshold = settings.distanceM * settings.lod.farFraction;

    for (const distance of [threshold - 20, threshold - 10, threshold, threshold + 10, threshold + 20]) {
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

  it("keeps the full tier outside a transition band and when dithering is disabled", () => {
    const settings = cloneTreeSettings();
    settings.distanceM = 420;
    settings.lod.crossfadeEnabled = true;
    settings.lod.ditherEnabled = true;
    settings.lod.crossfadeBandM = 20;
    expect(treeRingCrossfadeState(180, "far", settings)).toEqual({ fade: 1, role: "primary" });

    settings.lod.ditherEnabled = false;
    expect(treeRingCrossfadeState(260, "far", settings)).toEqual({ fade: 1, role: "primary" });
  });
});
