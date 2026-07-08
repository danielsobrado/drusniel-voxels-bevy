import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { mix, positionGeometry, smoothstep, texture, uniform, vec2, vec3 } from "three/tsl";
import type { FarClipmapDebugMode } from "./far_clipmap_config.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;
type FarClipmapNodeUniform<T> = TslNode & { value: T };

const FAR_CLIPMAP_DEBUG_MODE_CODES: Record<FarClipmapDebugMode, number> = Object.freeze({
  final: 0,
  biome: 1,
  height: 2,
  ownership: 3,
});

const FAR_CLIPMAP_SHADER_RENDER_ORDER = 20;
const FAR_CLIPMAP_NODE_UNIFORMS = "farClipmapNodeUniforms";
const FAR_CLIPMAP_SOURCE_TEXTURE = "farClipmapSourceTexture";
const FAR_CLIPMAP_SOURCE_DATA = "farClipmapSourceData";
const FAR_CLIPMAP_DISPLACEMENT_MODE = "farClipmapDisplacementMode";

export interface FarClipmapMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
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

interface FarClipmapNodeUniforms {
  uRingOrigin: FarClipmapNodeUniform<THREE.Vector2>;
  uCellSize: FarClipmapNodeUniform<number>;
  uHeightScale: FarClipmapNodeUniform<number>;
  uYOffset: FarClipmapNodeUniform<number>;
  uSeaLevel: FarClipmapNodeUniform<number>;
  uDebugMode: FarClipmapNodeUniform<number>;
  uClipInnerRadius: FarClipmapNodeUniform<number>;
  uClipOuterRadius: FarClipmapNodeUniform<number>;
  uCameraXZ: FarClipmapNodeUniform<THREE.Vector2>;
  uGridMax: FarClipmapNodeUniform<number>;
}

export interface FarClipmapSourceTextureStats {
  fallbackSamples: number;
  exceptionSamples: number;
}

export type FarClipmapDisplacementMode = "shader" | "cpu-baked";

export type FarClipmapMaterial = THREE.Material & {
  uniforms?: FarClipmapMaterialUniforms;
};

const TERRAIN_SHADER_FUNCTIONS = `
float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    total += valueNoise(p) * amplitude;
    p *= 2.03;
    amplitude *= 0.5;
  }
  return total;
}

float farTerrainHeight(vec2 worldXZ) {
  vec2 p = worldXZ * 0.00225;
  float continent = fbm(p * 0.55) - 0.38;
  float hills = fbm(p * 4.0) * 28.0;
  float ridges = abs(fbm(p * 9.0) - 0.5) * 34.0;
  float coast = smoothstep(-0.08, 0.24, continent);
  return mix(-10.0, hills + ridges - 16.0, coast);
}

vec3 farTerrainBaseColor(float height, vec3 normal) {
  float slope = 1.0 - saturate(normal.y);
  if (height <= 0.25) return vec3(0.07, 0.18, 0.25);
  if (height < 4.0) return vec3(0.42, 0.36, 0.20);
  vec3 grass = vec3(0.20, 0.27, 0.18);
  vec3 rock = vec3(0.35, 0.34, 0.30);
  vec3 highland = vec3(0.32, 0.36, 0.24);
  vec3 color = mix(grass, rock, smoothstep(0.32, 0.72, slope));
  return mix(color, highland, smoothstep(56.0, 180.0, height) * 0.35);
}
`;

const VERTEX_SHADER = `
uniform vec2 uRingOrigin;
uniform float uCellSize;
uniform float uHeightScale;
uniform float uYOffset;
uniform vec2 uCameraXZ;

varying vec2 vWorldXZ;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vDistance;

${TERRAIN_SHADER_FUNCTIONS}

void main() {
  vec2 worldXZ = uRingOrigin + position.xz * uCellSize;
  float rawHeight = farTerrainHeight(worldXZ);
  float height = rawHeight * uHeightScale + uYOffset;

  float sampleStep = max(uCellSize, 1.0);
  float hL = farTerrainHeight(worldXZ - vec2(sampleStep, 0.0)) * uHeightScale + uYOffset;
  float hR = farTerrainHeight(worldXZ + vec2(sampleStep, 0.0)) * uHeightScale + uYOffset;
  float hD = farTerrainHeight(worldXZ - vec2(0.0, sampleStep)) * uHeightScale + uYOffset;
  float hU = farTerrainHeight(worldXZ + vec2(0.0, sampleStep)) * uHeightScale + uYOffset;
  vec3 dx = vec3(2.0 * sampleStep, hR - hL, 0.0);
  vec3 dz = vec3(0.0, hU - hD, 2.0 * sampleStep);

  vWorldXZ = worldXZ;
  vHeight = height;
  vDistance = length(worldXZ - uCameraXZ);
  vWorldNormal = normalize(cross(dz, dx));

  vec4 worldPosition = vec4(worldXZ.x, height, worldXZ.y, 1.0);
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
varying float vHeight;
varying float vDistance;

${TERRAIN_SHADER_FUNCTIONS}

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

  vec3 baseColor = farTerrainBaseColor(vHeight - uSeaLevel, normal);
  vec3 shadedColor = mix(baseColor, vec3(0.44, 0.43, 0.38), slope * 0.22);
  shadedColor = mix(shadedColor, vec3(0.42, 0.46, 0.33), elevation * 0.18);
  shadedColor *= ambientLight + directLight * 0.78;

  if (vHeight <= uSeaLevel + 0.25) {
    float waterDepthHint = saturate((uSeaLevel + 16.0 - vHeight) / 32.0);
    vec3 waterColor = mix(vec3(0.06, 0.16, 0.23), vec3(0.10, 0.28, 0.38), 1.0 - waterDepthHint);
    shadedColor = mix(shadedColor, waterColor, 0.72);
  }

  float horizonFog = smoothstep(uClipOuterRadius * 0.55, uClipOuterRadius, vDistance);
  shadedColor = mix(shadedColor, vec3(0.46, 0.52, 0.50), horizonFog * 0.36);

  if (uDebugMode == 1) {
    shadedColor = farTerrainBaseColor(vHeight - uSeaLevel, vec3(0.0, 1.0, 0.0));
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

function createFarClipmapUniforms(input: {
  debugMode: FarClipmapDebugMode;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX?: number;
  ringOriginZ?: number;
  cellSizeM?: number;
  heightScale?: number;
  yOffset?: number;
  cameraX?: number;
  cameraZ?: number;
}): FarClipmapMaterialUniforms {
  return {
    uRingOrigin: { value: new THREE.Vector2(input.ringOriginX ?? 0, input.ringOriginZ ?? 0) },
    uCellSize: { value: input.cellSizeM ?? 1 },
    uHeightScale: { value: input.heightScale ?? 1 },
    uYOffset: { value: input.yOffset ?? 0 },
    uSeaLevel: { value: input.seaLevel ?? 0 },
    uDebugMode: { value: farClipmapDebugModeCode(input.debugMode) },
    uClipInnerRadius: { value: input.clipInnerRadiusM },
    uClipOuterRadius: { value: input.clipOuterRadiusM },
    uCameraXZ: { value: new THREE.Vector2(input.cameraX ?? 0, input.cameraZ ?? 0) },
  };
}

function createFarClipmapNodeUniforms(input: {
  debugMode: FarClipmapDebugMode;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX?: number;
  ringOriginZ?: number;
  cellSizeM?: number;
  heightScale?: number;
  yOffset?: number;
  cameraX?: number;
  cameraZ?: number;
  gridResolution?: number;
}): FarClipmapNodeUniforms {
  const gridMax = Math.max(1, Math.floor(input.gridResolution ?? 2) - 1);
  return {
    uRingOrigin: uniform(new THREE.Vector2(input.ringOriginX ?? 0, input.ringOriginZ ?? 0)) as FarClipmapNodeUniform<THREE.Vector2>,
    uCellSize: uniform(input.cellSizeM ?? 1) as FarClipmapNodeUniform<number>,
    uHeightScale: uniform(input.heightScale ?? 1) as FarClipmapNodeUniform<number>,
    uYOffset: uniform(input.yOffset ?? 0) as FarClipmapNodeUniform<number>,
    uSeaLevel: uniform(input.seaLevel ?? 0) as FarClipmapNodeUniform<number>,
    uDebugMode: uniform(farClipmapDebugModeCode(input.debugMode)) as FarClipmapNodeUniform<number>,
    uClipInnerRadius: uniform(input.clipInnerRadiusM) as FarClipmapNodeUniform<number>,
    uClipOuterRadius: uniform(input.clipOuterRadiusM) as FarClipmapNodeUniform<number>,
    uCameraXZ: uniform(new THREE.Vector2(input.cameraX ?? 0, input.cameraZ ?? 0)) as FarClipmapNodeUniform<THREE.Vector2>,
    uGridMax: uniform(gridMax) as FarClipmapNodeUniform<number>,
  };
}

function farClipmapFallbackColor(mode: FarClipmapDebugMode): THREE.Color {
  if (mode === "biome") return new THREE.Color(0x3e5a30);
  if (mode === "height") return new THREE.Color(0x6f7568);
  if (mode === "ownership") return new THREE.Color(0x2d69c7);
  return new THREE.Color(0x33432f);
}

function createCpuBakedFarClipmapMaterial(input: { debugMode: FarClipmapDebugMode }): FarClipmapMaterial {
  const material = new THREE.MeshBasicMaterial({
    name: "FarClipmapTerrainCpuBakedFallback",
    color: farClipmapFallbackColor(input.debugMode),
    vertexColors: true,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    transparent: false,
    side: THREE.FrontSide,
    toneMapped: true,
  }) as FarClipmapMaterial;
  material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] = "cpu-baked" satisfies FarClipmapDisplacementMode;
  return material;
}

function createSourceTexture(gridResolution: number): THREE.DataTexture {
  const size = Math.max(2, Math.floor(gridResolution));
  const data = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 0;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 1;
    data[i * 4 + 3] = 0;
  }
  const sourceTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  sourceTexture.name = "FarClipmapSourceSummaryTexture";
  sourceTexture.minFilter = THREE.NearestFilter;
  sourceTexture.magFilter = THREE.NearestFilter;
  sourceTexture.wrapS = THREE.ClampToEdgeWrapping;
  sourceTexture.wrapT = THREE.ClampToEdgeWrapping;
  sourceTexture.needsUpdate = true;
  return sourceTexture;
}

function createWebGpuFarClipmapMaterial(input: {
  debugMode: FarClipmapDebugMode;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX?: number;
  ringOriginZ?: number;
  cellSizeM?: number;
  heightScale?: number;
  yOffset?: number;
  cameraX?: number;
  cameraZ?: number;
  gridResolution?: number;
}): FarClipmapMaterial {
  const gridResolution = Math.max(2, Math.floor(input.gridResolution ?? 2));
  const sourceTexture = createSourceTexture(gridResolution);
  const uniforms = createFarClipmapNodeUniforms({ ...input, gridResolution });
  const sampleUv: TslNode = positionGeometry.xz.div(uniforms.uGridMax);
  const sourceSample: TslNode = texture(sourceTexture, vec2(sampleUv.x, sampleUv.y));
  const rawHeight: TslNode = sourceSample.x;
  const height: TslNode = rawHeight.mul(uniforms.uHeightScale).add(uniforms.uYOffset);
  const worldXZ: TslNode = positionGeometry.xz.mul(uniforms.uCellSize).add(uniforms.uRingOrigin);
  const distance: TslNode = worldXZ.sub(uniforms.uCameraXZ).length();
  const localPosition: TslNode = vec3(
    positionGeometry.x.mul(uniforms.uCellSize),
    height,
    positionGeometry.z.mul(uniforms.uCellSize),
  );
  const heightColor: TslNode = smoothstep(-16.0, 128.0, height);
  const landColor: TslNode = mix(vec3(0.20, 0.27, 0.18), vec3(0.36, 0.35, 0.32), heightColor);
  const waterColor: TslNode = vec3(0.07, 0.19, 0.26);
  const terrainColor: TslNode = mix(waterColor, landColor, smoothstep(uniforms.uSeaLevel.sub(0.25), uniforms.uSeaLevel.add(0.25), height));
  const fog: TslNode = smoothstep(uniforms.uClipOuterRadius.mul(0.55), uniforms.uClipOuterRadius, distance);

  const material = new MeshBasicNodeMaterial() as FarClipmapMaterial & MeshBasicNodeMaterial;
  material.name = "FarClipmapTerrainNodeShader";
  material.positionNode = localPosition;
  material.colorNode = mix(terrainColor, vec3(0.46, 0.52, 0.50), fog.mul(0.36));
  material.maskNode = distance.greaterThanEqual(uniforms.uClipInnerRadius).and(distance.lessThanEqual(uniforms.uClipOuterRadius));
  material.depthWrite = true;
  material.depthTest = true;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.transparent = false;
  material.side = THREE.FrontSide;
  material.toneMapped = true;
  material.userData[FAR_CLIPMAP_NODE_UNIFORMS] = uniforms;
  material.userData[FAR_CLIPMAP_SOURCE_TEXTURE] = sourceTexture;
  material.userData[FAR_CLIPMAP_SOURCE_DATA] = sourceTexture.image.data;
  material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] = "shader" satisfies FarClipmapDisplacementMode;
  return material;
}

export function createFarClipmapMaterial(input: {
  debugMode: FarClipmapDebugMode;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX?: number;
  ringOriginZ?: number;
  cellSizeM?: number;
  heightScale?: number;
  yOffset?: number;
  cameraX?: number;
  cameraZ?: number;
  webGpuCompatible?: boolean;
  shaderDisplacement?: boolean;
  gridResolution?: number;
}): FarClipmapMaterial {
  if (input.shaderDisplacement === false) return createCpuBakedFarClipmapMaterial(input);
  if (input.webGpuCompatible === true) return createWebGpuFarClipmapMaterial(input);
  const material = new THREE.ShaderMaterial({
    name: "FarClipmapTerrainShader",
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: createFarClipmapUniforms(input),
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    transparent: false,
    side: THREE.FrontSide,
  }) as FarClipmapMaterial;
  material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] = "shader" satisfies FarClipmapDisplacementMode;
  return material;
}

export function farClipmapMaterialDisplacementMode(material: FarClipmapMaterial): FarClipmapDisplacementMode {
  return material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] === "cpu-baked" ? "cpu-baked" : "shader";
}

export function setFarClipmapMaterialDebugMode(material: FarClipmapMaterial, mode: FarClipmapDebugMode): void {
  const code = farClipmapDebugModeCode(mode);
  if (material.uniforms) material.uniforms.uDebugMode.value = code;
  const nodeUniforms = material.userData[FAR_CLIPMAP_NODE_UNIFORMS] as FarClipmapNodeUniforms | undefined;
  if (nodeUniforms) nodeUniforms.uDebugMode.value = code;
  if (material instanceof THREE.MeshBasicMaterial) material.color.copy(farClipmapFallbackColor(mode));
}

export function updateFarClipmapMaterialFrameUniforms(material: FarClipmapMaterial, input: {
  cameraX: number;
  cameraZ: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX: number;
  ringOriginZ: number;
  cellSizeM: number;
  heightScale: number;
  yOffset: number;
}): void {
  if (material.uniforms) {
    material.uniforms.uCameraXZ.value.set(input.cameraX, input.cameraZ);
    material.uniforms.uClipInnerRadius.value = input.clipInnerRadiusM;
    material.uniforms.uClipOuterRadius.value = input.clipOuterRadiusM;
    material.uniforms.uRingOrigin.value.set(input.ringOriginX, input.ringOriginZ);
    material.uniforms.uCellSize.value = input.cellSizeM;
    material.uniforms.uHeightScale.value = input.heightScale;
    material.uniforms.uYOffset.value = input.yOffset;
  }
  const nodeUniforms = material.userData[FAR_CLIPMAP_NODE_UNIFORMS] as FarClipmapNodeUniforms | undefined;
  if (nodeUniforms) {
    nodeUniforms.uCameraXZ.value.set(input.cameraX, input.cameraZ);
    nodeUniforms.uClipInnerRadius.value = input.clipInnerRadiusM;
    nodeUniforms.uClipOuterRadius.value = input.clipOuterRadiusM;
    nodeUniforms.uRingOrigin.value.set(input.ringOriginX, input.ringOriginZ);
    nodeUniforms.uCellSize.value = input.cellSizeM;
    nodeUniforms.uHeightScale.value = input.heightScale;
    nodeUniforms.uYOffset.value = input.yOffset;
  }
}

export function updateFarClipmapMaterialSourceTexture(material: FarClipmapMaterial, input: {
  source: FarClipmapSource;
  gridResolution: number;
  ringOriginX: number;
  ringOriginZ: number;
  cellSizeM: number;
  cameraX: number;
  cameraZ: number;
}): FarClipmapSourceTextureStats {
  const sourceTexture = material.userData[FAR_CLIPMAP_SOURCE_TEXTURE] as THREE.DataTexture | undefined;
  const data = material.userData[FAR_CLIPMAP_SOURCE_DATA] as Float32Array | undefined;
  if (!sourceTexture || !data) return { fallbackSamples: 0, exceptionSamples: 0 };

  const gridResolution = Math.max(2, Math.floor(input.gridResolution));
  let fallbackSamples = 0;
  let exceptionSamples = 0;
  const summary = { height: 0, normalX: 0, normalY: 1, normalZ: 0, material: 0, waterCoverage: 0 };
  for (let z = 0; z < gridResolution; z++) {
    for (let x = 0; x < gridResolution; x++) {
      const worldX = input.ringOriginX + x * input.cellSizeM;
      const worldZ = input.ringOriginZ + z * input.cellSizeM;
      const distanceM = Math.hypot(worldX - input.cameraX, worldZ - input.cameraZ);
      const offset = (z * gridResolution + x) * 4;
      try {
        const hasSummary = input.source.sampleSummaryInto?.(worldX, worldZ, distanceM, summary) === true;
        if (!hasSummary) fallbackSamples++;
        const height = hasSummary ? summary.height : input.source.sampleHeight(worldX, worldZ);
        const normal = hasSummary
          ? { x: summary.normalX, y: summary.normalY, z: summary.normalZ }
          : estimateNormal(input.source, worldX, worldZ, input.cellSizeM);
        data[offset] = finiteOr(height, 0);
        data[offset + 1] = finiteOr(normal.x, 0);
        data[offset + 2] = finiteOr(normal.y, 1);
        data[offset + 3] = finiteOr(normal.z, 0);
      } catch {
        exceptionSamples++;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 1;
        data[offset + 3] = 0;
      }
    }
  }
  sourceTexture.needsUpdate = true;
  return { fallbackSamples, exceptionSamples };
}

function estimateNormal(source: FarClipmapSource, x: number, z: number, cellSizeM: number): { x: number; y: number; z: number } {
  const step = Math.max(1, cellSizeM);
  const hL = source.sampleHeight(x - step, z);
  const hR = source.sampleHeight(x + step, z);
  const hD = source.sampleHeight(x, z - step);
  const hU = source.sampleHeight(x, z + step);
  const nx = hL - hR;
  const ny = 2 * step;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(len) || len <= 1e-10) return { x: 0, y: 1, z: 0 };
  return { x: nx / len, y: ny / len, z: nz / len };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
