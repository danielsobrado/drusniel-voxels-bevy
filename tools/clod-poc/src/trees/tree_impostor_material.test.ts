import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  createTreeImpostorBlendMaterial,
  createTreeImpostorMaterial,
  TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER,
  TREE_IMPOSTOR_BLEND_VERTEX_SHADER,
  TREE_IMPOSTOR_FRAGMENT_SHADER,
  TREE_IMPOSTOR_VERTEX_SHADER,
  updateTreeImpostorMaterialSettings,
  type TreeImpostorAtlas,
} from "./index.js";

describe("tree impostor material contracts", () => {
  it("creates classic relit impostor material with atlas uniforms", () => {
    const settings = cloneTreeSettings();
    settings.impostors.alphaTest = 0.37;
    const atlas = fakeAtlas();
    const material = createTreeImpostorMaterial(settings, atlas);

    expect(material.name).toBe("tree-impostor-oak");
    expect(material.uniforms.map.value).toBe(atlas.albedo);
    expect(material.uniforms.normalDepthMap.value).toBe(atlas.normalDepth);
    expect(material.uniforms.hasNormalDepthMap.value).toBe(1);
    expect(material.uniforms.alphaTest.value).toBe(0.37);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.depthWrite).toBe(true);
    expect(material.transparent).toBe(false);
  });

  it("creates four-tile blend material with atlas uniforms", () => {
    const settings = cloneTreeSettings();
    settings.impostors.alphaTest = 0.42;
    const atlas = fakeAtlas();
    const material = createTreeImpostorBlendMaterial(settings, atlas);

    expect(material.name).toBe("tree-impostor-blend-oak");
    expect(material.uniforms.map.value).toBe(atlas.albedo);
    expect(material.uniforms.normalDepthMap.value).toBe(atlas.normalDepth);
    expect(material.uniforms.hasNormalDepthMap.value).toBe(1);
    expect(material.uniforms.alphaTest.value).toBe(0.42);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.depthWrite).toBe(true);
    expect(material.transparent).toBe(false);
  });

  it("updates alpha and render flags", () => {
    const settings = cloneTreeSettings();
    const material = createTreeImpostorMaterial(settings, fakeAtlas());
    const previousVersion = material.version;
    settings.impostors.alphaTest = 0.61;
    updateTreeImpostorMaterialSettings(material, settings);

    expect(material.uniforms.alphaTest.value).toBe(0.61);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.depthWrite).toBe(true);
    expect(material.transparent).toBe(false);
    expect(material.version).toBeGreaterThan(previousVersion);
  });

  it("keeps single-frame shader attributes and relighting path stable", () => {
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("attribute vec4 treeImpostorUvRect");
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("varying vec2 vTreeImpostorUv");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("uniform sampler2D normalDepthMap");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("treeImpostorRelight");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("color.rgb * color.rgb");
  });

  it("keeps four-tile blend shader attributes and weighted relighting path stable", () => {
    for (let i = 0; i < 4; i++) {
      expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain(`attribute vec4 treeImpostorUvRect${i}`);
      expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain(`vTreeImpostorUv${i}`);
    }
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("attribute vec4 treeImpostorBlendWeights");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("vTreeImpostorBlendWeights.x");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("normalDepthMap");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("treeImpostorRelight");
  });
});

function fakeAtlas(): TreeImpostorAtlas {
  const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const normalDepth = new THREE.DataTexture(new Uint8Array([128, 255, 128, 255]), 1, 1);
  return {
    species: "oak",
    texture: albedo,
    albedo,
    normalDepth,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: [],
    radius: 1,
    centerY: 0,
    ready: true,
    dispose() {
      albedo.dispose();
      normalDepth.dispose();
    },
  };
}
