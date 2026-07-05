import * as THREE from "three";
import type { FarClipmapDebugMode } from "./far_clipmap_config.js";

const FAR_CLIPMAP_DEBUG_MODE_CODES: Record<FarClipmapDebugMode, number> = Object.freeze({
  final: 0,
  biome: 1,
  height: 2,
  ownership: 3,
});

export interface FarClipmapMaterialUniforms {
  uRingOrigin: THREE.IUniform<THREE.Vector2>;
  uCellSize: THREE.IUniform<number>;
  uHeightScale: THREE.IUniform<number>;
  uYOffset: THREE.IUniform<number>;
  uSeaLevel: THREE.IUniform<number>;
  uDebugMode: THREE.IUniform<number>;
  uClipInnerRadius: THREE.IUniform<number>;
  uClipOuterRadius: THREE.IUniform<number>;
  uCameraXZ: THREE.IUniform<THREE.Vector2>;
}

export type FarClipmapMaterial = THREE.ShaderMaterial & { uniforms: FarClipmapMaterialUniforms };

const VERTEX_SHADER = `
uniform vec2 uRingOrigin;
uniform float uCellSize;
uniform float uHeightScale;
uniform float uYOffset;
uniform vec2 uCameraXZ;

varying vec2 vWorldXZ;
varying float vHeight;
varying float vDistance;

float farClipmapHeight(vec2 worldXZ) {
  return 0.0;
}

void main() {
  vec4 worldFlat = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);
  vec2 worldXZ = worldFlat.xz;
  float height = farClipmapHeight(worldXZ) * uHeightScale + uYOffset;
  vWorldXZ = worldXZ;
  vHeight = height;
  vDistance = length(worldXZ - uCameraXZ);
  gl_Position = projectionMatrix * viewMatrix * vec4(worldXZ.x, height, worldXZ.y, 1.0);
}
`;

const FRAGMENT_SHADER = `
uniform float uCellSize;
uniform float uSeaLevel;
uniform int uDebugMode;
uniform float uClipInnerRadius;
uniform float uClipOuterRadius;
uniform vec2 uCameraXZ;

varying vec2 vWorldXZ;
varying float vHeight;
varying float vDistance;

float farClipmapHeight(vec2 worldXZ) {
  return 0.0;
}

vec3 farClipmapNormal(vec2 worldXZ) {
  float hL = farClipmapHeight(worldXZ - vec2(uCellSize, 0.0));
  float hR = farClipmapHeight(worldXZ + vec2(uCellSize, 0.0));
  float hD = farClipmapHeight(worldXZ - vec2(0.0, uCellSize));
  float hU = farClipmapHeight(worldXZ + vec2(0.0, uCellSize));
  return normalize(vec3(hL - hR, 2.0 * uCellSize, hD - hU));
}

void main() {
  if (vDistance < uClipInnerRadius || vDistance > uClipOuterRadius) discard;

  vec3 normal = farClipmapNormal(vWorldXZ);
  float light = clamp(dot(normal, normalize(vec3(0.35, 0.85, 0.25))), 0.25, 1.0);
  vec3 finalColor = mix(vec3(0.18, 0.24, 0.16), vec3(0.34, 0.40, 0.24), light);

  if (vHeight <= uSeaLevel) {
    finalColor = mix(finalColor, vec3(0.08, 0.18, 0.27), 0.55);
  }

  if (uDebugMode == 1) {
    finalColor = vec3(fract(vWorldXZ.x / 256.0), 0.45, fract(vWorldXZ.y / 256.0));
  } else if (uDebugMode == 2) {
    finalColor = vec3(clamp((vHeight + 64.0) / 256.0, 0.0, 1.0));
  } else if (uDebugMode == 3) {
    finalColor = vec3(0.18, 0.58, 0.95);
  }

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export function farClipmapDebugModeCode(mode: FarClipmapDebugMode): number {
  return FAR_CLIPMAP_DEBUG_MODE_CODES[mode];
}

export function createFarClipmapMaterial(input: {
  debugMode: FarClipmapDebugMode;
  cellSizeM: number;
  heightScale: number;
  yOffset: number;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  cameraX?: number;
  cameraZ?: number;
}): FarClipmapMaterial {
  return new THREE.ShaderMaterial({
    name: "FarClipmapMaterial",
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uRingOrigin: { value: new THREE.Vector2(0, 0) },
      uCellSize: { value: input.cellSizeM },
      uHeightScale: { value: input.heightScale },
      uYOffset: { value: input.yOffset },
      uSeaLevel: { value: input.seaLevel ?? 0 },
      uDebugMode: { value: farClipmapDebugModeCode(input.debugMode) },
      uClipInnerRadius: { value: input.clipInnerRadiusM },
      uClipOuterRadius: { value: input.clipOuterRadiusM },
      uCameraXZ: { value: new THREE.Vector2(input.cameraX ?? 0, input.cameraZ ?? 0) },
    },
    depthWrite: true,
    depthTest: true,
    transparent: false,
    side: THREE.FrontSide,
  }) as FarClipmapMaterial;
}

export function setFarClipmapMaterialDebugMode(material: FarClipmapMaterial, mode: FarClipmapDebugMode): void {
  material.uniforms.uDebugMode.value = farClipmapDebugModeCode(mode);
}

export function updateFarClipmapMaterialFrameUniforms(material: FarClipmapMaterial, input: {
  ringOriginX: number;
  ringOriginZ: number;
  cameraX: number;
  cameraZ: number;
  cellSizeM: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
}): void {
  material.uniforms.uRingOrigin.value.set(input.ringOriginX, input.ringOriginZ);
  material.uniforms.uCameraXZ.value.set(input.cameraX, input.cameraZ);
  material.uniforms.uCellSize.value = input.cellSizeM;
  material.uniforms.uClipInnerRadius.value = input.clipInnerRadiusM;
  material.uniforms.uClipOuterRadius.value = input.clipOuterRadiusM;
}
