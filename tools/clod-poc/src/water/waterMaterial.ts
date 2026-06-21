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
import type { WaterDebugModeId, WaterVisualConfig } from "./waterConfig.js";

export interface WaterMaterialParams {
  visual: WaterVisualConfig;
  debugMode: WaterDebugModeId;
  sunDirection: THREE.Vector3;
  cameraPosition: THREE.Vector3;
}

export interface WaterMaterialHandle {
  material: THREE.Material;
  setTime(t: number): void;
  setDebugMode(mode: WaterDebugModeId): void;
  setInnerRect(minX: number, minZ: number, maxX: number, maxZ: number): void;
  setLevelId(level: number): void;
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
];

export function waterLevelColor(level: number): [number, number, number] {
  return LEVEL_PALETTE[Math.max(0, Math.min(LEVEL_PALETTE.length - 1, Math.floor(level)))];
}

const WATER_VERT = /* glsl */ `
  attribute float aTerrainY;
  attribute float aBodyMask;
  attribute vec3 aFlow;
  attribute float aLevel;
  varying vec3 vWorldPos;
  varying float vTerrainY;
  varying float vBodyMask;
  varying vec3 vFlow;
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
    int idx = int(clamp(floor(level), 0.0, 4.0));
    if (idx == 0) return vec3(0.36, 0.62, 0.95);
    if (idx == 1) return vec3(0.30, 0.86, 0.58);
    if (idx == 2) return vec3(0.94, 0.74, 0.30);
    if (idx == 3) return vec3(0.95, 0.42, 0.46);
    return vec3(0.66, 0.46, 0.94);
  }`;
}

const WATER_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uFoamColor;
  uniform float uAlpha;
  uniform float uFresnelPower;
  uniform float uRippleAmp;
  uniform float uRippleSpeed;
  uniform float uShoreFoamStart;
  uniform float uShoreFoamEnd;
  uniform float uMaxDepthForColor;
  uniform vec4 uInnerRect; // minX, minZ, maxX, maxZ
  uniform int uDebugMode;
  uniform vec3 uCameraPos;
  uniform vec3 uSunDir;
  varying vec3 vWorldPos;
  varying float vTerrainY;
  varying float vBodyMask;
  varying vec3 vFlow;
  varying float vLevel;

  ${levelColorGlsl()}

  void main() {
    vec3 worldPos = vWorldPos;
    if (worldPos.x > uInnerRect.x && worldPos.x < uInnerRect.z &&
        worldPos.z > uInnerRect.y && worldPos.z < uInnerRect.w) {
      discard;
    }
    float depth = worldPos.y - vTerrainY;
    if (depth <= 0.0) discard;
    float depthNorm = clamp(depth / uMaxDepthForColor, 0.0, 1.0);

    // Rivers bias ripple phase along their flow direction; lakes have flowSpeed 0
    // and fall back to the ambient time-driven breeze.
    vec2 flowDir = vec2(vFlow.x, vFlow.y);
    float flowPhase = dot(flowDir, worldPos.xz) * 0.15 * vFlow.z;
    float t = uTime * uRippleSpeed + flowPhase;
    float g1x = cos(worldPos.x * 0.18 + t * 1.3) * 0.18 + cos((worldPos.x + worldPos.z) * 0.13 + t * 0.7) * 0.13;
    float g1z = -sin(worldPos.z * 0.21 - t * 1.1) * 0.21 + cos((worldPos.x + worldPos.z) * 0.13 + t * 0.7) * 0.13;
    vec3 normal = normalize(vec3(-g1x, 1.0, -g1z));

    vec3 viewDir = normalize(uCameraPos - worldPos);
    float fres = pow(1.0 - max(dot(viewDir, normal), 0.0), uFresnelPower);
    vec3 waterColor = mix(uShallowColor, uDeepColor, depthNorm);
    vec3 sunDir = normalize(uSunDir);
    vec3 reflDir = reflect(-sunDir, normal);
    float spec = pow(max(dot(reflDir, viewDir), 0.0), 32.0);
    waterColor += spec * 0.15;

    float shore = 1.0 - smoothstep(uShoreFoamStart, uShoreFoamEnd, depth);
    vec3 finalColor = mix(waterColor, uFoamColor, shore * 0.6);
    float alpha = clamp(uAlpha + fres * 0.18, 0.0, 1.0);

    vec3 outCol;
    if (uDebugMode == 1) outCol = vec3(depthNorm);
    else if (uDebugMode == 2) outCol = vec3(shore);
    else if (uDebugMode == 3) outCol = vec3(fres);
    else if (uDebugMode == 4) outCol = vec3(vBodyMask);
    else if (uDebugMode == 5) outCol = waterLevelColor(vLevel);
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
  uFresnelPower: { value: number };
  uRippleAmp: { value: number };
  uRippleSpeed: { value: number };
  uShoreFoamStart: { value: number };
  uShoreFoamEnd: { value: number };
  uMaxDepthForColor: { value: number };
  uInnerRect: { value: THREE.Vector4 };
  uDebugMode: { value: number };
  uCameraPos: { value: THREE.Vector3 };
  uSunDir: { value: THREE.Vector3 };
}

export function makeWaterUniforms(params: WaterMaterialParams): WaterUniforms {
  const v = params.visual;
  return {
    uTime: { value: 0 },
    uShallowColor: { value: new THREE.Color(v.shallowColor[0], v.shallowColor[1], v.shallowColor[2]) },
    uDeepColor: { value: new THREE.Color(v.deepColor[0], v.deepColor[1], v.deepColor[2]) },
    uFoamColor: { value: new THREE.Color(v.foamColor[0], v.foamColor[1], v.foamColor[2]) },
    uAlpha: { value: v.alpha },
    uFresnelPower: { value: v.fresnelPower },
    uRippleAmp: { value: v.rippleAmp },
    uRippleSpeed: { value: v.rippleSpeed },
    uShoreFoamStart: { value: v.shoreFoamStart },
    uShoreFoamEnd: { value: v.shoreFoamEnd },
    uMaxDepthForColor: { value: v.maxDepthForColor },
    uInnerRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uDebugMode: { value: params.debugMode },
    uCameraPos: { value: params.cameraPosition.clone() },
    uSunDir: { value: params.sunDirection.clone().normalize() },
  };
}

export function applyWaterVisual(uniforms: WaterUniforms, v: WaterVisualConfig): void {
  uniforms.uShallowColor.value.setRGB(v.shallowColor[0], v.shallowColor[1], v.shallowColor[2]);
  uniforms.uDeepColor.value.setRGB(v.deepColor[0], v.deepColor[1], v.deepColor[2]);
  uniforms.uFoamColor.value.setRGB(v.foamColor[0], v.foamColor[1], v.foamColor[2]);
  uniforms.uAlpha.value = v.alpha;
  uniforms.uFresnelPower.value = v.fresnelPower;
  uniforms.uRippleAmp.value = v.rippleAmp;
  uniforms.uRippleSpeed.value = v.rippleSpeed;
  uniforms.uShoreFoamStart.value = v.shoreFoamStart;
  uniforms.uShoreFoamEnd.value = v.shoreFoamEnd;
  uniforms.uMaxDepthForColor.value = v.maxDepthForColor;
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
    depthWrite: params.visual.depthWrite,
    side: THREE.DoubleSide,
  });
  material.name = "water-shader";
  return {
    material,
    setTime: (t) => { uniforms.uTime.value = t; },
    setDebugMode: (mode) => { uniforms.uDebugMode.value = mode; },
    setInnerRect: (minX, minZ, maxX, maxZ) => { uniforms.uInnerRect.value.set(minX, minZ, maxX, maxZ); },
    setLevelId: () => { /* level carried per-vertex; uniform not used on GLSL path */ },
    updateCamera: (pos) => { uniforms.uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { uniforms.uSunDir.value.copy(dir).normalize(); },
    updateVisual: (v) => {
      applyWaterVisual(uniforms, v);
      material.depthWrite = v.depthWrite;
      material.needsUpdate = true;
    },
    dispose: () => { material.dispose(); },
  };
}
