// Water material for the fake CLOD-POC water clipmap.
//
// Two backends share one handle interface, mirroring the grass material split:
//   - createWaterShaderMaterial (here): GLSL ShaderMaterial for the WebGL fallback.
//   - createWaterNodeMaterial (./waterNodeMaterial.ts): TSL NodeMaterial for the
//     default WebGPU renderer. It is dynamically imported only on the WebGPU path
//     so the WebGL bundle never pulls in three/webgpu / three/tsl.
//
// The grid geometry's position attribute carries (worldX, waterY, worldZ) and the
// mesh is added at the scene origin (identity model transform), so local == world.
// Per-vertex aTerrainY / aBodyMask / aFlow / aLevel come from the WaterField CPU
// fill. Depth is (waterY - terrainY) per fragment, so no depth-buffer capture or
// terrain-noise port is required. Dry vertices (depth <= 0) and vertices inside
// the finer level's innerRect are discarded.
import * as THREE from "three";
import type { WaterDebugModeId, WaterRefractionConfig, WaterReflectionConfig, WaterVisualConfig } from "./waterConfig.js";
import type { CausticsConfig } from "./causticsConfig.js";
import { DEFAULT_CAUSTICS_CONFIG } from "./causticsConfig.js";

export interface WaterMaterialParams {
  visual: WaterVisualConfig;
  debugMode: WaterDebugModeId;
  sunDirection: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  worldBounds: { cellsX: number; cellsZ: number };
  caustics?: CausticsConfig;
}

export interface WaterMaterialHandle {
  material: THREE.Material;
  setTime(t: number): void;
  setDebugMode(mode: WaterDebugModeId): void;
  setInnerRect(minX: number, minZ: number, maxX: number, maxZ: number): void;
  setLevelId(level: number): void;
  setClipmapTint(enabled: boolean): void;
  setWireframe(enabled: boolean): void;
  updateCamera(pos: THREE.Vector3): void;
  updateSunDirection(dir: THREE.Vector3): void;
  updateVisual(visual: WaterVisualConfig): void;
  dispose(): void;
}

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

const WATER_VERT = /* glsl */ `
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
  return `
  vec3 waterLevelColor(float level) {
    int idx = int(clamp(floor(level), 0.0, 5.0));
    if (idx == 0) return vec3(0.36, 0.62, 0.95);
    if (idx == 1) return vec3(0.30, 0.86, 0.58);
    if (idx == 2) return vec3(0.94, 0.74, 0.30);
    if (idx == 3) return vec3(0.95, 0.42, 0.46);
    if (idx == 4) return vec3(0.66, 0.46, 0.94);
    return vec3(0.42, 0.78, 0.92);
  }`;
}

const WATER_FRAG = /* glsl */ `
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
  uniform vec4 uInnerRect; // minX, minZ, maxX, maxZ
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

  void main() {
    vec3 worldPos = vWorldPos;
    if (worldPos.x < 0.0 || worldPos.x > uWorldBounds.x ||
        worldPos.z < 0.0 || worldPos.z > uWorldBounds.y) {
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
    float depthNorm = clamp(depth / uDepthScale, 0.0, 1.0);

    // Procedural caustics: layered sine waves advected by flow, fading with depth.
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
    vec3 fresnelNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));
    float fres = uFresnelBase + (1.0 - uFresnelBase) * pow(1.0 - max(dot(viewDir, fresnelNormal), 0.0), uFresnelPower);
    vec3 waterColor = mix(uShallowColor, uDeepColor, depthNorm);
    waterColor = mix(waterColor, uShallowColor, uTurbidity * (1.0 - depthNorm) * 0.45);
    vec3 sunDir = normalize(uSunDir);
    vec3 reflDir = reflect(-sunDir, normal);
    float spec = pow(max(dot(reflDir, viewDir), 0.0), 32.0);
    waterColor += spec * 0.12 + fres * 0.08 + caustic * vec3(0.12, 0.18, 0.15);

    // Two-phase decorrelated foam (Fable5-style): two noise scales, each blended
    // across both phases, with variance renormalization to avoid flat midpoints.
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
    // Rapids: speed + per-vertex drop from aFlow.w (Fable5-style).
    // Only fast + steep water froths — a large calm river stays clear.
    float riverFast = smoothstep(uFoamSpeedStart, uFoamSpeedEnd, vFlow.z);
    float riverDrop = smoothstep(uFoamDropStart, uFoamDropEnd, vFlow.w);
    float riverFoam = riverFast * riverDrop * uFoamRiverStrength * wetFade * (0.25 + 0.75 * breakup);
    float foam = clamp(shore + riverFoam, 0.0, 1.0);
    vec3 finalColor = mix(waterColor, uFoamColor, foam);
    finalColor = mix(finalColor, waterLevelColor(vLevel), uClipmapTint * 0.18);
    float alpha = clamp(uAlpha + fres * 0.18, 0.0, 1.0);

    vec3 outCol;
    if (uDebugMode == 1) outCol = vec3(depthNorm);
    else if (uDebugMode == 2) outCol = vec3(foam);
    else if (uDebugMode == 3) outCol = vec3(fres);
    else if (uDebugMode == 4) outCol = vec3(vBodyMask);
    else if (uDebugMode == 5) outCol = waterLevelColor(vLevel);
    else if (uDebugMode == 6) outCol = vec3(riverDir * 0.5 + 0.5, clamp(vFlow.z / max(uFoamSpeedEnd, 0.001), 0.0, 1.0));
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
  uCaustics: CausticsConfig;
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
    uCaustics: { ...(params.caustics ?? DEFAULT_CAUSTICS_CONFIG) },
  };
}

export function applyWaterVisual(uniforms: WaterUniforms, v: WaterVisualConfig): void {
  uniforms.uShallowColor.value.setRGB(v.shallowColor[0], v.shallowColor[1], v.shallowColor[2]);
  uniforms.uDeepColor.value.setRGB(v.deepColor[0], v.deepColor[1], v.deepColor[2]);
  uniforms.uFoamColor.value.setRGB(v.foamColor[0], v.foamColor[1], v.foamColor[2]);
  uniforms.uAlpha.value = v.alpha;
  uniforms.uRippleCycle.value = v.rippleCycle;
  uniforms.uFresnelPower.value = v.fresnel.power;
  uniforms.uRippleAmp.value = v.rippleAmp;
  uniforms.uRippleSpeed.value = v.rippleSpeed;
  uniforms.uRippleScaleA.value = v.rippleScaleA;
  uniforms.uRippleScaleB.value = v.rippleScaleB;
  uniforms.uRippleStrengthA.value = v.rippleStrengthA;
  uniforms.uRippleStrengthB.value = v.rippleStrengthB;
  uniforms.uRippleLoopDistance.value = v.rippleLoopDistance;
  uniforms.uLakeBreeze.value.set(v.lakeBreeze[0], v.lakeBreeze[1]);
  uniforms.uShoreFoamStart.value = v.shoreFoamStart;
  uniforms.uShoreFoamEnd.value = v.shoreFoamEnd;
  uniforms.uFoamNoiseScale.value = v.foam.noiseScale;
  uniforms.uFoamShoreStrength.value = v.foam.shoreStrength;
  uniforms.uFoamRiverStrength.value = v.foam.riverStrength;
  uniforms.uFoamSpeedStart.value = v.foam.speedStart;
  uniforms.uFoamSpeedEnd.value = v.foam.speedEnd;
  uniforms.uFoamDropStart.value = v.foam.dropStart;
  uniforms.uFoamDropEnd.value = v.foam.dropEnd;
  uniforms.uFresnelBase.value = v.fresnel.base;
  uniforms.uFresnelNormalFlatten.value = v.fresnel.normalFlatten;
  uniforms.uDepthScale.value = v.color.depthScale;
  uniforms.uTurbidity.value = v.color.turbidity;
}

/** WebGL fallback material (GLSL ShaderMaterial). */
export function createWaterShaderMaterial(params: WaterMaterialParams): WaterMaterialHandle {
  const uniforms = makeWaterUniforms(params);
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as THREE.ShaderMaterial["uniforms"],
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.name = "water-shader";
  return {
    material,
    setTime: (t) => { uniforms.uTime.value = t; },
    setDebugMode: (mode) => { uniforms.uDebugMode.value = mode; },
    setInnerRect: (minX, minZ, maxX, maxZ) => { uniforms.uInnerRect.value.set(minX, minZ, maxX, maxZ); },
    setLevelId: () => { /* level carried per-vertex; uniform not used on GLSL path */ },
    setClipmapTint: (enabled) => { uniforms.uClipmapTint.value = enabled ? 1 : 0; },
    setWireframe: (enabled) => { material.wireframe = enabled; },
    updateCamera: (pos) => { uniforms.uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { uniforms.uSunDir.value.copy(dir).normalize(); },
    updateVisual: (v) => {
      applyWaterVisual(uniforms, v);
      material.depthWrite = false;
      material.needsUpdate = true;
    },
    dispose: () => { material.dispose(); },
  };
}
