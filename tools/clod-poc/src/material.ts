// Terrain page material. Runtime LOD swaps use complementary screen-door masks.
// Terrain meshes carry WORLD-space normals, so lighting uses them directly (no normalMatrix).

import * as THREE from "three";
import {
  applyTerrainTextureUniforms,
  buildTerrainFragmentShader,
  createTerrainTextureUniforms,
  type TerrainTextureSlotUniform,
} from "./terrain_shader.js";

export interface TerrainColorAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}

export const DEFAULT_TERRAIN_COLOR_ADJUSTMENTS: TerrainColorAdjustments = {
  brightness: 1.0,
  contrast: 1.0,
  saturation: 1.0,
  warmth: 0.0,
};

export type { TerrainTextureSlotUniform };

const VERT = /* glsl */ `
  attribute vec4 paintSlots;
  attribute vec4 paintWeights;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vPaintSlots;
  varying vec4 vPaintWeights;
  void main() {
    vWorldPos = position;
    vWorldNormal = normal;
    vPaintSlots = paintSlots;
    vPaintWeights = paintWeights;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function createTerrainMaterial(color: number): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: createTerrainTextureUniforms(),
    vertexShader: VERT,
    fragmentShader: buildTerrainFragmentShader(),
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  material.uniforms.uColor.value = new THREE.Color(color);
  return material;
}

export function applyTerrainColorAdjustments(
  material: THREE.ShaderMaterial,
  adjustments: TerrainColorAdjustments,
): void {
  material.uniforms.uBrightness.value = adjustments.brightness;
  material.uniforms.uContrast.value = adjustments.contrast;
  material.uniforms.uSaturation.value = adjustments.saturation;
  material.uniforms.uWarmth.value = adjustments.warmth;
}

export { applyTerrainTextureUniforms };
