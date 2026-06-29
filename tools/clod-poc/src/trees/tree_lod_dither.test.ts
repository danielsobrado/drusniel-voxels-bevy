import { describe, expect, it } from "vitest";
import {
  TREE_LOD_DITHER_PRIMARY_ROLE,
  TREE_LOD_DITHER_SECONDARY_ROLE,
  treeLodDitherKeeps,
} from "./tree_lod_dither.js";

describe("tree LOD dither masks", () => {
  it("keeps primary pixels below fade", () => {
    expect(treeLodDitherKeeps(0.24, 0.25, TREE_LOD_DITHER_PRIMARY_ROLE)).toBe(true);
    expect(treeLodDitherKeeps(0.25, 0.25, TREE_LOD_DITHER_PRIMARY_ROLE)).toBe(false);
  });

  it("keeps secondary pixels above the complementary threshold", () => {
    expect(treeLodDitherKeeps(0.74, 0.25, TREE_LOD_DITHER_SECONDARY_ROLE)).toBe(false);
    expect(treeLodDitherKeeps(0.75, 0.25, TREE_LOD_DITHER_SECONDARY_ROLE)).toBe(true);
  });

  it("has no holes or overlap for complementary primary and secondary fades", () => {
    const primaryFade = 0.75;
    const secondaryFade = 0.25;
    for (let i = 0; i <= 100; i++) {
      const noise = i / 100;
      const primary = treeLodDitherKeeps(noise, primaryFade, TREE_LOD_DITHER_PRIMARY_ROLE);
      const secondary = treeLodDitherKeeps(noise, secondaryFade, TREE_LOD_DITHER_SECONDARY_ROLE);
      expect(Number(primary) + Number(secondary)).toBe(1);
    }
  });
});
