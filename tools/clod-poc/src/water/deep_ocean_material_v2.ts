import * as THREE from "three";
import { DEEP_OCEAN_GPU_WAVES } from "./deep_ocean_waves.js";
import type { DeepOceanShadingConfig, DeepOceanWaveConfig } from "../terrain/border_coast_config.js";
import type { WaterVisualConfig } from "./waterConfig.js";

export interface DeepOceanMaterialParams {
  visual: WaterVisualConfig;
  wave: DeepOceanWaveConfig;
  shading: DeepOceanShadingConfig;
  surfaceY: number;
  fogDistanceM: number;
  sunDirection: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  horizonColor?: THREE.Color;
}

export interface DeepOceanMaterialHandle {
  material: THREE.Material;
  setTime(t: number): void;
  updateCamera(pos: THREE.Vector3): void;
  updateSunDirection(dir: THREE.Vector3): void;
  updateHorizonColor(color: THREE.Color): void;
  updateVisual(visual: WaterVisualConfig): void;
  dispose(): void;
}

const GPU_WAVE_COUNT = DEEP_OCEAN_GPU_WAVES.length;

const VERT = /* glsl */ `
#define WAVE_COUNT ${GPU_WAVE_COUNT}
uniform float uTime;
uniform vec4 uWaveA[WAVE_COUNT];
uniform vec4 uWaveB[WAVE_COUNT];
varying vec3 vWorldPos;
varying vec2 vSlope;
varying float vCompression;
void main() {
  vec3 p = position;
  float y = 0.0;
  float ox = 0.0;
  float oz = 0.0;
  float sx = 0.0;
  float sz = 0.0;
  float jxx = 0.0;
  float jzz = 0.0;
  float jxz = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float theta = a.z * (a.x * position.x + a.y * position.z) - a.w * uTime + b.y;
    float c = cos(theta);
    float s = sin(theta);
    ox -= b.x * a.x * s * b.z;
    oz -= b.x * a.y * s * b.z;
    y += b.x * c;
    sx -= b.x * a.z * a.x * s;
    sz -= b.x * a.z * a.y * s;
    jxx -= b.x * a.z * a.x * a.x * c * b.z;
    jzz -= b.x * a.z * a.y * a.y * c * b.z;
    jxz -= b.x * a.z * a.x * a.y * c * b.z;
  }
  p += vec3(ox, y, oz);
  float jacobian = (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
  vCompression = clamp((0.58 - jacobian) / 0.58, 0.0, 1.0);
  vSlope = vec2(sx, sz);
  vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uSurfaceY;
uniform float uFoamThreshold;
uniform float uFoamPower;
uniform float uFoamIntensity;
uniform float uFresnelPower;
uniform float uFresnelStrength;
uniform float uReflectionStrength;
uniform float uReflectionDistortion;
uniform float uRoughness;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogDensity;
uniform float uDetailStrength;
uniform float uDetailFadeStart;
uniform float uDetailFadeEnd;
uniform float uSssStrength;
uniform float uHorizonStart;
uniform float uHorizonEnd;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFoamColor;
uniform vec3 uFogColor;
uniform vec3 uSkyZenithColor;
uniform vec3 uSssColor;
varying vec3 vWorldPos;
varying vec2 vSlope;
varying float vCompression;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 3; i++) { v += noise2(p) * a; p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(17.0, 9.0); a *= 0.5; }
  return v;
}
vec3 skyReflection(vec3 reflectDir, vec3 sunDir) {
  float reflY = max(reflectDir.y, 0.0);
  float sunDot = max(dot(reflectDir, sunDir), 0.0);
  vec3 sky = mix(uFogColor, uSkyZenithColor, smoothstep(0.0, 0.6, reflY));
  vec3 sunGlow = vec3(1.0, 0.92, 0.75) * (pow(sunDot, 96.0) * 1.2 + pow(sunDot, 8.0) * 0.18);
  return sky + sunGlow;
}
void main() {
  vec3 worldPos = vWorldPos;
  float dist = length(uCameraPos - worldPos);
  float detailFade = 1.0 - smoothstep(uDetailFadeStart, uDetailFadeEnd, dist);
  vec2 uv = worldPos.xz * 0.14 + vec2(uTime * 0.04, -uTime * 0.025);
  float h = fbm3(uv);
  vec2 detail = vec2(fbm3(uv + vec2(0.35, 0.0)) - h, fbm3(uv + vec2(0.0, 0.35)) - h) * uDetailStrength * detailFade;
  vec3 normal = normalize(vec3(-vSlope.x - detail.x, 1.0, -vSlope.y - detail.y));
  vec3 viewDir = normalize(uCameraPos - worldPos);
  vec3 sunDir = normalize(uSunDir);
  float ndotv = max(dot(viewDir, normal), 0.05);
  float ndotl = max(abs(dot(normal, sunDir)), 0.15);
  float waveHeight = worldPos.y - uSurfaceY;
  float heightMix = smoothstep(-3.0, 6.0, waveHeight);
  vec3 albedo = mix(uDeepColor, uShallowColor, heightMix);
  float foamNoise = 0.45 + 0.55 * smoothstep(0.25, 0.85, fbm3(worldPos.xz * 0.08 + vec2(uTime * 0.03, 0.0)));
  float foam = pow(smoothstep(uFoamThreshold, 1.0, vCompression), max(uFoamPower, 0.001)) * uFoamIntensity * foamNoise;
  foam = clamp(foam, 0.0, 1.0);
  vec3 refl = skyReflection(reflect(-viewDir, normal + vec3(detail.x, 0.0, detail.y) * uReflectionDistortion), sunDir) * (1.0 - uRoughness * 0.5);
  float fresnel = (0.02 + 0.98 * pow(1.0 - ndotv, max(uFresnelPower, 0.001))) * uFresnelStrength;
  vec3 diffuse = albedo * (ndotl * 0.8 + 0.2) * (1.0 - fresnel);
  vec3 sss = uSssColor * uSssStrength * pow(max(dot(viewDir, -sunDir), 0.0), 4.0) * smoothstep(0.0, 6.0, waveHeight);
  vec3 color = diffuse + refl * fresnel * uReflectionStrength + sss;
  color = mix(color, uFoamColor, foam);
  float fogT = clamp((dist - uFogNear) / max(uFogFar - uFogNear, 1.0), 0.0, 1.0);
  float fog = 1.0 - exp(-max(uFogDensity, 0.0) * fogT * fogT * 3.0);
  fog = max(fog, smoothstep(uHorizonStart, uHorizonEnd, dist));
  gl_FragColor = vec4(mix(color, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
}`;

function waveA(): THREE.Vector4[] {
  return DEEP_OCEAN_GPU_WAVES.map((w) => new THREE.Vector4(w.dirX, w.dirZ, w.k, w.omega));
}

function waveB(): THREE.Vector4[] {
  return DEEP_OCEAN_GPU_WAVES.map((w) => new THREE.Vector4(w.amp, w.phase, w.choppiness, 0));
}

function colorFromTuple(rgb: readonly [number, number, number]): THREE.Color {
  return new THREE.Color(rgb[0], rgb[1], rgb[2]);
}

function makeUniforms(params: DeepOceanMaterialParams): THREE.ShaderMaterial["uniforms"] {
  const s = params.shading;
  const w = params.wave;
  return {
    uTime: { value: 0 },
    uSurfaceY: { value: params.surfaceY },
    uCameraPos: { value: params.cameraPosition.clone() },
    uSunDir: { value: params.sunDirection.clone().normalize() },
    uDeepColor: { value: colorFromTuple(s.deepColor) },
    uShallowColor: { value: colorFromTuple(s.shallowColor) },
    uFoamColor: { value: colorFromTuple(s.foamColor) },
    uFogColor: { value: params.horizonColor?.clone() ?? colorFromTuple(s.fogColor) },
    uSkyZenithColor: { value: colorFromTuple(s.skyZenithColor) },
    uSssColor: { value: colorFromTuple(s.sssColor) },
    uFoamThreshold: { value: w.foamThreshold },
    uFoamPower: { value: w.foamPower },
    uFoamIntensity: { value: w.foamIntensity },
    uFresnelPower: { value: s.fresnelPower },
    uFresnelStrength: { value: s.fresnelStrength },
    uReflectionStrength: { value: s.reflectionStrength },
    uReflectionDistortion: { value: s.reflectionDistortion },
    uRoughness: { value: s.roughness },
    uFogNear: { value: s.fogNearM },
    uFogFar: { value: Math.max(params.fogDistanceM, s.fogFarM) },
    uFogDensity: { value: s.fogDensity },
    uDetailStrength: { value: w.detailNormalStrength },
    uDetailFadeStart: { value: w.detailNormalFadeStartM },
    uDetailFadeEnd: { value: w.detailNormalFadeEndM },
    uSssStrength: { value: s.sssStrength },
    uHorizonStart: { value: s.horizonBlendStartM },
    uHorizonEnd: { value: s.horizonBlendEndM },
    uWaveA: { value: waveA() },
    uWaveB: { value: waveB() },
  };
}

export function createDeepOceanShaderMaterial(params: DeepOceanMaterialParams): DeepOceanMaterialHandle {
  const uniforms = makeUniforms(params);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  material.name = "deep-ocean-v2-shader";
  return {
    material,
    setTime: (t) => { uniforms.uTime.value = t; },
    updateCamera: (pos) => { uniforms.uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { uniforms.uSunDir.value.copy(dir).normalize(); },
    updateHorizonColor: (color) => { uniforms.uFogColor.value.copy(color); },
    updateVisual: (visual) => {
      uniforms.uDeepColor.value.setRGB(visual.deepColor[0], visual.deepColor[1], visual.deepColor[2]);
      uniforms.uShallowColor.value.setRGB(visual.shallowColor[0], visual.shallowColor[1], visual.shallowColor[2]);
      uniforms.uFoamColor.value.setRGB(visual.foamColor[0], visual.foamColor[1], visual.foamColor[2]);
    },
    dispose: () => { material.dispose(); },
  };
}

export async function createDeepOceanMaterial(isWebGpu: boolean, params: DeepOceanMaterialParams): Promise<DeepOceanMaterialHandle> {
  if (isWebGpu) {
    const { createDeepOceanNodeMaterialImpl } = await import("./deep_ocean_node_material.js");
    return createDeepOceanNodeMaterialImpl(params);
  }
  return createDeepOceanShaderMaterial(params);
}
