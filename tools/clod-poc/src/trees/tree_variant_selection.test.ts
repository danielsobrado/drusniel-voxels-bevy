import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  TREE_IMPOSTOR_MAX_ATLAS_VARIANTS,
  treeImpostorFramesForVariant,
  type TreeImpostorAtlas,
} from "./tree_impostor_baker.js";
import { TREE_STRUCTURAL_VARIANTS } from "./tree_instances.js";
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
  uvMin: [0, index * 0.25] as [number, number],
  uvMax: [1, (index + 1) * 0.25] as [number, number],
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

  it("allocates one production atlas page per structural variant", () => {
    expect(TREE_IMPOSTOR_MAX_ATLAS_VARIANTS).toBe(TREE_STRUCTURAL_VARIANTS);
    expect(TREE_IMPOSTOR_MAX_ATLAS_VARIANTS).toBe(4);
    expect([0, 1, 2, 3].map((variant) => treeAtlasVariantIndex(variant, 4))).toEqual([0, 1, 2, 3]);
  });

  it("keeps bounded page mapping for partial or legacy atlases", () => {
    expect([0, 1, 2, 3].map((variant) => treeAtlasVariantIndex(variant, 2))).toEqual([0, 1, 0, 1]);
  });

  it("returns the matching page for every production structural variant", () => {
    const texture = new THREE.Texture();
    const frames = [0, 1, 2, 3].map((index) => [frame(index)]);
    const atlas: TreeImpostorAtlas = {
      species: "oak",
      texture,
      albedo: texture,
      gridSize: 1,
      resolutionPx: 1,
      atlasSizePx: 1,
      atlasWidthPx: 1,
      atlasHeightPx: 4,
      variantCount: 4,
      frames: frames[0],
      variantFrames: { 0: frames[0], 1: frames[1], 2: frames[2], 3: frames[3] },
      ready: true,
      dispose() {},
    };

    for (let variant = 0; variant < TREE_STRUCTURAL_VARIANTS; variant++) {
      expect(treeImpostorFramesForVariant(atlas, variant)).toBe(frames[variant]);
    }
  });
});
