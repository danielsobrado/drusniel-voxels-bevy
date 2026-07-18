import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import { cloneTreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import {
  createLiveTreeImpostorMaterial,
  updateLiveTreeImpostorMaterialLighting,
} from "./tree_impostor_live_material.js";

const LIGHTING_UNIFORM_NAMES = [
  "uTreeImpostorSunDirection",
  "uTreeImpostorSunColor",
  "uTreeImpostorSkyColor",
  "uTreeImpostorGroundColor",
  "uTreeImpostorAmbientFloor",
] as const;

describe("tree impostor live environment lighting", () => {
  it("creates classic impostors with current environment uniforms", () => {
    const initial = lighting(0.2);
    const material = createLiveTreeImpostorMaterial(
      cloneTreeSettings(),
      atlas(true),
      { webgpu: false, viewBlend: false },
      initial,
    ) as THREE.ShaderMaterial;

    for (const name of LIGHTING_UNIFORM_NAMES) expect(material.uniforms[name]).toBeDefined();
    expect(material.uniforms.uTreeImpostorSunDirection.value).toEqual(initial.sunDirection.clone().normalize());
    expect(material.uniforms.uTreeImpostorSunColor.value).toEqual(initial.sunColor);
    expect(material.uniforms.uTreeImpostorAmbientFloor.value).toBe(initial.ambientFloor);
    expect(material.fragmentShader).toContain("uniform vec3 uTreeImpostorSunDirection");
    expect(material.fragmentShader).toContain("gl_FrontFacing");
    expect(material.fragmentShader).not.toContain("normalize(vec3(0.4, 0.85, 0.3))");
  });

  it("updates classic impostor uniforms without rebuilding the material", () => {
    const material = createLiveTreeImpostorMaterial(
      cloneTreeSettings(),
      atlas(true),
      { webgpu: false, viewBlend: true },
      lighting(0.1),
    ) as THREE.ShaderMaterial;
    const next = lighting(0.8);

    expect(updateLiveTreeImpostorMaterialLighting(material, next)).toBe(true);
    expect(material.uniforms.uTreeImpostorSunDirection.value).toEqual(next.sunDirection.clone().normalize());
    expect(material.uniforms.uTreeImpostorSunColor.value).toEqual(next.sunColor);
    expect(material.uniforms.uTreeImpostorSkyColor.value).toEqual(next.skyLight);
    expect(material.uniforms.uTreeImpostorGroundColor.value).toEqual(next.groundLight);
    expect(material.uniforms.uTreeImpostorAmbientFloor.value).toBe(next.ambientFloor);
  });

  it("relights classic fallback atlases that have no captured normal map", () => {
    const material = createLiveTreeImpostorMaterial(
      cloneTreeSettings(),
      atlas(false),
      { webgpu: false, viewBlend: false },
      lighting(0.4),
    ) as THREE.ShaderMaterial;

    expect(material.uniforms.hasNormalDepthMap.value).toBe(0);
    expect(material.fragmentShader).toContain("vec3 packedNormal = vec3(0.5, 0.5, 1.0)");
    expect(material.fragmentShader).toContain("hasNormalDepthMap);");
  });

  it("adds live uniforms to WebGPU single and blended materials", () => {
    for (const viewBlend of [false, true]) {
      const material = createLiveTreeImpostorMaterial(
        cloneTreeSettings(),
        atlas(true),
        { webgpu: true, viewBlend },
        lighting(0.3),
      ) as THREE.Material & { colorNode?: unknown; normalNode?: unknown };

      expect(material.colorNode).toBeDefined();
      expect(material.normalNode).toBeDefined();
      expect(updateLiveTreeImpostorMaterialLighting(material, lighting(0.7))).toBe(true);
    }
  });

  it("ignores materials that do not own the live-lighting contract", () => {
    expect(updateLiveTreeImpostorMaterialLighting(new THREE.MeshBasicMaterial(), lighting(0.5))).toBe(false);
  });
});

function lighting(value: number): EnvironmentLighting {
  return {
    sunDirection: new THREE.Vector3(value + 0.1, value + 0.5, value + 0.2),
    sunColor: new THREE.Color(value + 0.2, value + 0.1, value),
    skyLight: new THREE.Color(value, value + 0.1, value + 0.2),
    groundLight: new THREE.Color(value * 0.5, value * 0.4, value * 0.3),
    ambientFloor: value * 0.1,
  };
}

function atlas(withNormal: boolean): TreeImpostorAtlas {
  const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const normalDepth = withNormal
    ? new THREE.DataTexture(new Uint8Array([128, 255, 128, 255]), 1, 1)
    : undefined;
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
      normalDepth?.dispose();
    },
  };
}
