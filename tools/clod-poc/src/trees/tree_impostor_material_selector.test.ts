import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  createSelectedTreeImpostorMaterial,
  treeImpostorMaterialMatchesSelection,
  TREE_IMPOSTOR_MATERIAL_SELECTION_KEY,
  type TreeImpostorAtlas,
} from "./index.js";

describe("tree impostor material selector", () => {
  it("selects classic shader material for non-WebGPU single-frame impostors", () => {
    const selection = { webgpu: false, viewBlend: false };
    const material = createSelectedTreeImpostorMaterial(cloneTreeSettings(), fakeAtlas(), selection);

    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.name).toBe("tree-impostor-oak");
    expect(material.userData[TREE_IMPOSTOR_MATERIAL_SELECTION_KEY]).toEqual(selection);
    expect(treeImpostorMaterialMatchesSelection(material, selection)).toBe(true);
  });

  it("selects classic shader material for non-WebGPU four-frame blend impostors", () => {
    const selection = { webgpu: false, viewBlend: true };
    const material = createSelectedTreeImpostorMaterial(cloneTreeSettings(), fakeAtlas(), selection);

    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.name).toBe("tree-impostor-blend-oak");
    expect(material.userData[TREE_IMPOSTOR_MATERIAL_SELECTION_KEY]).toEqual(selection);
    expect(treeImpostorMaterialMatchesSelection(material, selection)).toBe(true);
    expect(treeImpostorMaterialMatchesSelection(material, { webgpu: false, viewBlend: false })).toBe(false);
  });

  it("does not match untagged materials", () => {
    expect(treeImpostorMaterialMatchesSelection(new THREE.MeshBasicMaterial(), {
      webgpu: false,
      viewBlend: false,
    })).toBe(false);
  });
});

function fakeAtlas(): TreeImpostorAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  return {
    species: "oak",
    texture,
    albedo: texture,
    normalDepth: texture,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: [],
    radius: 1,
    centerY: 0,
    ready: true,
    dispose() {
      texture.dispose();
    },
  };
}
