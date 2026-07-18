import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneForestLightingSettings,
  type ForestLightingMaterialState,
} from "../forest_lighting/index.js";
import { cloneTreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import {
  TREE_IMPOSTOR_FOREST_LIGHTING_KEY,
  updateTreeImpostorMaterialForestLighting,
} from "./tree_impostor_forest_lighting.js";
import { createSelectedTreeImpostorMaterial } from "./tree_impostor_material_selector.js";
import { TreeSystemAssets } from "./tree_system_assets_runtime.js";

describe("tree impostor forest lighting", () => {
  it("injects the canonical forest field into classic single and blended impostors", () => {
    const state = forestState("combined");
    for (const viewBlend of [false, true]) {
      const material = createSelectedTreeImpostorMaterial(
        cloneTreeSettings(),
        fakeAtlas(),
        { webgpu: false, viewBlend },
        undefined,
        state,
      ) as THREE.ShaderMaterial;

      expect(material.vertexShader).toContain("vTreeImpostorForestWorldXZ = treeWorldXZ");
      expect(material.fragmentShader).toContain("applyTreeImpostorForestLighting");
      expect(material.fragmentShader).toContain("uForestLightingAuxMap");
      expect(material.fragmentShader).toContain("max(forestFog, forestAux.g)");
      expect(material.uniforms.uForestLightingMap.value).toBe(state.textureHandle.texture);
      expect(material.uniforms.uForestLightingAuxMap.value).toBe(state.textureHandle.auxTexture);
      expect(material.uniforms.uForestLightingEnabled.value).toBe(1);
      expect(material.uniforms.uForestAoStrength.value).toBe(state.settings.ambientOcclusion.strength);
      expect(material.uniforms.uForestShadowStrength.value).toBe(state.settings.shadowProxy.strength);
      expect(material.uniforms.uForestDebugMode.value).toBe(6);
      material.dispose();
    }
    state.textureHandle.dispose();
  });

  it("updates classic forest uniforms in place and disables them with null state", () => {
    const material = createSelectedTreeImpostorMaterial(
      cloneTreeSettings(),
      fakeAtlas(),
      { webgpu: false, viewBlend: false },
    ) as THREE.ShaderMaterial;
    const state = forestState("ao");

    expect(material.uniforms.uForestLightingEnabled.value).toBe(0);
    expect(updateTreeImpostorMaterialForestLighting(material, state)).toBe(true);
    expect(material.uniforms.uForestLightingEnabled.value).toBe(1);
    expect(material.uniforms.uForestLightingWorldSize.value).toBe(state.worldCells);
    expect(material.uniforms.uForestDebugMode.value).toBe(2);

    expect(updateTreeImpostorMaterialForestLighting(material, null)).toBe(true);
    expect(material.uniforms.uForestLightingEnabled.value).toBe(0);
    material.dispose();
    state.textureHandle.dispose();
  });

  it("decorates WebGPU single and blended impostors with a mutable forest contract", () => {
    const state = forestState("shadow");
    for (const viewBlend of [false, true]) {
      const material = createSelectedTreeImpostorMaterial(
        cloneTreeSettings(),
        fakeAtlas(),
        { webgpu: true, viewBlend },
        undefined,
        state,
      ) as THREE.Material & { colorNode?: unknown };

      expect(material.colorNode).toBeDefined();
      expect(material.userData[TREE_IMPOSTOR_FOREST_LIGHTING_KEY]).toBeDefined();
      expect(updateTreeImpostorMaterialForestLighting(material, null)).toBe(true);
      expect(updateTreeImpostorMaterialForestLighting(material, state)).toBe(true);
      material.dispose();
    }
    state.textureHandle.dispose();
  });

  it("applies an existing forest state when an atlas creates materials later", () => {
    const assets = new TreeSystemAssets({
      settings: cloneTreeSettings(),
      webgpu: false,
    });
    const state = forestState("canopy");
    try {
      assets.updateForestLighting(state);
      assets.setImpostorAtlases({ oak: fakeAtlas() });

      const material = assets.impostorMaterials.oak as THREE.ShaderMaterial;
      expect(material.uniforms.uForestLightingEnabled.value).toBe(1);
      expect(material.uniforms.uForestLightingMap.value).toBe(state.textureHandle.texture);
      expect(material.uniforms.uForestDebugMode.value).toBe(1);
    } finally {
      assets.dispose();
      state.textureHandle.dispose();
    }
  });

  it("updates cached asset materials without rebuilding them", () => {
    const assets = new TreeSystemAssets({
      settings: cloneTreeSettings(),
      webgpu: false,
      impostorAtlases: { oak: fakeAtlas() },
    });
    const state = forestState("sun_shafts");
    try {
      const material = assets.impostorMaterials.oak as THREE.ShaderMaterial;
      assets.updateForestLighting(state);

      expect(assets.impostorMaterials.oak).toBe(material);
      expect(material.uniforms.uForestLightingEnabled.value).toBe(1);
      expect(material.uniforms.uForestDebugMode.value).toBe(5);
      assets.updateForestLighting(null);
      expect(material.uniforms.uForestLightingEnabled.value).toBe(0);
    } finally {
      assets.dispose();
      state.textureHandle.dispose();
    }
  });
});

function forestState(
  debugMode: ForestLightingMaterialState["settings"]["materialIntegration"]["debugMode"],
): ForestLightingMaterialState {
  const settings = cloneForestLightingSettings();
  settings.enabled = true;
  settings.materialIntegration.treeEnabled = true;
  settings.materialIntegration.debugMode = debugMode;
  settings.ambientOcclusion.strength = 0.41;
  settings.shadowProxy.strength = 0.36;
  settings.atmosphere.aerialTintStrength = 0.28;
  const texture = dataTexture([64, 96, 128, 160]);
  const auxTexture = dataTexture([192, 224, 32, 255]);
  return {
    settings,
    worldCells: 2048,
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
