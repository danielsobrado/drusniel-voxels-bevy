import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTreeFoliageAtlas } from "./tree_alpha_mask.js";
import { cloneTreeSettings } from "./tree_config.js";
import {
  createTreeImpostorBakeMaterial,
  createTreeImpostorNormalDepthBakeMaterial,
  TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
} from "./tree_impostor_capture_material.js";

describe("tree impostor capture material parity", () => {
  it("applies the live foliage-card coverage mask to both WebGPU capture passes", () => {
    const settings = cloneTreeSettings();
    const atlas = createTreeFoliageAtlas(settings);
    const albedo = createTreeImpostorBakeMaterial(
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      settings,
      atlas,
      true,
    ) as THREE.Material & { maskNode?: unknown; colorNode?: unknown };
    const normalDepth = createTreeImpostorNormalDepthBakeMaterial(
      0.01,
      100,
      atlas,
      true,
    ) as THREE.Material & { maskNode?: unknown; colorNode?: unknown; opacityNode?: unknown };

    expect(albedo.maskNode).toBeDefined();
    expect(albedo.colorNode).toBeDefined();
    expect(normalDepth.maskNode).toBeDefined();
    expect(normalDepth.colorNode).toBeDefined();
    expect(normalDepth.opacityNode).toBeDefined();

    albedo.dispose();
    normalDepth.dispose();
    atlas.dispose();
  });

  it("keeps the WebGL normal-depth fallback coverage-aware", () => {
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("uniform sampler2D foliageAtlas");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("vTreeImpostorFoliageCard > 0.5");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("texture2D(foliageAtlas, atlasUv).a");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("discard");
  });
});
