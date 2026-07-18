import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneForestLightingSettings, type ForestLightingMaterialState } from "../forest_lighting/index.js";
import { cloneTreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import { updateTreeImpostorMaterialForestLighting } from "./tree_impostor_forest_lighting.js";
import { createSelectedTreeImpostorMaterial } from "./tree_impostor_material_selector.js";

describe("tree impostor forest-lighting resource lifecycle", () => {
  it("restores neutral bindings before an external forest field is disposed", () => {
    const material = createSelectedTreeImpostorMaterial(
      cloneTreeSettings(),
      fakeAtlas(),
      { webgpu: false, viewBlend: false },
    ) as THREE.ShaderMaterial;
    const neutralPacked = material.uniforms.uForestLightingMap.value as THREE.Texture;
    const neutralAux = material.uniforms.uForestLightingAuxMap.value as THREE.Texture;
    const state = forestState();

    expect(updateTreeImpostorMaterialForestLighting(material, state)).toBe(true);
    expect(material.uniforms.uForestLightingMap.value).toBe(state.textureHandle.texture);
    expect(material.uniforms.uForestLightingAuxMap.value).toBe(state.textureHandle.auxTexture);

    expect(updateTreeImpostorMaterialForestLighting(material, null)).toBe(true);
    expect(material.uniforms.uForestLightingMap.value).toBe(neutralPacked);
    expect(material.uniforms.uForestLightingAuxMap.value).toBe(neutralAux);
    expect(material.uniforms.uForestLightingEnabled.value).toBe(0);
    expect(material.uniforms.uForestLightingWorldSize.value).toBe(1);
    expect(material.uniforms.uForestDebugMode.value).toBe(0);

    state.textureHandle.dispose();
    expect(material.uniforms.uForestLightingMap.value).not.toBe(state.textureHandle.texture);
    expect(material.uniforms.uForestLightingAuxMap.value).not.toBe(state.textureHandle.auxTexture);
    material.dispose();
  });

  it("releases neutral textures exactly once across repeated disposal", () => {
    const material = createSelectedTreeImpostorMaterial(
      cloneTreeSettings(),
      fakeAtlas(),
      { webgpu: false, viewBlend: true },
    ) as THREE.ShaderMaterial;
    const neutralPacked = material.uniforms.uForestLightingMap.value as THREE.Texture;
    const neutralAux = material.uniforms.uForestLightingAuxMap.value as THREE.Texture;
    const packedDispose = vi.spyOn(neutralPacked, "dispose");
    const auxDispose = vi.spyOn(neutralAux, "dispose");

    material.dispose();
    material.dispose();

    expect(packedDispose).toHaveBeenCalledTimes(1);
    expect(auxDispose).toHaveBeenCalledTimes(1);
    expect(updateTreeImpostorMaterialForestLighting(material, null)).toBe(false);
  });
});

function forestState(): ForestLightingMaterialState {
  const settings = cloneForestLightingSettings();
  settings.enabled = true;
  settings.materialIntegration.treeEnabled = true;
  settings.materialIntegration.debugMode = "combined";
  const texture = dataTexture([32, 64, 96, 128]);
  const auxTexture = dataTexture([160, 192, 224, 255]);
  return {
    settings,
    worldCells: 4096,
    textureHandle: {
      texture,
      auxTexture,
      update() {},
      dispose() {
        texture.dispose();
        auxTexture.dispose();
      },
    },
  };
}

function fakeAtlas(): TreeImpostorAtlas {
  const albedo = dataTexture([255, 255, 255, 255]);
  const normalDepth = dataTexture([128, 255, 128, 255]);
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

function dataTexture(rgba: [number, number, number, number]): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array(rgba),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.needsUpdate = true;
  return texture;
}
