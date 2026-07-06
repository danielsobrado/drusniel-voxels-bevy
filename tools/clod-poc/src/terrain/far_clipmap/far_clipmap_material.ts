import * as THREE from "three";
import type { FarClipmapDebugMode } from "./far_clipmap_config.js";

const FAR_CLIPMAP_DEBUG_MODE_CODES: Record<FarClipmapDebugMode, number> = Object.freeze({
  final: 0,
  biome: 1,
  height: 2,
  ownership: 3,
});

const FAR_CLIPMAP_SHADER_RENDER_ORDER = 20;

export interface FarClipmapMaterialUniforms {
  uSeaLevel: THREE.IUniform<number>;
  uDebugMode: THREE.IUniform<number>;
  uClipInnerRadius: THREE.IUniform<number>;
  uClipOuterRadius: THREE.IUniform<number>;
  uCameraXZ: THREE.IUniform<THREE.Vector2>;
}

export type FarClipmapMaterial = THREE.ShaderMaterial & { uniforms: FarClipmapMaterialUniforms };

const VERTEX_SHADER = `
attribute vec3 color;

uniform vec2 uCameraXZ;

varying vec2 vWorldXZ;
varying vec3 vWorldNormal;
varying vec3 vVertexColor;
varying float vHeight;
varying float vDistance;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldXZ = worldPosition.xz;
  vHeight = worldPosition.y;
  vDistance = length(vWorldXZ - uCameraXZ);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vVertexColor = color;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float uSeaLevel;
uniform int uDebugMode;
uniform float uClipInnerRadius;
uniform float uClipOuterRadius;

varying vec2 vWorldXZ;
varying vec3 vWorldNormal;
varying vec3 vVertexColor;
varying float vHeight;
varying float vDistance;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

vec3 tonemapFarTerrain(vec3 color) {
  return pow(max(color, vec3(0.0)), vec3(0.92));
}

void main() {
  if (vDistance < uClipInnerRadius || vDistance > uClipOuterRadius) discard;

  vec3 normal = normalize(vWorldNormal);
  vec3 sunDir = normalize(vec3(0.38, 0.82, 0.34));
  float directLight = saturate(dot(normal, sunDir));
  float ambientLight = 0.34 + 0.24 * saturate(normal.y);
  float slope = 1.0 - saturate(normal.y);
  float elevation = saturate((vHeight + 48.0) / 220.0);

  vec3 baseColor = vVertexColor;
  vec3 rockTint = vec3(0.44, 0.43, 0.38);
  vec3 highlandTint = vec3(0.42, 0.46, 0.33);
  vec3 shadedColor = mix(baseColor, rockTint, slope * 0.42);
  shadedColor = mix(shadedColor, highlandTint, elevation * 0.18);
  shadedColor *= ambientLight + directLight * 0.78;

  if (vHeight <= uSeaLevel + 0.25) {
    float waterDepthHint = saturate((uSeaLevel + 16.0 - vHeight) / 32.0);
    vec3 waterColor = mix(vec3(0.06, 0.16, 0.23), vec3(0.10, 0.28, 0.38), 1.0 - waterDepthHint);
    shadedColor = mix(shadedColor, waterColor, 0.72);
  }

  float horizonFog = smoothstep(uClipOuterRadius * 0.55, uClipOuterRadius, vDistance);
  shadedColor = mix(shadedColor, vec3(0.46, 0.52, 0.50), horizonFog * 0.36);

  if (uDebugMode == 1) {
    shadedColor = vVertexColor;
  } else if (uDebugMode == 2) {
    shadedColor = vec3(saturate((vHeight + 64.0) / 256.0));
  } else if (uDebugMode == 3) {
    float ringEdge = min(abs(vDistance - uClipInnerRadius), abs(vDistance - uClipOuterRadius));
    float edgeLine = 1.0 - smoothstep(0.0, 16.0, ringEdge);
    shadedColor = mix(vec3(0.05, 0.35, 0.95), vec3(1.0, 0.82, 0.18), edgeLine);
  }

  gl_FragColor = vec4(tonemapFarTerrain(shadedColor), 1.0);
}
`;

export function farClipmapDebugModeCode(mode: FarClipmapDebugMode): number {
  return FAR_CLIPMAP_DEBUG_MODE_CODES[mode];
}

export function farClipmapShaderRenderOrder(): number {
  return FAR_CLIPMAP_SHADER_RENDER_ORDER;
}

export function createFarClipmapMaterial(input: {
  debugMode: FarClipmapDebugMode;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  cameraX?: number;
  cameraZ?: number;
}): FarClipmapMaterial {
  return new THREE.ShaderMaterial({
    name: "FarClipmapTerrainShader",
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uSeaLevel: { value: input.seaLevel ?? 0 },
      uDebugMode: { value: farClipmapDebugModeCode(input.debugMode) },
      uClipInnerRadius: { value: input.clipInnerRadiusM },
      uClipOuterRadius: { value: input.clipOuterRadiusM },
      uCameraXZ: { value: new THREE.Vector2(input.cameraX ?? 0, input.cameraZ ?? 0) },
    },
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    transparent: false,
    side: THREE.FrontSide,
  }) as FarClipmapMaterial;
}

export function setFarClipmapMaterialDebugMode(material: FarClipmapMaterial, mode: FarClipmapDebugMode): void {
  material.uniforms.uDebugMode.value = farClipmapDebugModeCode(mode);
}

export function updateFarClipmapMaterialFrameUniforms(material: FarClipmapMaterial, input: {
  cameraX: number;
  cameraZ: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
}): void {
  material.uniforms.uCameraXZ.value.set(input.cameraX, input.cameraZ);
  material.uniforms.uClipInnerRadius.value = input.clipInnerRadiusM;
  material.uniforms.uClipOuterRadius.value = input.clipOuterRadiusM;
}
