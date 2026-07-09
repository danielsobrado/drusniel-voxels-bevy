import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  octFrames,
  selectTreeImpostorBakeGeometry,
  treeImpostorFramesForVariant,
  TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
  TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER,
  type TreeGeometryMap,
  type TreeImpostorAtlas,
} from "./index.js";

describe("tree impostor baker quality", () => {
  it("selects one structural variant instead of the merged selector geometry", () => {
    const merged = new THREE.BufferGeometry();
    const canonical = new THREE.BufferGeometry();
    const variant = new THREE.BufferGeometry();
    const map = {
      oak: {
        near: merged,
        mid: merged,
        far: merged,
        impostor: merged,
        variants: {
          0: {
            near: canonical,
            mid: canonical,
            far: canonical,
            impostor: canonical,
          },
          1: {
            near: variant,
            mid: variant,
            far: variant,
            impostor: variant,
          },
        },
      },
    } as unknown as TreeGeometryMap;

    expect(selectTreeImpostorBakeGeometry(map, "oak", "mid")).toBe(canonical);
    expect(selectTreeImpostorBakeGeometry(map, "oak", "mid", 1)).toBe(variant);
  });

  it("stores tree-local normals, not camera-view normals", () => {
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).toContain("vTreeImpostorLocalNormal = normalize(normal)");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).not.toContain("normalMatrix * normal");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("vTreeImpostorLocalNormal");
  });

  it("returns variant-specific atlas frames when they exist", () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const base = octFrames(2, 16, 1);
    const variant = base.map((frame) => ({
      ...frame,
      uvMin: [frame.uvMin[0], frame.uvMin[1] + 0.5] as [number, number],
      uvMax: [frame.uvMax[0], frame.uvMax[1] + 0.5] as [number, number],
    }));
    const atlas: TreeImpostorAtlas = {
      species: "oak",
      texture,
      albedo: texture,
      normalDepth: texture,
      gridSize: 2,
      resolutionPx: 16,
      atlasSizePx: 32,
      atlasWidthPx: 32,
      atlasHeightPx: 64,
      variantCount: 2,
      frames: base,
      variantFrames: { 0: base, 1: variant },
      ready: true,
      dispose() {
        texture.dispose();
      },
    };

    expect(treeImpostorFramesForVariant(atlas, 0)[0].uvMin[1]).toBeCloseTo(base[0].uvMin[1]);
    expect(treeImpostorFramesForVariant(atlas, 1)[0].uvMin[1]).toBeCloseTo(variant[0].uvMin[1]);
  });
});
