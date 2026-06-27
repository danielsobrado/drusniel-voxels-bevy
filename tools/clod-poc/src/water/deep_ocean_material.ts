// Render-only deep ocean material — outside the playable world square.
// No clipmap discard, no terrain/body-mask attributes, no inner-rect holes.
import * as THREE from "three";
import { DEEP_OCEAN_GPU_WAVES } from "./deep_ocean_waves.js";
import type { DeepOceanShadingConfig, DeepOceanWaveConfig } from "../terrain/border_coast_config.js";
import type { WaterVisualConfig } from "./waterConfig.js";
import { applyWaterVisual, makeWaterUniforms, type WaterUniforms } from "./waterMaterial.js";

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

const DEEP_OCEAN_VERT = /* glsl */ `
  #define DEEP_OCEAN_WAVE_COUNT ${GPU_WAVE_COUNT}
  uniform float uTime;
  uniform vec4 uWaveA[DEEP_OCEAN_WAVE_COUNT];
  uniform vec4 uWaveB[DEEP_OCEAN_WAVE_COUNT];
  varying vec3 vWorldPos;
  varying vec2 vWaveSlope;
  varying float vWaveCompression;

  void main() {
    vec3 p = position;
    float offsetX = 0.0;
    float offsetY = 0.0;
    float offsetZ = 0.0;
    float slopeX = 0.0;
    float slopeZ = 0.0;
    float jxx = 0.0;
    float jzz = 0.0;
    float jxz = 0.0;

    for (int i = 0; i < DEEP_OCEAN_WAVE_COUNT; i++) {
      vec4 a = uWaveA[i];
      vec4 b = uWaveB[i];
      float theta = a.z * (a.x * position.x + a.y * position.z) - a.w * uTime + b.y;
      float c = cos(theta);
      float s = sin(theta);
      offsetX -= b.x * a.x * s * b.z;
      offsetZ -= b.x * a.y * s * b.z;
      offsetY += b.x * c;
      slopeX -= b.x * a.z * a.x * s;
      slopeZ -= b.x * a.z * a.y * s;
      jxx -= b.x * a.z * a.x * a.x * c * b.z;
      jzz -= b.x * a.z * a.y * a.y * c * b.z;
      jxz -= b.x * a.z * a.x * a.y * c * b.z;
    }

    p += vec3(offsetX, offsetY, offsetZ);
    float jacobian = (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
    vWaveCompression = clamp((0.58 - jacobian) / 0.58, 0.0, 1.0);
    vWaveSlope = vec2(slopeX, slopeZ);
    vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const DEEP_OCEAN_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uSurfaceY;
  uniform vec3 uDeepColor;
  uniform vec3 uFoamColor;
  uniform vec3 uHorizonColor;
  uniform float uAlpha;
  uniform float uFresnelPower;
  uniform float uFresnelBase;
  uniform float uFresnelNormalFlatten;
  uniform vec3 uCameraPos;
  uniform vec3 uSunDir;
  uniform float uFogDistance;
  uniform float uFogNear;
  uniform float uFogDensity;
  uniform float uFoamThreshold;
  uniform float uFoamPower;
  uniform float uFoamIntensity;
  uniform float uReflectionStrength;
  uniform float uReflectionDistortion;
  uniform float uRoughness;
  varying vec3 vWorldPos;
  varying vec2 vWaveSlope;
  varying float vWaveCompression;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += noise2(p) * a;
      p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(17.0, 9.0);
      a *= 0.5;
    }
    return v;
  }

  float foamNoiseOmma(vec2 uv, float t) {
    float ft = t * 0.15;
    float warpScale = 0.8 * 0.3;
    float warpX = noise2(uv * warpScale + vec2(ft * 0.2, 0.0)) * 1.8;
    float warpZ = noise2(uv * warpScale + vec2(0.0, ft * -0.15)) * 1.8;
    vec2 warped = uv + vec2(warpX, warpZ);
    float n1 = noise2(warped * 0.8 + vec2(ft * 0.35, ft * -0.2));
    float n2 = noise2(warped * 1.84 + vec2(ft * -0.25, ft * 0.4));
    float n3 = noise2(warped * 4.56 + vec2(ft * 0.5, ft * 0.15));
    float baseFbm = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
    float turbulent = 1.0 - (abs(n1 * 2.0 - 1.0) * 0.45 + abs(n2 * 2.0 - 1.0) * 0.35 + abs(n3 * 2.0 - 1.0) * 0.2);
    return clamp(turbulent * 0.35 + baseFbm * 0.18, 0.0, 1.0);
  }

  float bumpHeight(vec2 uv, float t) {
    return fbm3(uv * 0.4 + vec2(t * 0.12, t * 0.06)) * 0.28
      + (1.0 - abs(fbm3(uv * 0.275 + vec2(t * 0.03, -t * 0.02)) * 2.0 - 1.0)) * 0.18
      + fbm3(uv * 1.35 - vec2(t * 0.18, t * 0.05)) * 0.14;
  }

  vec2 bumpNormalDetail(vec2 uv, float t) {
    float eps = 0.02;
    float h = bumpHeight(uv, t);
    float hx = bumpHeight(uv + vec2(eps, 0.0), t);
    float hz = bumpHeight(uv + vec2(0.0, eps), t);
    return vec2((hx - h) / eps, (hz - h) / eps);
  }

  vec3 skyReflection(vec3 reflectDir, vec3 sunDir) {
    float reflY = reflectDir.y;
    float reflYClamped = max(reflY, 0.0);
    float sunDot = max(dot(reflectDir, sunDir), 0.0);
    vec3 horizon = mix(vec3(0.85, 0.55, 0.35), vec3(0.55, 0.70, 0.90), smoothstep(0.0, 0.25, sunDir.y));
    vec3 sky = mix(horizon, vec3(0.15, 0.35, 0.75), smoothstep(0.0, 0.6, reflYClamped));
    vec3 belowHorizon = mix(vec3(0.04, 0.08, 0.18), vec3(0.08, 0.15, 0.28), smoothstep(-0.5, 0.0, reflY));
    vec3 reflectedSky = mix(belowHorizon, sky, smoothstep(-0.25, 0.12, reflY));
    vec3 mie = vec3(1.0, 0.85, 0.55) * pow(sunDot, 8.0) * 0.25 + vec3(1.0, 0.95, 0.85) * pow(sunDot, 64.0) * 1.2;
    vec3 sunDisc = vec3(1.0, 0.92, 0.75) * (pow(sunDot, 512.0) * 5.0 + pow(sunDot, 128.0) * 1.5);
    vec3 ambientFloor = mix(vec3(0.03, 0.06, 0.12), vec3(0.06, 0.10, 0.18), smoothstep(-0.3, 0.2, reflY));
    return max(reflectedSky + mie + sunDisc, ambientFloor);
  }

  void main() {
    vec3 worldPos = vWorldPos;
    float waveHeight = worldPos.y - uSurfaceY;
    vec2 bump = bumpNormalDetail(worldPos.xz * 0.5, uTime * 0.3) * 0.205;
    vec2 grad = vWaveSlope + bump;
    vec3 normal = normalize(vec3(-grad.x, 1.0, -grad.y));

    vec3 viewDir = normalize(uCameraPos - worldPos);
    vec3 sunDir = normalize(uSunDir);
    vec3 fresnelNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));
    float ndotv = max(dot(viewDir, fresnelNormal), 0.05);
    float ndotl = max(abs(dot(normal, sunDir)), 0.15);

    float jacobian = 0.58 - vWaveCompression * 0.58;
    float foamNoise = foamNoiseOmma(worldPos.xz, uTime);
    float foamEdge = uFoamThreshold + foamNoise;
    float foamMask = pow(1.0 - smoothstep(foamEdge - 0.6, foamEdge, jacobian), max(uFoamPower, 0.001));
    foamMask = clamp(foamMask * uFoamIntensity, 0.0, 1.0);

    vec3 deepColor = vec3(0.0, 0.03, 0.12);
    vec3 shallowColor = vec3(0.0, 0.08, 0.18);
    float elevationMask = smoothstep(-4.0, 6.0, waveHeight);
    vec3 baseAlbedo = mix(deepColor, uDeepColor, elevationMask);
    vec3 depthTint = mix(shallowColor, baseAlbedo, smoothstep(-2.0, 3.0, waveHeight));
    float hNorm = smoothstep(-5.0, 8.0, waveHeight);
    vec3 hColor1 = mix(vec3(0.008, 0.102, 0.208), vec3(0.024, 0.259, 0.451), smoothstep(0.0, 0.33, hNorm));
    vec3 hColor2 = mix(hColor1, vec3(0.102, 0.541, 0.490), smoothstep(0.33, 0.66, hNorm));
    vec3 hColor3 = mix(hColor2, vec3(0.369, 0.769, 0.690), smoothstep(0.66, 1.0, hNorm));
    vec3 albedo = mix(depthTint, hColor3, 0.6);

    vec3 reflectDir = normalize(reflect(-viewDir, normal));
    vec3 distortedReflect = normalize(reflectDir + vec3(bump.x * uReflectionDistortion * 10.0, 0.0, bump.y * uReflectionDistortion * 10.0));
    vec3 finalReflection = skyReflection(distortedReflect, sunDir) * (1.0 - uRoughness * 0.5);

    float f0 = 0.04;
    float fresnelSchlick = f0 + (1.0 - f0) * pow(1.0 - ndotv, 5.0);
    float reflectionMix = fresnelSchlick * uReflectionStrength * (1.0 - foamMask * 0.7);
    vec3 diffuseColor = albedo * (ndotl * 0.8 + 0.2) * (1.0 - reflectionMix);

    vec3 halfDir = normalize(sunDir + viewDir);
    float shininess = mix(800.0, 4.0, clamp(uRoughness, 0.0, 1.0));
    float spec = pow(max(dot(normal, halfDir), 0.0), shininess) * 1.2 * (1.0 - foamMask);

    float sssForward = pow(max(dot(viewDir, -normalize(sunDir + normal * 0.4)), 0.0), 5.0) * 0.8;
    float sssBacklit = pow(max(dot(viewDir, -sunDir), 0.0), 4.0) * 0.5;
    float sssCrest = smoothstep(0.0, 6.0, waveHeight);
    vec3 sss = mix(vec3(0.01, 0.04, 0.14), vec3(0.04, 0.36, 0.35), smoothstep(-1.0, 5.0, waveHeight) * 0.55)
      * (sssForward + sssBacklit + sssCrest * 0.06) * (sssCrest * 0.7 + smoothstep(2.0, 7.0, waveHeight) * 0.5) * 0.9;

    vec3 oceanColor = diffuseColor + finalReflection * reflectionMix + vec3(spec) * (1.0 - uRoughness) + sss;
    vec3 foamLit = uFoamColor * (ndotl * 0.4 + 0.7) * (noise2(worldPos.xz * 8.0) * 0.1 + 0.9);
    vec3 litOcean = mix(oceanColor, foamLit, foamMask);

    float dist = length(uCameraPos - worldPos);
    float fog = smoothstep(uFogNear, uFogDistance, dist) * uFogDensity;
    vec3 finalColor = mix(litOcean, uHorizonColor, clamp(fog, 0.0, 1.0));

    gl_FragColor = vec4(finalColor, clamp(uAlpha, 0.0, 1.0));
  }
`;

interface DeepOceanUniforms extends WaterUniforms {
  uSurfaceY: { value: number };
  uHorizonColor: { value: THREE.Color };
  uFogDistance: { value: number };
  uFogNear: { value: number };
  uFogDensity: { value: number };
  uFoamThreshold: { value: number };
  uFoamPower: { value: number };
  uFoamIntensity: { value: number };
  uReflectionStrength: { value: number };
  uReflectionDistortion: { value: number };
  uRoughness: { value: number };
  uWaveA: { value: THREE.Vector4[] };
  uWaveB: { value: THREE.Vector4[] };
}

function waveUniformA(): THREE.Vector4[] {
  return DEEP_OCEAN_GPU_WAVES.map((wave) => new THREE.Vector4(wave.dirX, wave.dirZ, wave.k, wave.omega));
}

function waveUniformB(): THREE.Vector4[] {
  return DEEP_OCEAN_GPU_WAVES.map((wave) => new THREE.Vector4(wave.amp, wave.phase, wave.choppiness, 0));
}

function makeDeepOceanUniforms(params: DeepOceanMaterialParams): DeepOceanUniforms {
  const base = makeWaterUniforms({
    visual: params.visual,
    debugMode: 0,
    sunDirection: params.sunDirection,
    cameraPosition: params.cameraPosition,
    worldBounds: { cellsX: 0, cellsZ: 0 },
  });
  return {
    ...base,
    uSurfaceY: { value: params.surfaceY },
    uHorizonColor: { value: (params.horizonColor ?? new THREE.Color(0.62, 0.74, 0.88)).clone() },
    uFogDistance: { value: Math.max(256, params.fogDistanceM) },
    uFogNear: { value: Math.max(0, params.shading.fogNearM) },
    uFogDensity: { value: Math.max(0, params.shading.fogDensity) },
    uFoamThreshold: { value: Math.max(0, params.wave.foamThreshold) },
    uFoamPower: { value: Math.max(0.001, params.wave.foamPower) },
    uFoamIntensity: { value: Math.max(0, params.wave.foamIntensity) },
    uReflectionStrength: { value: Math.max(0, params.shading.reflectionStrength) },
    uReflectionDistortion: { value: Math.max(0, params.shading.reflectionDistortion) },
    uRoughness: { value: Math.max(0, params.shading.roughness) },
    uWaveA: { value: waveUniformA() },
    uWaveB: { value: waveUniformB() },
  };
}

export function createDeepOceanShaderMaterial(params: DeepOceanMaterialParams): DeepOceanMaterialHandle {
  const uniforms = makeDeepOceanUniforms(params);
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as THREE.ShaderMaterial["uniforms"],
    vertexShader: DEEP_OCEAN_VERT,
    fragmentShader: DEEP_OCEAN_FRAG,
    transparent: true,
    depthTest: true,
    depthWrite: params.visual.depthWrite,
    side: THREE.DoubleSide,
  });
  material.name = "deep-ocean-shader";

  return {
    material,
    setTime: (t) => { uniforms.uTime.value = t; },
    updateCamera: (pos) => { uniforms.uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { uniforms.uSunDir.value.copy(dir).normalize(); },
    updateHorizonColor: (color) => { uniforms.uHorizonColor.value.copy(color); },
    updateVisual: (visual) => {
      applyWaterVisual(uniforms, visual);
      material.depthWrite = visual.depthWrite;
      material.needsUpdate = true;
    },
    dispose: () => { material.dispose(); },
  };
}

export async function createDeepOceanMaterial(
  isWebGpu: boolean,
  params: DeepOceanMaterialParams,
): Promise<DeepOceanMaterialHandle> {
  if (isWebGpu) {
    const { createDeepOceanNodeMaterialImpl } = await import("./deep_ocean_node_material.js");
    return createDeepOceanNodeMaterialImpl(params);
  }
  return createDeepOceanShaderMaterial(params);
}
