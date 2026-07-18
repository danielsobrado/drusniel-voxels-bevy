import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import { cloneTreeSettings, type TreeSpeciesId } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import {
  updateTreeSystemImpostorMaterial,
  updateTreeSystemImpostorMaterialsLighting,
} from "./tree_system_impostor_resources.js";

describe("tree system impostor lighting lifecycle", () => {
  it("creates a cached material with the current lighting", () => {
    const materials: Partial<Record<TreeSpeciesId, THREE.Material>> = {};
    const current = lighting(0.25);
    const material = updateTreeSystemImpostorMaterial({
      species: "oak",
      settings: cloneTreeSettings(),
      atlas: fakeAtlas(),
      webgpu: false,
      lighting: current,
      viewBlend: true,
      viewBlendGeometryReady: true,
      impostorMaterials: materials,
    }) as THREE.ShaderMaterial;

    expect(material.uniforms.uTreeImpostorSunColor.value).toEqual(current.sunColor);
    expect(materials).toEqual({ oak: material });
  });

  it("updates every cached species material in place", () => {
    const settings = cloneTreeSettings();
    const materials: Partial<Record<TreeSpeciesId, THREE.Material>> = {};
    const oak = updateTreeSystemImpostorMaterial({
      species: "oak",
      settings,
      atlas: fakeAtlas("oak"),
      webgpu: false,
      impostorMaterials: materials,
    }) as THREE.ShaderMaterial;
    const pine = updateTreeSystemImpostorMaterial({
      species: "pine",
      settings,
      atlas: fakeAtlas("pine"),
      webgpu: false,
      impostorMaterials: materials,
    }) as THREE.ShaderMaterial;
    const next = lighting(0.75);

    updateTreeSystemImpostorMaterialsLighting(materials, next);

    expect(materials.oak).toBe(oak);
    expect(materials.pine).toBe(pine);
    expect(oak.uniforms.uTreeImpostorSkyColor.value).toEqual(next.skyLight);
    expect(pine.uniforms.uTreeImpostorGroundColor.value).toEqual(next.groundLight);
  });
});

function lighting(value: number): EnvironmentLighting {
  return {
    sunDirection: new THREE.Vector3(value + 0.1, value + 0.7, value + 0.2),
    sunColor: new THREE.Color(value + 0.2, value + 0.1, value),
    skyLight: new THREE.Color(value, value + 0.1, value + 0.2),
    groundLight: new THREE.Color(value * 0.5, value * 0.4, value * 0.3),
    ambientFloor: value * 0.1,
  };
}

function fakeAtlas(species: "oak" | "pine" = "oak"): TreeImpostorAtlas {
  const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const normalDepth = new THREE.DataTexture(new Uint8Array([128, 255, 128, 255]), 1, 1);
  return {
    species,
    texture: albedo,
    albedo,
    normalDepth,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: [],
    ready: true,
    dispose() {
      albedo.dispose();
      normalDepth.dispose();
    },
  };
}
