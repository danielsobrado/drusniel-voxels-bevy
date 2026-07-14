import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  octFrames,
  selectTreeImpostorBakeGeometry,
  treeImpostorFramesForVariant,
  TREE_IMPOSTOR_MAX_ATLAS_VARIANTS,
  TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
  TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER,
  TREE_STRUCTURAL_VARIANTS,
  type TreeGeometryMap,
  type TreeImpostorAtlas,
} from "./index.js";
import { estimateTreeImpostorAtlasMemoryMiB } from "./tree_impostor_memory.js";

describe("tree impostor baker quality", () => {
  it("selects every structural variant instead of the merged selector geometry", () => {
    const merged = new THREE.BufferGeometry();
    const variants = Array.from({ length: TREE_STRUCTURAL_VARIANTS }, () => new THREE.BufferGeometry());
    const map = {
      oak: {
        near: merged,
        mid: merged,
        far: merged,
        impostor: merged,
        variants: Object.fromEntries(variants.map((geometry, variant) => [variant, {
          near: geometry,
          mid: geometry,
          far: geometry,
          impostor: geometry,
        }])),
      },
    } as unknown as TreeGeometryMap;

    expect(TREE_IMPOSTOR_MAX_ATLAS_VARIANTS).toBe(TREE_STRUCTURAL_VARIANTS);
    for (let variant = 0; variant < TREE_STRUCTURAL_VARIANTS; variant++) {
      expect(selectTreeImpostorBakeGeometry(map, "oak", "mid", variant)).toBe(variants[variant]);
    }
  });

  it("accounts for all four variant pages in the production memory estimate", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.resolutionPx = 192;
    settings.impostors.octahedralGridSize = 8;

    expect(estimateTreeImpostorAtlasMemoryMiB(settings)).toBeCloseTo(576, 5);
  });

  it("stores tree-local normals, not camera-view normals", () => {
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).toContain("vTreeImpostorLocalNormal = normalize(normal)");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).not.toContain("normalMatrix * normal");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("vTreeImpostorLocalNormal");
  });

  it("returns four distinct variant-specific atlas frame pages", () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const base = octFrames(2, 16, 1);
    const pages = Array.from({ length: TREE_STRUCTURAL_VARIANTS }, (_, variant) => base.map((frame) => ({
      ...frame,
      uvMin: [frame.uvMin[0], (frame.uvMin[1] + variant) / TREE_STRUCTURAL_VARIANTS] as [number, number],
      uvMax: [frame.uvMax[0], (frame.uvMax[1] + variant) / TREE_STRUCTURAL_VARIANTS] as [number, number],
    })));
    const atlas: TreeImpostorAtlas = {
      species: "oak",
      texture,
      albedo: texture,
      normalDepth: texture,
      gridSize: 2,
      resolutionPx: 16,
      atlasSizePx: 32,
      atlasWidthPx: 32,
      atlasHeightPx: 128,
      variantCount: TREE_STRUCTURAL_VARIANTS,
      frames: pages[0],
      variantFrames: { 0: pages[0], 1: pages[1], 2: pages[2], 3: pages[3] },
      ready: true,
      dispose() {
        texture.dispose();
      },
    };

    for (let variant = 0; variant < TREE_STRUCTURAL_VARIANTS; variant++) {
      expect(treeImpostorFramesForVariant(atlas, variant)).toBe(pages[variant]);
    }
  });
});
