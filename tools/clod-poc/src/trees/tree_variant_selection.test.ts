import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  treeImpostorFramesForVariant,
  type TreeImpostorAtlas,
} from "./tree_impostor_baker.js";
import {
  treeAtlasVariantIndex,
  treeVariantIndex,
  treeVariantPhase,
} from "./tree_variant_selection.js";

const frame = (index: number) => ({
  index,
  x: index,
  y: 0,
  direction: [0, 1, 0] as [number, number, number],
  uvMin: [0, 0] as [number, number],
  uvMax: [1, 1] as [number, number],
});

describe("tree structural variant selection", () => {
  it("is deterministic and bounded for world-space tree positions", () => {
    for (const [x, z, seed] of [[0, 0, 1], [17.25, -9.5, 7331], [1024, 2048, 99]]) {
      const phase = treeVariantPhase(x, z, seed);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
      expect(treeVariantIndex(x, z, seed, 4)).toBe(treeVariantIndex(x, z, seed, 4));
      expect(treeVariantIndex(x, z, seed, 4)).toBeGreaterThanOrEqual(0);
      expect(treeVariantIndex(x, z, seed, 4)).toBeLessThan(4);
    }
  });

  it("maps all structural variants onto the available atlas pages consistently", () => {
    expect([0, 1, 2, 3].map((variant) => treeAtlasVariantIndex(variant, 2))).toEqual([0, 1, 0, 1]);
  });

  it("uses the same bounded atlas-page mapping in the CPU impostor runtime", () => {
    const texture = new THREE.Texture();
    const frames0 = [frame(0)];
    const frames1 = [frame(1)];
    const atlas: TreeImpostorAtlas = {
      species: "oak",
      texture,
      albedo: texture,
      gridSize: 1,
      resolutionPx: 1,
      atlasSizePx: 1,
      atlasWidthPx: 1,
      atlasHeightPx: 2,
      variantCount: 2,
      frames: frames0,
      variantFrames: { 0: frames0, 1: frames1 },
      ready: true,
      dispose() {},
    };

    expect(treeImpostorFramesForVariant(atlas, 0)).toBe(frames0);
    expect(treeImpostorFramesForVariant(atlas, 1)).toBe(frames1);
    expect(treeImpostorFramesForVariant(atlas, 2)).toBe(frames0);
    expect(treeImpostorFramesForVariant(atlas, 3)).toBe(frames1);
  });
});
