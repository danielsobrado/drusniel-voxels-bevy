// Render-only deep ocean material — outside the playable world square.
// No clipmap discard, no terrain/body-mask attributes, no inner-rect holes.
import * as THREE from "three";
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

const DEEP_OCEAN_VERT = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DEEP_OCEAN_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
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

    vec3 skyZenith = vec3(0.12, 0.32, 0.72);
    vec3 skyHorizon = vec3(0.55, 0.70, 0.90);
    vec3 skyDawn = vec3(0.85, 0.55, 0.35);
    vec3 horizon = mix(skyDawn, skyHorizon, smoothstep(0.0, 0.25, sunDir.y));
    vec3 sky = mix(horizon, skyZenith, smoothstep(0.0, 0.6, reflYClamped));

    vec3 belowHorizon = mix(vec3(0.035, 0.07, 0.16), vec3(0.07, 0.14, 0.28), smoothstep(-0.5, 0.0, reflY));
    vec3 reflectedSky = mix(belowHorizon, sky, smoothstep(-0.25, 0.12, reflY));

    vec3 sunWarm = vec3(1.0, 0.72, 0.42);
    vec3 sunWhite = vec3(1.0, 0.95, 0.85);
    vec3 mie = sunWarm * pow(sunDot, 8.0) * 0.25 + sunWhite * pow(sunDot, 64.0) * 1.2;
    vec3 sunDisc = vec3(1.0, 0.92, 0.75) * (pow(sunDot, 512.0) * 4.5 + pow(sunDot, 128.0) * 1.4);

    return max(reflectedSky + mie + sunDisc, vec3(0.035, 0.07, 0.14));
  }

  void main() {
    vec3 worldPos = vWorldPos;
    vec2 breezeDir = normalize(uLakeBreeze + vec2(0.00001, 0.0));
    float advectSpeed = length(uLakeBreeze) * uRippleSpeed;
    float phaseA = fract(uTime * uRippleCycle);
    float phaseB = fract(uTime * uRippleCycle + 0.5);
    float blend = abs(phaseA - 0.5) * 2.0;
    vec2 advectA = breezeDir * (phaseA * uRippleLoopDistance * advectSpeed);
    vec2 advectB = breezeDir * (phaseB * uRippleLoopDistance * advectSpeed);
    vec2 gradA = rippleGrad(worldPos.xz * uRippleScaleA + advectA, phaseA);
    vec2 gradB = rippleGrad(worldPos.xz * uRippleScaleB + advectB + vec2(17.31, -9.47), phaseB);
    vec2 grad = mix(gradA, gradB, blend) * uRippleAmp;
    vec3 normal = normalize(vec3(-grad.x, 1.0, -grad.y));

    vec3 viewDir = normalize(uCameraPos - worldPos);
    vec3 sunDir = normalize(uSunDir);
    vec3 fresnelNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));
    float ndotv = max(dot(viewDir, fresnelNormal), 0.0);
    float fres = uFresnelBase + (1.0 - uFresnelBase) * pow(1.0 - ndotv, uFresnelPower);

    vec3 deepInk = vec3(0.0, 0.025, 0.10);
    vec3 deepBlue = mix(deepInk, uDeepColor, 0.55);
    vec3 shallowTeal = mix(uShallowColor, vec3(0.0, 0.45, 0.62), 0.35);
    float viewDepthTint = smoothstep(0.0, 0.55, 1.0 - ndotv);
    vec3 waterColor = mix(deepBlue, shallowTeal, viewDepthTint * 0.28 + uTurbidity * 0.18);

    vec3 reflectDir = normalize(reflect(-viewDir, normal));
    vec3 envReflection = skyReflection(reflectDir, sunDir);
    float roughFade = 0.88;
    vec3 finalReflection = envReflection * roughFade;

    float foamA1 = noise2(worldPos.xz * uFoamNoiseScale + advectA * 0.7);
    float foamB1 = noise2((worldPos.xz + vec2(3.71, 1.13)) * uFoamNoiseScale + advectB * 0.7);
    float varNorm = sqrt(blend * blend + (1.0 - blend) * (1.0 - blend));
    float foamBlend = (mix(foamA1, foamB1, blend) - 0.5) / max(varNorm, 0.01) + 0.5;
    float foam = smoothstep(0.58, 0.93, foamBlend) * 0.18;

    float backlit = pow(max(dot(viewDir, -sunDir), 0.0), 4.0) * 0.35;
    float crestScatter = smoothstep(0.45, 0.95, foamBlend) * 0.35;
    vec3 sss = mix(vec3(0.01, 0.04, 0.14), shallowTeal, 0.55) * (backlit + crestScatter);

    float specDot = max(dot(reflect(-sunDir, normal), viewDir), 0.0);
    vec3 sunSpec = vec3(1.0, 0.92, 0.76) * (pow(specDot, 384.0) * 1.35 + pow(specDot, 96.0) * 0.32);

    vec3 litWater = mix(waterColor + sss + sunSpec, finalReflection, clamp(fres * 0.75, 0.0, 0.85));
    vec3 finalColor = mix(litWater, uFoamColor, foam);

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
  uHorizonColor: { value: THREE.Color };
  uFogDistance: { value: number };
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
    uHorizonColor: { value: (params.horizonColor ?? new THREE.Color(0.62, 0.74, 0.88)).clone() },
    uFogDistance: { value: Math.max(256, params.visual.rippleLoopDistance * 4) },
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
