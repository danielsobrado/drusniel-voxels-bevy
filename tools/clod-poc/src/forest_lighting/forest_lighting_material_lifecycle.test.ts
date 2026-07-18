import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneForestLightingSettings } from "./forest_lighting_config.js";
import {
  createForestLightingUniforms,
  resetForestLightingUniforms,
  updateForestLightingUniforms,
  type ForestLightingMaterialState,
} from "./forest_lighting_material.js";

describe("forest lighting material lifecycle", () => {
  it("releases external texture references and restores defaults on null state", () => {
    const uniforms = createForestLightingUniforms();
    const state = forestState();

    updateForestLightingUniforms(uniforms, state, "tree");
    expect(uniforms.uForestLightingMap.value).toBe(state.textureHandle.texture);
    expect(uniforms.uForestLightingAuxMap.value).toBe(state.textureHandle.auxTexture);
    expect(uniforms.uForestLightingEnabled.value).toBe(1);

    updateForestLightingUniforms(uniforms, null, "tree");

    expect(uniforms.uForestLightingMap.value).toBeNull();
    expect(uniforms.uForestLightingAuxMap.value).toBeNull();
    expect(uniforms.uForestLightingEnabled.value).toBe(0);
    expect(uniforms.uForestLightingWorldSize.value).toBe(1);
    expect(uniforms.uForestAoStrength.value).toBe(1);
    expect(uniforms.uForestShadowStrength.value).toBe(1);
    expect(uniforms.uForestFogStrength.value).toBe(0);
    expect(uniforms.uForestDebugMode.value).toBe(0);
    expect(uniforms.uForestFogColor.value.getHex()).toBe(0x66716d);

    const packedDispose = vi.spyOn(state.textureHandle.texture, "dispose");
    const auxDispose = vi.spyOn(state.textureHandle.auxTexture, "dispose");
    state.textureHandle.dispose();
    expect(packedDispose).toHaveBeenCalledTimes(1);
    expect(auxDispose).toHaveBeenCalledTimes(1);
    expect(uniforms.uForestLightingMap.value).toBeNull();
    expect(uniforms.uForestLightingAuxMap.value).toBeNull();
  });

  it("resets every mutable uniform deterministically", () => {
    const uniforms = createForestLightingUniforms();
    uniforms.uForestLightingMap.value = new THREE.Texture();
    uniforms.uForestLightingAuxMap.value = new THREE.Texture();
    uniforms.uForestLightingEnabled.value = 1;
    uniforms.uForestLightingWorldSize.value = 4096;
    uniforms.uForestAoStrength.value = 0.3;
    uniforms.uForestShadowStrength.value = 0.4;
    uniforms.uForestFogStrength.value = 0.5;
    uniforms.uForestFogColor.value.set(0xff00ff);
    uniforms.uForestDebugMode.value = 6;

    resetForestLightingUniforms(uniforms);

    expect(uniforms).toMatchObject({
      uForestLightingMap: { value: null },
      uForestLightingAuxMap: { value: null },
      uForestLightingEnabled: { value: 0 },
      uForestLightingWorldSize: { value: 1 },
      uForestAoStrength: { value: 1 },
      uForestShadowStrength: { value: 1 },
      uForestFogStrength: { value: 0 },
      uForestDebugMode: { value: 0 },
    });
    expect(uniforms.uForestFogColor.value.getHex()).toBe(0x66716d);
  });

  it("still binds the field while a target is disabled but the state remains owned", () => {
    const uniforms = createForestLightingUniforms();
    const state = forestState();
    state.settings.materialIntegration.understoryEnabled = false;

    updateForestLightingUniforms(uniforms, state, "understory");

    expect(uniforms.uForestLightingEnabled.value).toBe(0);
    expect(uniforms.uForestLightingMap.value).toBe(state.textureHandle.texture);
    expect(uniforms.uForestLightingAuxMap.value).toBe(state.textureHandle.auxTexture);
    state.textureHandle.dispose();
  });
});

function forestState(): ForestLightingMaterialState {
  const settings = cloneForestLightingSettings();
  settings.enabled = true;
  settings.materialIntegration.treeEnabled = true;
  settings.materialIntegration.understoryEnabled = true;
  settings.materialIntegration.debugMode = "combined";
  settings.ambientOcclusion.strength = 0.35;
  settings.shadowProxy.strength = 0.45;
  settings.atmosphere.aerialTintStrength = 0.55;
  const texture = dataTexture([16, 32, 48, 64]);
  const auxTexture = dataTexture([80, 96, 112, 128]);
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
