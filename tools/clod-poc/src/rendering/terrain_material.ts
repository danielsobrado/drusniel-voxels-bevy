// A backend-agnostic handle over the terrain material: the app drives terrain state through
// one setter interface instead of poking `ShaderMaterial.uniforms.*` directly, so the app can
// swap WebGLRenderer(ShaderMaterial) <-> WebGPURenderer(NodeMaterial) per surface.
//
// This file is the WebGL implementation. It is a thin pass-through: every setter performs the
// exact same uniform write / helper call the app did inline, so behaviour is unchanged.

import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import {
  applyTerrainColorAdjustments,
  applyTerrainTextureUniforms,
  createTerrainMaterial,
  type TerrainColorAdjustments,
  type TerrainTextureSlotUniform,
} from "../material/material.js";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "./material_churn/material_churn_diagnostics.js";

export type TerrainArraySamplingMode = "off" | "planar" | "triplanar";

type BaseTerrainTextureApplyOptions = Parameters<typeof applyTerrainTextureUniforms>[2];

export type TerrainTextureApplyOptions = BaseTerrainTextureApplyOptions & {
  arraySampling?: TerrainArraySamplingMode;
  bakedMacroTint?: THREE.Texture | null;
  riverWetnessMask?: THREE.Texture | null;
  worldSize?: number;
  biomeSplat?: boolean;
};

export interface TerrainDebugState {
  normalColor: boolean;
  normalDivergence: boolean;
  divergenceGain: number;
}

export interface TerrainMaterialHandle {
  /** The underlying material to attach to a mesh. */
  readonly material: THREE.Material;
  /** Subscribe to material-object swaps (WebGPU rebuilds); returns an unsubscribe fn. */
  onMaterialChanged(callback: (material: THREE.Material) => void): () => void;
  setBaseColor(color: THREE.ColorRepresentation): void;
  setColorAdjust(adjust: TerrainColorAdjustments): void;
  setLighting(lighting: EnvironmentLighting): void;
  setTextures(slots: readonly TerrainTextureSlotUniform[], options: TerrainTextureApplyOptions): void;
  setDebug(state: TerrainDebugState): void;
  setTriplanar(on: boolean): void;
  setSide(side: THREE.Side): void;
  setWireframe(on: boolean): void;
  setFade(fade: number, fadeIn: boolean, dither: boolean): void;
  setRootMorph(influence: number): void;
  /**
   * LV-6: Set material quality tier.
   * 0 = near (full triplanar + procedural), 1 = mid (simplified), 2 = far (baked + single-proj).
   * No-op on WebGL path (uniform not present).
   */
  setTier(tier: number): void;
}

export function createWebGlTerrainMaterial(color: number): TerrainMaterialHandle {
  const material = createTerrainMaterial(color);
  materialChurnDiagnostics.trackNewMaterial(material, "webgl-terrain-material");
  const u = material.uniforms;
  return {
    material,
    onMaterialChanged() {
      // WebGL mutates one ShaderMaterial in place; the material reference never changes.
      return () => {};
    },
    setBaseColor(c) {
      (u.uColor.value as THREE.Color).set(c);
    },
    setColorAdjust(adjust) {
      applyTerrainColorAdjustments(material, adjust);
    },
    setLighting(lighting) {
      (u.uLight.value as THREE.Vector3).copy(lighting.sunDirection);
      (u.uSunColor.value as THREE.Color).copy(lighting.sunColor);
      (u.uSkyLight.value as THREE.Color).copy(lighting.skyLight);
      (u.uGroundLight.value as THREE.Color).copy(lighting.groundLight);
    },
    setTextures(slots, options) {
      applyTerrainTextureUniforms(material, slots, options);
    },
    setDebug(state) {
      u.uNormalColor.value = state.normalColor;
      u.uNormalDivergence.value = state.normalDivergence;
      u.uDivergenceGain.value = state.divergenceGain;
    },
    setTriplanar(on) {
      u.uUseTriplanar.value = on;
    },
    setSide(side) {
      if (setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "side", side, "webgl-terrain-side")) {
        setMaterialNeedsUpdate(materialChurnDiagnostics, material, "webgl-terrain-side");
      }
    },
    setWireframe(on) {
      setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "wireframe", on, "webgl-terrain-wireframe");
    },
    setFade(fade, fadeIn, dither) {
      u.uFade.value = fade;
      u.uFadeIn.value = fadeIn;
      u.uDither.value = dither;
    },
    setRootMorph() {
      // No-op on WebGL fallback; streamed-root transitions hard-switch outside WebGPU.
    },
    setTier() {
      // No-op on WebGL: no tier uniform in the classic ShaderMaterial.
    },
  };
}
