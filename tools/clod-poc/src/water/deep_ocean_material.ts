// Render-only deep ocean material — outside the playable world square.
// No clipmap discard, no terrain/body-mask attributes, no inner-rect holes.
import * as THREE from "three";
import { DEEP_OCEAN_GPU_WAVES } from "./deep_ocean_waves.js";
import type { WaterVisualConfig } from "./waterConfig.js";
import { applyWaterVisual, makeWaterUniforms, type WaterUniforms } from "./waterMaterial.js";

export interface DeepOceanMaterialParams {
  visual: WaterVisualConfig;
  surfaceY: number;
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
  uniform vec4 uWaveA[DEEP_OCEAN_WAVE_COUNT]; // dirX, dirZ, k, omega
  uniform vec4 uWaveB[DEEP_OCEAN_WAVE_COUNT]; // amp, phase, choppiness, unused
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
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uFoamColor;
  uniform vec3 uHorizonColor;
  uniform float uAlpha;
  uniform float uRippleCycle;
  uniform float uFresnelPower;
  uniform float uRippleAmp;
  uniform float uRippleSpeed;
  uniform float uRippleScaleA;
  uniform float uRippleScaleB;
  uniform float uRippleStrengthA;
  uniform float uRippleStrengthB;
  uniform float uRippleLoopDistance;
  uniform vec2 uLakeBreeze;
  uniform float uFoamNoiseScale;
  uniform float uFresnelBase;
  uniform float uFresnelNormalFlatten;
  uniform float uTurbidity;
  uniform vec3 uCameraPos;
  uniform vec3 uSunDir;
  uniform float uFogDistance;
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
    float n1 = noise2(p);
    float n2 = noise2(p * 2.3 + vec2(17.3, -9.1));
    float n3 = noise2(p * 5.7 + vec2(-3.8, 23.5));
    return n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
  }

  float noiseDomainWarp(vec2 uv, float t) {
    float warp = fbm3(uv * 0.35 + vec2(t * 0.035, -t * 0.025));
    float base = fbm3(uv + vec2(warp * 1.8, -warp * 1.4));
    float ridged = 1.0 - abs(base * 2.0 - 1.0);
    return mix(base, ridged, 0.4);
  }

  float noiseRidged(vec2 uv, float t) {
    float r1 = 1.0 - abs(noise2(uv + vec2(t * 0.03, -t * 0.02)) * 2.0 - 1.0);
    float r2 = 1.0 - abs(noise2(uv * 2.3 + vec2(-t * 0.04, t * 0.05)) * 2.0 - 1.0);
    float r3 = 1.0 - abs(noise2(uv * 5.7 + vec2(t * 0.05, t * 0.02)) * 2.0 - 1.0);
    return r1 * 0.5 + r2 * r1 * 0.3 + r3 * r2 * 0.2;
  }

  float noiseCellular(vec2 uv, float t) {
    vec2 p = uv * 0.8 + vec2(t * 0.02, -t * 0.015);
    float c1 = noise2(p);
    float c2 = noise2(p + vec2(0.33, 0.77));
    return clamp((1.0 - abs(c1 - c2)) * 1.5, 0.0, 1.0);
  }

  float noiseBillow(vec2 uv, float t) {
    float b1 = abs(noise2(uv + vec2(t * 0.03, -t * 0.02)) * 2.0 - 1.0);
    float b2 = abs(noise2(uv * 2.3 + vec2(-t * 0.04, t * 0.05)) * 2.0 - 1.0);
    float b3 = abs(noise2(uv * 5.7 + vec2(t * 0.05, t * 0.02)) * 2.0 - 1.0);
    return b1 * 0.5 + b2 * 0.3 + b3 * 0.2;
  }

  float noiseSwiss(vec2 uv, float t) {
    float sw1 = 1.0 - abs(noise2(uv + vec2(t * 0.02, -t * 0.01)) * 2.0 - 1.0);
    vec2 swUv = uv + vec2(sw1 * 0.3, sw1 * -0.25);
    float sw2 = 1.0 - abs(noise2(swUv * 2.5 + vec2(-t * 0.03, t * 0.02)) * 2.0 - 1.0);
    return sw1 * 0.6 + sw2 * sw1 * sw1 * 0.4;
  }

  float noiseTurbulent(vec2 uv, float t) {
    float t1 = abs(noise2(uv + vec2(t * 0.04, t * 0.02)) * 2.0 - 1.0);
    float t2 = abs(noise2(uv * 2.3 + vec2(-t * 0.06, t * 0.035)) * 2.0 - 1.0);
    float t3 = abs(noise2(uv * 5.7 + vec2(t * 0.05, t * 0.015)) * 2.0 - 1.0);
    return 1.0 - (t1 * 0.45 + t2 * 0.35 + t3 * 0.2);
  }

  float combinedFoamNoise(vec2 uv, float t) {
    return clamp(
      noiseDomainWarp(uv, t) * 0.24 +
      noiseRidged(uv, t) * 0.24 +
      noiseCellular(uv, t) * 0.08 +
      noiseBillow(uv, t) * 0.10 +
      noiseSwiss(uv, t) * 0.14 +
      noiseTurbulent(uv, t) * 0.20,
      0.0,
      1.0
    );
  }

  float bumpHeight(vec2 uv, float t) {
    float crossA = noise2(vec2(uv.x * 0.9 + uv.y * 0.27, uv.y * 0.9 - uv.x * 0.27) + vec2(t * 0.09, 0.0));
    float crossB = noise2(vec2(uv.x * 0.9 - uv.y * 0.45, uv.y * 0.9 + uv.x * 0.45) - vec2(t * 0.07, 0.0));
    return fbm3(uv * 0.8 + vec2(t * 0.12, t * 0.06)) * 0.28 +
      noiseRidged(uv * 0.55, t) * 0.18 +
      noiseDomainWarp(uv * 0.42, t) * 0.18 +
      noiseBillow(uv * 0.75, t) * 0.12 +
      (crossA + crossB) * 0.05 +
      fbm3(uv * 2.7 - vec2(t * 0.18, t * 0.05)) * 0.14;
  }

  vec2 bumpNormalDetail(vec2 uv, float t) {
    float eps = 0.02;
    float h = bumpHeight(uv, t);
    float hx = bumpHeight(uv + vec2(eps, 0.0), t);
    float hz = bumpHeight(uv + vec2(0.0, eps), t);
    return vec2((hx - h) / eps, (hz - h) / eps);
  }

  vec2 rippleGrad(vec2 uv, float phase) {
    float tau = 6.28318530718;
    return vec2(
      cos(uv.x + phase * tau) * uRippleStrengthA + cos((uv.x + uv.y) * 0.73 - phase * tau * 0.7) * uRippleStrengthB,
      -sin(uv.y - phase * tau) * uRippleStrengthA + cos((uv.x - uv.y) * 0.61 + phase * tau * 0.9) * uRippleStrengthB
    );
  }

  vec3 skyReflection(vec3 reflectDir, vec3 sunDir) {
    float reflY = reflectDir.y;
    float reflYClamped = max(reflY, 0.0);
    float sunDot = max(dot(reflectDir, sunDir), 0.0);
    vec3 horizon = mix(vec3(0.85, 0.55, 0.35), vec3(0.55, 0.70, 0.90), smoothstep(0.0, 0.25, sunDir.y));
    vec3 sky = mix(horizon, vec3(0.12, 0.32, 0.72), smoothstep(0.0, 0.6, reflYClamped));
    vec3 belowHorizon = mix(vec3(0.035, 0.07, 0.16), vec3(0.07, 0.14, 0.28), smoothstep(-0.5, 0.0, reflY));
    vec3 reflectedSky = mix(belowHorizon, sky, smoothstep(-0.25, 0.12, reflY));
    vec3 mie = vec3(1.0, 0.72, 0.42) * pow(sunDot, 8.0) * 0.25 + vec3(1.0, 0.95, 0.85) * pow(sunDot, 64.0) * 1.2;
    vec3 sunDisc = vec3(1.0, 0.92, 0.75) * (pow(sunDot, 512.0) * 4.5 + pow(sunDot, 128.0) * 1.4);
    return max(reflectedSky + mie + sunDisc, vec3(0.035, 0.07, 0.14));
  }

  void main() {
    vec3 worldPos = vWorldPos;
    float waveHeight = worldPos.y - uSurfaceY;
    vec2 breezeDir = normalize(uLakeBreeze + vec2(0.00001, 0.0));
    float advectSpeed = length(uLakeBreeze) * uRippleSpeed;
    float phaseA = fract(uTime * uRippleCycle);
    float phaseB = fract(uTime * uRippleCycle + 0.5);
    float blend = abs(phaseA - 0.5) * 2.0;
    vec2 advectA = breezeDir * (phaseA * uRippleLoopDistance * advectSpeed);
    vec2 advectB = breezeDir * (phaseB * uRippleLoopDistance * advectSpeed);
    vec2 gradA = rippleGrad(worldPos.xz * uRippleScaleA + advectA, phaseA);
    vec2 gradB = rippleGrad(worldPos.xz * uRippleScaleB + advectB + vec2(17.31, -9.47), phaseB);
    vec2 noiseGrad = bumpNormalDetail(worldPos.xz * max(0.02, uFoamNoiseScale * 2.5), uTime) * 0.18;
    vec2 grad = mix(gradA, gradB, blend) * uRippleAmp + noiseGrad + vWaveSlope;
    vec3 normal = normalize(vec3(-grad.x, 1.0, -grad.y));

    vec3 viewDir = normalize(uCameraPos - worldPos);
    vec3 sunDir = normalize(uSunDir);
    vec3 fresnelNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));
    float ndotv = max(dot(viewDir, fresnelNormal), 0.0);
    float fres = uFresnelBase + (1.0 - uFresnelBase) * pow(1.0 - ndotv, uFresnelPower);

    vec3 deepBlue = mix(vec3(0.0, 0.025, 0.10), uDeepColor, 0.55);
    vec3 shallowTeal = mix(uShallowColor, vec3(0.0, 0.45, 0.62), 0.35);
    float viewDepthTint = smoothstep(0.0, 0.55, 1.0 - ndotv);
    float heightTint = smoothstep(-3.0, 5.5, waveHeight);
    vec3 waterColor = mix(deepBlue, shallowTeal, viewDepthTint * 0.28 + uTurbidity * 0.18);
    waterColor = mix(waterColor, mix(vec3(0.01, 0.04, 0.14), shallowTeal, heightTint), 0.32);

    vec3 reflectDir = normalize(reflect(-viewDir, normal));
    vec3 finalReflection = skyReflection(reflectDir, sunDir) * 0.88;

    vec2 foamUv = worldPos.xz * max(0.01, uFoamNoiseScale) + advectA * 0.35;
    float foamNoise = combinedFoamNoise(foamUv, uTime);
    float crestFoam = smoothstep(1.2, 4.0, waveHeight) * smoothstep(0.36, 0.82, foamNoise);
    float compressionFoam = smoothstep(0.04, 0.55, vWaveCompression) * smoothstep(0.42, 0.86, foamNoise);
    float foam = smoothstep(0.70, 0.96, foamNoise) * 0.10 + crestFoam * 0.34 + compressionFoam * 0.38;

    float backlit = pow(max(dot(viewDir, -sunDir), 0.0), 4.0) * 0.35;
    float crestScatter = smoothstep(0.0, 5.5, waveHeight) * 0.38 + smoothstep(0.45, 0.95, foamNoise) * 0.20;
    vec3 sss = mix(vec3(0.01, 0.04, 0.14), shallowTeal, 0.55) * (backlit + crestScatter);

    float specDot = max(dot(reflect(-sunDir, normal), viewDir), 0.0);
    vec3 sunSpec = vec3(1.0, 0.92, 0.76) * (pow(specDot, 384.0) * 1.35 + pow(specDot, 96.0) * 0.32);

    vec3 litWater = mix(waterColor + sss + sunSpec, finalReflection, clamp(fres * 0.75, 0.0, 0.85));
    vec3 finalColor = mix(litWater, uFoamColor, clamp(foam, 0.0, 1.0));

    float dist = length(uCameraPos.xz - worldPos.xz);
    float horizonLift = smoothstep(0.02, 0.35, 1.0 - abs(viewDir.y));
    float distFog = smoothstep(uFogDistance * 0.35, uFogDistance, dist);
    float fog = clamp(max(horizonLift * 0.42, distFog * 0.58), 0.0, 1.0);
    finalColor = mix(finalColor, uHorizonColor, fog);

    float alpha = clamp(uAlpha + fres * 0.18, 0.0, 1.0);
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

interface DeepOceanUniforms extends WaterUniforms {
  uSurfaceY: { value: number };
  uHorizonColor: { value: THREE.Color };
  uFogDistance: { value: number };
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
    uFogDistance: { value: Math.max(256, params.visual.rippleLoopDistance * 4) },
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
      uniforms.uFogDistance.value = Math.max(256, visual.rippleLoopDistance * 4);
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
