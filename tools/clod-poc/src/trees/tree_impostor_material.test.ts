import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  createTreeImpostorBlendMaterial,
  createTreeImpostorBlendNodeMaterial,
  createTreeImpostorMaterial,
  createTreeImpostorNodeMaterial,
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

  it("creates WebGPU single-frame node material with LOD dither mask", () => {
    const material = createTreeImpostorNodeMaterial(cloneTreeSettings(), fakeAtlas());

    expect((material as unknown as { maskNode?: unknown }).maskNode).toBeDefined();
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.depthWrite).toBe(true);
    expect(material.transparent).toBe(false);
  });

  it("creates WebGPU four-tile node material with LOD dither mask", () => {
    const material = createTreeImpostorBlendNodeMaterial(cloneTreeSettings(), fakeAtlas());

    expect((material as unknown as { maskNode?: unknown }).maskNode).toBeDefined();
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.depthWrite).toBe(true);
    expect(material.transparent).toBe(false);
  });

  it("updates alpha and render flags", () => {
    const settings = cloneTreeSettings();
    const material = createTreeImpostorMaterial(settings, fakeAtlas());
    settings.impostors.alphaTest = 0.61;
    updateTreeImpostorMaterialSettings(material, settings);

    expect(material.uniforms.alphaTest.value).toBe(0.61);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.depthWrite).toBe(true);
    expect(material.transparent).toBe(false);
  });

  it("keeps single-frame shader attributes, complementary dither roles, and relighting path stable", () => {
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("attribute vec4 treeImpostorUvRect");
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("attribute float treeLodFade");
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("attribute float treeLodDitherRole");
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("varying float vTreeImpostorLodDitherRole");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("uniform sampler2D normalDepthMap");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("treeImpostorRelight");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("float sun = clamp");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("vec3 transmission");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("treeImpostorDitherKeep");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("return ign < fade");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("return ign >= 1.0 - fade");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("vTreeImpostorLodDitherRole");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("treeImpostorDecodeAlbedo");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("encoded * encoded");
  });

  it("keeps four-tile blend shader attributes, complementary dither roles, and weighted relighting path stable", () => {
    for (let i = 0; i < 4; i++) {
      expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain(`attribute vec4 treeImpostorUvRect${i}`);
      expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain(`vTreeImpostorUv${i}`);
    }
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("attribute vec4 treeImpostorBlendWeights");
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("attribute float treeLodFade");
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("attribute float treeLodDitherRole");
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("varying float vTreeImpostorLodDitherRole");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("dot(coverages, vTreeImpostorBlendWeights)");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("normalDepthMap");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("treeImpostorRelight");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("treeImpostorBlendPackedNormal");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("inversesqrt");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("treeImpostorDitherKeep");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("return ign < fade");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("return ign >= 1.0 - fade");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("vTreeImpostorLodDitherRole");
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
