import * as THREE from "three";
import type { WaterRefractionConfig, WaterReflectionConfig } from "./waterConfig.js";
import type { WaterMaterialParams } from "./water_material_types.js";
import { DEFAULT_CAUSTICS_CONFIG } from "./causticsConfig.js";

const LEVEL_PALETTE: Array<[number, number, number]> = [
  [0.36, 0.62, 0.95],
  [0.30, 0.86, 0.58],
  [0.94, 0.74, 0.30],
  [0.95, 0.42, 0.46],
  [0.66, 0.46, 0.94],
  [0.42, 0.78, 0.92],
];

export function waterLevelColor(level: number): [number, number, number] {
  return LEVEL_PALETTE[Math.max(0, Math.min(LEVEL_PALETTE.length - 1, Math.floor(level)))];
}

export const WATER_VERT = /* glsl */ `
  attribute float aTerrainY;
  attribute float aBodyMask;
  attribute vec4 aFlow;
  attribute float aLevel;
  varying vec3 vWorldPos;
  varying float vTerrainY;
  varying float vBodyMask;
  varying vec4 vFlow;
  varying float vLevel;

  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vTerrainY = aTerrainY;
    vBodyMask = aBodyMask;
    vFlow = aFlow;
    vLevel = aLevel;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function levelColorGlsl(): string {
  return [
    "  vec3 waterLevelColor(float level) {",
    "    int idx = int(clamp(floor(level), 0.0, 5.0));",
    "    if (idx == 0) return vec3(0.36, 0.62, 0.95);",
    "    if (idx == 1) return vec3(0.30, 0.86, 0.58);",
    "    if (idx == 2) return vec3(0.94, 0.74, 0.30);",
    "    if (idx == 3) return vec3(0.95, 0.42, 0.46);",
    "    if (idx == 4) return vec3(0.66, 0.46, 0.94);",
    "    return vec3(0.42, 0.78, 0.92);",
    "  }",
  ].join("\n");
}


export const WATER_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uFoamColor;
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
  uniform float uShoreFoamStart;
  uniform float uShoreFoamEnd;
  uniform float uFoamNoiseScale;
  uniform float uFoamShoreStrength;
  uniform float uFoamRiverStrength;
  uniform float uFoamSpeedStart;
  uniform float uFoamSpeedEnd;
  uniform float uFoamDropStart;
  uniform float uFoamDropEnd;
  uniform float uFresnelBase;
  uniform float uFresnelNormalFlatten;
  uniform float uDepthScale;
  uniform float uTurbidity;
  uniform float uClipmapTint;
  uniform vec4 uInnerRect;
  uniform int uDebugMode;
  uniform vec3 uCameraPos;
  uniform vec3 uSunDir;
  uniform vec2 uWorldBounds;
  uniform float uCausticsEnabled;
  uniform float uCausticsGain;
  uniform float uCausticsScale;
  uniform float uCausticsSpeed;
  varying vec3 vWorldPos;
  varying float vTerrainY;
  varying float vBodyMask;
  varying vec4 vFlow;
  varying float vLevel;

  ${levelColorGlsl()}

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

    vec3 mie = vec3(1.0, 0.72, 0.42) * pow(sunDot, 8.0) * 0.25
      + vec3(1.0, 0.95, 0.85) * pow(sunDot, 64.0) * 1.2;
    vec3 sunDisc = vec3(1.0, 0.92, 0.75) * (pow(sunDot, 512.0) * 4.5 + pow(sunDot, 128.0) * 1.4);

    return max(reflectedSky + mie + sunDisc, vec3(0.035, 0.07, 0.14));
  }

  void main() {
    vec3 worldPos = vWorldPos;
    bool finiteWorldBounds = uWorldBounds.x > 0.0 && uWorldBounds.y > 0.0;
    if (finiteWorldBounds && (worldPos.x < 0.0 || worldPos.x > uWorldBounds.x ||
        worldPos.z < 0.0 || worldPos.z > uWorldBounds.y)) {
      discard;
    }
    if (worldPos.x > uInnerRect.x && worldPos.x < uInnerRect.z &&
        worldPos.z > uInnerRect.y && worldPos.z < uInnerRect.w) {
      discard;
    }
    if (vBodyMask <= 0.0) {
      discard;
    }
    float depth = worldPos.y - vTerrainY;
    if (depth <= 0.0) discard;
    // Beer-Lambert style depth response; matches the WebGPU node materials.
    float depthNorm = 1.0 - exp(-depth / max(uDepthScale, 0.05));

    float caustic = 0.0;
    if (uCausticsEnabled > 0.5) {
      vec2 causticUV = worldPos.xz * uCausticsScale;
      float t = uTime * uCausticsSpeed;
      float c1 = sin(causticUV.x * 3.7 + t * 1.1 + causticUV.y * 2.3) *
                 cos(causticUV.y * 4.1 - t * 0.9 + causticUV.x * 1.7);
      float c2 = sin(causticUV.x * 5.3 - t * 0.7 + causticUV.y * 3.9) *
                 cos(causticUV.y * 2.9 + t * 1.3 - causticUV.x * 2.1);
      caustic = (c1 * 0.6 + c2 * 0.4) * 0.5 + 0.5;
      caustic = smoothstep(0.3, 0.8, caustic);
      float depthFade = exp(-depth * 0.32);
      float focalFade = smoothstep(0.04, 0.5, depth);
      caustic *= depthFade * focalFade * uCausticsGain;
    }

    vec2 riverDir = normalize(vec2(vFlow.x, vFlow.y) + vec2(0.00001, 0.0));
    vec2 breezeDir = normalize(uLakeBreeze + vec2(0.00001, 0.0));
    float riverWeight = smoothstep(0.001, 0.02, vFlow.z);
    vec2 advectDir = normalize(mix(breezeDir, riverDir, riverWeight));
    float advectSpeed = max(length(uLakeBreeze), vFlow.z) * uRippleSpeed;
    float phaseA = fract(uTime * uRippleCycle);
    float phaseB = fract(uTime * uRippleCycle + 0.5);
    float blend = abs(phaseA - 0.5) * 2.0;
    vec2 advectA = advectDir * (phaseA * uRippleLoopDistance * advectSpeed);
    vec2 advectB = advectDir * (phaseB * uRippleLoopDistance * advectSpeed);
    vec2 gradA = rippleGrad(worldPos.xz * uRippleScaleA + advectA, phaseA);
    vec2 gradB = rippleGrad(worldPos.xz * uRippleScaleB + advectB + vec2(17.31, -9.47), phaseB);
    vec2 grad = mix(gradA, gradB, blend) * uRippleAmp;
    vec3 normal = normalize(vec3(-grad.x, 1.0, -grad.y));

    vec3 viewDir = normalize(uCameraPos - worldPos);
    vec3 sunDir = normalize(uSunDir);
    vec3 fresnelNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));
    float ndotv = max(dot(viewDir, fresnelNormal), 0.0);
    float fres = uFresnelBase + (1.0 - uFresnelBase) * pow(1.0 - ndotv, uFresnelPower);

    vec3 deepBlue = mix(vec3(0.0, 0.025, 0.10), uDeepColor, 0.65);
    vec3 shallowTeal = mix(uShallowColor, vec3(0.0, 0.45, 0.62), 0.35);
    vec3 waterColor = mix(shallowTeal, deepBlue, depthNorm);
    waterColor = mix(waterColor, shallowTeal, uTurbidity * (1.0 - depthNorm) * 0.50);
    waterColor += caustic * vec3(0.10, 0.18, 0.16);

    vec3 reflectDir = normalize(reflect(-viewDir, normal));
    vec3 envReflection = skyReflection(reflectDir, sunDir) * 0.88;

    float foamA1 = noise2(worldPos.xz * uFoamNoiseScale + advectA * 0.7);
    float foamB1 = noise2((worldPos.xz + vec2(3.71, 1.13)) * uFoamNoiseScale + advectB * 0.7);
    float foamA2 = noise2(worldPos.xz * uFoamNoiseScale * 0.37 + advectA * 0.41 + vec2(5.17, -3.29));
    float foamB2 = noise2((worldPos.xz + vec2(7.43, 2.81)) * uFoamNoiseScale * 0.37 + advectB * 0.41);
    float varNorm = sqrt(blend * blend + (1.0 - blend) * (1.0 - blend));
    float foamBlend = (mix(foamA1, foamB1, blend) - 0.5) / max(varNorm, 0.01) + 0.5;
    float foamDetail = (mix(foamA2, foamB2, blend) - 0.5) / max(varNorm, 0.01) + 0.5;
    float breakup = smoothstep(0.35, 0.82, foamBlend * 0.62 + foamDetail * 0.38);
    float wetFade = smoothstep(0.005, 0.05, depth) * vBodyMask;
    float shore = (1.0 - smoothstep(uShoreFoamStart, uShoreFoamEnd, depth)) * wetFade * breakup * uFoamShoreStrength;
    float riverFast = smoothstep(uFoamSpeedStart, uFoamSpeedEnd, vFlow.z);
    float riverDrop = smoothstep(uFoamDropStart, uFoamDropEnd, vFlow.w);
    float riverFoam = riverFast * riverDrop * uFoamRiverStrength * wetFade * (0.25 + 0.75 * breakup);
    float foam = clamp(shore + riverFoam, 0.0, 1.0);

    float backlit = pow(max(dot(viewDir, -sunDir), 0.0), 4.0) * 0.30;
    float crestScatter = smoothstep(0.45, 0.95, foamBlend) * 0.24;
    vec3 sss = mix(vec3(0.01, 0.04, 0.14), shallowTeal, 0.55) * (backlit + crestScatter) * (1.0 - depthNorm * 0.45);
    float specDot = max(dot(reflect(-sunDir, normal), viewDir), 0.0);
    vec3 sunSpec = vec3(1.0, 0.92, 0.76) * (pow(specDot, 384.0) * 1.15 + pow(specDot, 96.0) * 0.28);
    vec3 litWater = mix(waterColor + sss + sunSpec, envReflection, clamp(fres * 0.72, 0.0, 0.82));

    vec3 finalColor = mix(litWater, uFoamColor, foam);
    finalColor = mix(finalColor, waterLevelColor(vLevel), uClipmapTint * 0.18);
    float alpha = clamp(uAlpha + fres * 0.18, 0.0, 1.0);

    vec3 outCol;
    if (uDebugMode == 1) outCol = vec3(depthNorm);
    else if (uDebugMode == 2) outCol = vec3(foam);
    else if (uDebugMode == 3) outCol = vec3(fres);
    else if (uDebugMode == 4) outCol = vec3(vBodyMask);
    else if (uDebugMode == 5) outCol = waterLevelColor(vLevel);
    else if (uDebugMode == 6) outCol = vec3(riverDir * 0.5 + 0.5, clamp(vFlow.z / max(uFoamSpeedEnd, 0.001), 0.0, 1.0));
    else if (uDebugMode == 12) outCol = waterColor;
    else if (uDebugMode == 13) outCol = envReflection;
    else if (uDebugMode == 14) outCol = vec3(specDot);
    else outCol = finalColor;
    float outAlpha = uDebugMode == 0 ? alpha : 1.0;

    gl_FragColor = vec4(outCol, outAlpha);
  }
`;

export interface WaterUniforms {
  uTime: { value: number };
  uShallowColor: { value: THREE.Color };
  uDeepColor: { value: THREE.Color };
  uFoamColor: { value: THREE.Color };
  uAlpha: { value: number };
  uRippleCycle: { value: number };
  uFresnelPower: { value: number };
  uRippleAmp: { value: number };
  uRippleSpeed: { value: number };
  uRippleScaleA: { value: number };
  uRippleScaleB: { value: number };
  uRippleStrengthA: { value: number };
  uRippleStrengthB: { value: number };
  uRippleLoopDistance: { value: number };
  uLakeBreeze: { value: THREE.Vector2 };
  uShoreFoamStart: { value: number };
  uShoreFoamEnd: { value: number };
  uFoamNoiseScale: { value: number };
  uFoamShoreStrength: { value: number };
  uFoamRiverStrength: { value: number };
  uFoamSpeedStart: { value: number };
  uFoamSpeedEnd: { value: number };
  uFoamDropStart: { value: number };
  uFoamDropEnd: { value: number };
  uFresnelBase: { value: number };
  uFresnelNormalFlatten: { value: number };
  uDepthScale: { value: number };
  uTurbidity: { value: number };
  uClipmapTint: { value: number };
  uInnerRect: { value: THREE.Vector4 };
  uDebugMode: { value: number };
  uCameraPos: { value: THREE.Vector3 };
  uSunDir: { value: THREE.Vector3 };
  uWorldBounds: { value: THREE.Vector2 };
  uRefraction: WaterRefractionConfig;
  uReflection: WaterReflectionConfig;
  uCausticsEnabled: { value: number };
  uCausticsGain: { value: number };
  uCausticsScale: { value: number };
  uCausticsSpeed: { value: number };
}

export function makeWaterUniforms(params: WaterMaterialParams): WaterUniforms {
  const v = params.visual;
  return {
    uTime: { value: 0 },
    uShallowColor: { value: new THREE.Color(v.shallowColor[0], v.shallowColor[1], v.shallowColor[2]) },
    uDeepColor: { value: new THREE.Color(v.deepColor[0], v.deepColor[1], v.deepColor[2]) },
    uFoamColor: { value: new THREE.Color(v.foamColor[0], v.foamColor[1], v.foamColor[2]) },
    uAlpha: { value: v.alpha },
    uRippleCycle: { value: v.rippleCycle },
    uFresnelPower: { value: v.fresnel.power },
    uRippleAmp: { value: v.rippleAmp },
    uRippleSpeed: { value: v.rippleSpeed },
    uRippleScaleA: { value: v.rippleScaleA },
    uRippleScaleB: { value: v.rippleScaleB },
    uRippleStrengthA: { value: v.rippleStrengthA },
    uRippleStrengthB: { value: v.rippleStrengthB },
    uRippleLoopDistance: { value: v.rippleLoopDistance },
    uLakeBreeze: { value: new THREE.Vector2(v.lakeBreeze[0], v.lakeBreeze[1]) },
    uShoreFoamStart: { value: v.shoreFoamStart },
    uShoreFoamEnd: { value: v.shoreFoamEnd },
    uFoamNoiseScale: { value: v.foam.noiseScale },
    uFoamShoreStrength: { value: v.foam.shoreStrength },
    uFoamRiverStrength: { value: v.foam.riverStrength },
    uFoamSpeedStart: { value: v.foam.speedStart },
    uFoamSpeedEnd: { value: v.foam.speedEnd },
    uFoamDropStart: { value: v.foam.dropStart },
    uFoamDropEnd: { value: v.foam.dropEnd },
    uFresnelBase: { value: v.fresnel.base },
    uFresnelNormalFlatten: { value: v.fresnel.normalFlatten },
    uDepthScale: { value: v.color.depthScale },
    uTurbidity: { value: v.color.turbidity },
    uClipmapTint: { value: 0 },
    uInnerRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uDebugMode: { value: params.debugMode },
    uCameraPos: { value: params.cameraPosition.clone() },
    uSunDir: { value: params.sunDirection.clone().normalize() },
    uWorldBounds: { value: new THREE.Vector2(params.worldBounds.cellsX, params.worldBounds.cellsZ) },
    uRefraction: { ...v.refraction },
    uReflection: { ...v.reflection },
    uCausticsEnabled: { value: (params.caustics ?? DEFAULT_CAUSTICS_CONFIG).enabled ? 1 : 0 },
    uCausticsGain: { value: (params.caustics ?? DEFAULT_CAUSTICS_CONFIG).gain },
    uCausticsScale: { value: (params.caustics ?? DEFAULT_CAUSTICS_CONFIG).scale },
    uCausticsSpeed: { value: (params.caustics ?? DEFAULT_CAUSTICS_CONFIG).speed },
  };
}
