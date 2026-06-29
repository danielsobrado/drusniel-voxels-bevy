import { describe, expect, it } from "vitest";
import {
  TREE_LOD_DITHER_SCALE,
  TREE_LOD_DITHER_X,
  TREE_LOD_DITHER_Y,
  treeFarToImpostorBoundaryKeep,
  treeLodBoundaryFade,
  treeLodFadeInKeep,
  treeLodFadeOutKeep,
  treeLodInterleavedGradientNoise,
} from "./tree_lod_crossfade.js";

function sampleNoises(): number[] {
  return [0, 0.001, 0.1, 0.25, 0.5, 0.75, 0.999];
}

describe("tree LOD crossfade contract", () => {
  it("uses the same interleaved-gradient constants as the TSL materials", () => {
    expect(TREE_LOD_DITHER_X).toBeCloseTo(0.06711056);
    expect(TREE_LOD_DITHER_Y).toBeCloseTo(0.00583715);
    expect(TREE_LOD_DITHER_SCALE).toBeCloseTo(52.9829189);
  });

  it("keeps far and impostor pixels complementary across the transition band", () => {
    const farBoundaryM = 460;
    const bandM = 32;
    for (const distanceM of [farBoundaryM - bandM, farBoundaryM - bandM * 0.5, farBoundaryM, farBoundaryM + bandM * 0.5, farBoundaryM + bandM]) {
      for (const noise of sampleNoises()) {
        const keep = treeFarToImpostorBoundaryKeep(noise, distanceM, farBoundaryM, bandM);
        expect(Number(keep.farKeep) + Number(keep.impostorKeep)).toBe(1);
      }
    }
  });

  it("matches fade-out and fade-in thresholds exactly", () => {
    const fade = treeLodBoundaryFade(460, 460, 32);
    for (const noise of sampleNoises()) {
      expect(treeLodFadeOutKeep(noise, fade.fadeOut)).toBe(!treeLodFadeInKeep(noise, fade.fadeIn));
    }
  });

  it("produces stable screen-door noise in [0, 1)", () => {
    for (const [x, y] of [[0, 0], [1, 1], [127, 63], [1920, 1080]]) {
      const noise = treeLodInterleavedGradientNoise(x, y);
      expect(noise).toBeGreaterThanOrEqual(0);
      expect(noise).toBeLessThan(1);
    }
  });
});
