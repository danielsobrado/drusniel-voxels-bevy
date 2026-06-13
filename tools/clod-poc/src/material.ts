// Dithered (screen-door) crossfade material. Plan §4.2.
//
// Topology-changing decimation can't geomorph cheaply, so the PoC crossfades with a
// screen-door dither over `crossfade_frames` when the cut changes. Our terrain meshes
// carry WORLD-space normals, so lighting uses them directly (no normalMatrix).

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
  attribute float paintSlot;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vPaintSlot;
  void main() {
    vWorldPos = position;
    vWorldNormal = normal;
    vPaintSlot = paintSlot;
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
