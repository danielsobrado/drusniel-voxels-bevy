import * as THREE from "three";
import type { GrassLighting, GrassSettings, GrassShaderMode, GrassTier } from "./grass_config.js";
import type { GrassRingInstanceBuffers } from "./grass_gpu_ring.js";
import { grassFadeDistance } from "./grass_math.js";
import { grassShaderDefinition } from "./grass_geometry_shaders.js";
import { trackedShaderMaterial } from "../rendering/material_churn/tracked_material_factory.js";

export type { GrassShaderDefinition } from "./grass_geometry_shaders.js";
export { grassShaderDefinition } from "./grass_geometry_shaders.js";
export { createBladeGeometry, createGrassTuftGeometry, createGrassBladeClumpGeometry, createGrassClumpGeometry, populateGrassGeometry } from "./grass_geometry_primitives.js";

export interface GrassGeometryOptions {
  mode: GrassShaderMode;
  tier: GrassTier;
  crossed?: boolean;
  settings?: GrassSettings;
}

export type GrassGeometryBuilder = (
  instances: readonly import("./grass_cpu_patch.js").GrassBladeInstance[],
  options: GrassGeometryOptions,
) => THREE.InstancedBufferGeometry;

export interface GrassMaterialHandle {
  material: THREE.Material;
  setTime?(timeSeconds: number): void;
  setFadeCenter?(x: number, z: number): void;
  updateSettings?(settings: GrassSettings): void;
  updateLighting?(lighting: GrassLighting): void;
  dispose?(): void;
}

export type GrassMaterialFactory = (
  settings: GrassSettings,
  lighting: GrassLighting,
  ringInstanceBuffers?: GrassRingInstanceBuffers,
) => GrassMaterialHandle;

export function createGrassMaterial(
  settings: GrassSettings,
  lighting: GrassLighting,
  shaderMode: GrassShaderMode,
): THREE.ShaderMaterial {
  const shader = grassShaderDefinition(shaderMode);
  const useAlphaToCoverage = shader.patchStyle === "terrain-patch" && settings.alphaToCoverage;
  return trackedShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBladeWidth: { value: settings.bladeWidth },
      uWindDirection: { value: new THREE.Vector2(settings.wind.direction[0], settings.wind.direction[1]) },
      uWindStrength: { value: settings.windStrength },
      uWindSpeed: { value: settings.windSpeed },
      uNearDistance: { value: settings.distance * settings.lod.nearFraction },
      uMidDistance: { value: settings.distance * settings.lod.midFraction },
      uFadeDistance: { value: grassFadeDistance(settings) },
      uLight: { value: lighting.light.clone() },
      uSunColor: { value: lighting.sunColor.clone() },
      uSkyLight: { value: lighting.skyLight.clone() },
      uGroundLight: { value: lighting.groundLight.clone() },
      uAlphaToCoverage: { value: useAlphaToCoverage ? 1 : 0 },
    },
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    alphaToCoverage: useAlphaToCoverage,
    toneMapped: true,
  }, `grass-shader-material:${shaderMode}`);
}

export function cloneLighting(lighting: GrassLighting): GrassLighting {
  return {
    light: lighting.light.clone(),
    sunColor: lighting.sunColor.clone(),
    skyLight: lighting.skyLight.clone(),
    groundLight: lighting.groundLight.clone(),
  };
}
