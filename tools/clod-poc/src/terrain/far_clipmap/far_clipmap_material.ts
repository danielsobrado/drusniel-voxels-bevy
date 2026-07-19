import * as THREE from "three";
import { MeshBasicNodeMaterial, StorageBufferAttribute } from "three/webgpu";
import { max, mix, positionGeometry, select, smoothstep, storage, uniform, varying, vec2, vec3 } from "three/tsl";
import type { FarClipmapDebugMode } from "./far_clipmap_config.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";
import { getActiveWebGpuRendererContext } from "../../rendering/webgpu_renderer_context.js";
import { GRASS_SHARED_BASE_LINEAR } from "../../grass/grass_palette.js";
import { DEFAULT_TERRAIN_NODE_LIGHTING } from "../../gpu/terrain_node_material.js";
import {
  getTerrainLayerAverageAlbedo,
  terrainLayerAverageAlbedoRevision,
} from "../../textures/terrain_layer_average_albedo.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;
type FarClipmapNodeUniform<T> = TslNode & { value: T };

const tslMix = mix as unknown as (...args: TslNode[]) => TslNode;
const tslSmoothstep = smoothstep as unknown as (...args: TslNode[]) => TslNode;
const tslVec2 = vec2 as unknown as (...args: TslNode[]) => TslNode;
const tslVec3 = vec3 as unknown as (...args: TslNode[]) => TslNode;
const tslSelect = select as unknown as (...args: TslNode[]) => TslNode;

function tslHash21(p: TslNode): TslNode {
  return p.dot(tslVec2(127.1, 311.7)).sin().mul(43758.5453).fract();
}

function tslValueNoise(p: TslNode): TslNode {
  const cell: TslNode = p.floor();
  const f: TslNode = p.fract();
  const u: TslNode = f.mul(f).mul(f.mul(-2.0).add(3.0));
  const a: TslNode = tslHash21(cell);
  const b: TslNode = tslHash21(cell.add(tslVec2(1.0, 0.0)));
  const c: TslNode = tslHash21(cell.add(tslVec2(0.0, 1.0)));
  const d: TslNode = tslHash21(cell.add(tslVec2(1.0, 1.0)));
  return tslMix(tslMix(a, b, u.x), tslMix(c, d, u.x), u.y);
}

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
const FAR_CLIPMAP_WATER_TEXTURE = "farClipmapWaterTexture";
const FAR_CLIPMAP_WATER_DATA = "farClipmapWaterData";
const FAR_CLIPMAP_SOURCE_STORAGE = "farClipmapSourceStorage";
const FAR_CLIPMAP_WATER_STORAGE = "farClipmapWaterStorage";
const FAR_CLIPMAP_OWNERSHIP_DATA = "farClipmapOwnershipData";
const FAR_CLIPMAP_OWNERSHIP_STORAGE = "farClipmapOwnershipStorage";
const FAR_CLIPMAP_DISPLACEMENT_MODE = "farClipmapDisplacementMode";
const FAR_CLIPMAP_PALETTE_UNIFORMS = "farClipmapPaletteUniforms";
const FAR_CLIPMAP_PALETTE_REVISION = "farClipmapPaletteRevision";

// Land palette slots resolved from the near-terrain texture layers, keyed by biome
// material id order (meadows, forest, swamp, mountain, plains, coast) plus the
// elevation-band layers shared across biomes.
const FAR_CLIPMAP_PALETTE_LAYERS = {
  uGroundMeadow: "meadows-ground",
  uGroundForest: "forest-floor",
  uGroundSwamp: "swamp-muck",
  uGroundMountain: "mountain-scree",
  uGroundPlains: "plains-grass",
  uGroundCoast: "coast-sand",
  uSand: "sand",
  uDirt: "dirt",
  uRock: "rock",
  uSnow: "snow",
} as const;

type FarClipmapPaletteUniforms = Record<keyof typeof FAR_CLIPMAP_PALETTE_LAYERS, FarClipmapNodeUniform<THREE.Vector3>> & {
  uExposure: FarClipmapNodeUniform<number>;
};

const FAR_CLIPMAP_LIGHTING_UNIFORMS = "farClipmapLightingUniforms";

export interface FarClipmapLighting {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

interface FarClipmapLightingUniforms {
  uSunDirection: FarClipmapNodeUniform<THREE.Vector3>;
  uSunColor: FarClipmapNodeUniform<THREE.Color>;
  uSkyLight: FarClipmapNodeUniform<THREE.Color>;
  uGroundLight: FarClipmapNodeUniform<THREE.Color>;
}

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
  vec3 grass = vec3(${GRASS_SHARED_BASE_LINEAR.join(", ")});
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

function createFarClipmapPaletteUniforms(): FarClipmapPaletteUniforms {
  const entries = Object.entries(FAR_CLIPMAP_PALETTE_LAYERS).map(([key, layerId]) => {
    const [r, g, b] = getTerrainLayerAverageAlbedo(layerId);
    return [key, uniform(new THREE.Vector3(r, g, b))];
  });
  return {
    ...Object.fromEntries(entries),
    uExposure: uniform(1.0),
  } as FarClipmapPaletteUniforms;
}

function createFarClipmapLightingUniforms(): FarClipmapLightingUniforms {
  const rig = DEFAULT_TERRAIN_NODE_LIGHTING;
  return {
    uSunDirection: uniform(rig.lightDir.clone().normalize()) as FarClipmapNodeUniform<THREE.Vector3>,
    uSunColor: uniform(rig.sunColor.clone()) as FarClipmapNodeUniform<THREE.Color>,
    uSkyLight: uniform(rig.skyLight.clone()) as FarClipmapNodeUniform<THREE.Color>,
    uGroundLight: uniform(rig.groundLight.clone()) as FarClipmapNodeUniform<THREE.Color>,
  };
}

/** Tracks the live environment lighting so the far clipmap and the near CLOD
 *  pages are lit by the same sun/sky/ground rig across the ownership seam. */
export function setFarClipmapMaterialLighting(material: FarClipmapMaterial, lighting: FarClipmapLighting): void {
  const uniforms = material.userData[FAR_CLIPMAP_LIGHTING_UNIFORMS] as FarClipmapLightingUniforms | undefined;
  if (!uniforms) return;
  uniforms.uSunDirection.value.copy(lighting.sunDirection).normalize();
  uniforms.uSunColor.value.copy(lighting.sunColor);
  uniforms.uSkyLight.value.copy(lighting.skyLight);
  uniforms.uGroundLight.value.copy(lighting.groundLight);
}

/** Re-resolves the palette uniforms after a texture re-bake so the far clipmap
 *  keeps matching the near-terrain layers. Cheap no-op while the revision holds. */
export function refreshFarClipmapMaterialPalette(material: FarClipmapMaterial): void {
  const palette = material.userData[FAR_CLIPMAP_PALETTE_UNIFORMS] as FarClipmapPaletteUniforms | undefined;
  if (!palette) return;
  const revision = terrainLayerAverageAlbedoRevision();
  if (material.userData[FAR_CLIPMAP_PALETTE_REVISION] === revision) return;
  material.userData[FAR_CLIPMAP_PALETTE_REVISION] = revision;
  for (const [key, layerId] of Object.entries(FAR_CLIPMAP_PALETTE_LAYERS)) {
    const [r, g, b] = getTerrainLayerAverageAlbedo(layerId);
    palette[key as keyof typeof FAR_CLIPMAP_PALETTE_LAYERS].value.set(r, g, b);
  }
}

function farClipmapFallbackColor(mode: FarClipmapDebugMode): THREE.Color {
  if (mode === "biome") return new THREE.Color(0x3e5a30);
  if (mode === "height") return new THREE.Color(0x6f7568);
  if (mode === "ownership") return new THREE.Color(0x2d69c7);
  return new THREE.Color(0x33432f);
}

// The CPU-baked path (farClipmapShaderDisplacement=0) is a fallback / no-WebGPU path only. It is
// rendered as a flat, unlit debug ring — a single tint, not the per-vertex terrain colouring —
// so it reads unmistakably as a placeholder and never masquerades as the shipping far terrain
// (which is the GPU shader-displacement path). Flat colour also removes the coarse-grid vertex-
// colour "blockiness"; DoubleSide stops grazing/underside angles from showing black through it.
function createCpuBakedFarClipmapMaterial(input: { debugMode: FarClipmapDebugMode }): FarClipmapMaterial {
  const material = new THREE.MeshBasicMaterial({
    name: "FarClipmapTerrainCpuBakedFallback",
    color: farClipmapFallbackColor(input.debugMode),
    vertexColors: false,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    transparent: false,
    side: THREE.DoubleSide,
    toneMapped: true,
  }) as FarClipmapMaterial;
  material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] = "cpu-baked" satisfies FarClipmapDisplacementMode;
  return material;
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
  const sourceData = new Float32Array(gridResolution * gridResolution * 4);
  const waterData = new Float32Array(gridResolution * gridResolution * 4);
  const ownershipData = new Float32Array(gridResolution * gridResolution);
  const sourceStorage = new StorageBufferAttribute(sourceData, 4);
  const waterStorage = new StorageBufferAttribute(waterData, 4);
  const ownershipStorage = new StorageBufferAttribute(ownershipData, 1);
  const uniforms = createFarClipmapNodeUniforms({ ...input, gridResolution });
  const sampleIndex: TslNode = positionGeometry.z.mul(gridResolution).add(positionGeometry.x);
  const sourceSample: TslNode = varying(storage(sourceStorage, "vec4", gridResolution * gridResolution).toReadOnly().element(sampleIndex));
  const waterSample: TslNode = varying(storage(waterStorage, "vec4", gridResolution * gridResolution).toReadOnly().element(sampleIndex));
  const ownershipSample: TslNode = varying(storage(ownershipStorage, "float", gridResolution * gridResolution).toReadOnly().element(sampleIndex));
  const rawHeight: TslNode = sourceSample.x;
  const terrainHeight: TslNode = rawHeight.mul(uniforms.uHeightScale).add(uniforms.uYOffset);
  const unifiedChannels: TslNode = tslSmoothstep(-0.5, 0.0, waterSample.w);
  const waterCoverage: TslNode = max(0.0, waterSample.w);
  const waterDepthMask: TslNode = tslSmoothstep(0.02, 0.18, waterSample.x.sub(rawHeight));
  const waterMask: TslNode = tslSmoothstep(0.04, 0.35, waterCoverage)
    .mul(unifiedChannels)
    .mul(waterDepthMask);
  const waterHeight: TslNode = waterSample.x.mul(uniforms.uHeightScale).add(uniforms.uYOffset).add(0.18);
  const height: TslNode = tslMix(terrainHeight, waterHeight, waterMask);
  const worldXZ: TslNode = positionGeometry.xz.mul(uniforms.uCellSize).add(uniforms.uRingOrigin);
  const distance: TslNode = worldXZ.sub(uniforms.uCameraXZ).length();
  const localPosition: TslNode = tslVec3(
    positionGeometry.x.mul(uniforms.uCellSize),
    height,
    positionGeometry.z.mul(uniforms.uCellSize),
  );
  const materialId: TslNode = sourceSample.w;
  const normalX: TslNode = sourceSample.y;
  const normalZ: TslNode = sourceSample.z;
  const normalY: TslNode = max(0.0, normalX.mul(normalX).add(normalZ.mul(normalZ)).oneMinus()).sqrt();
  const sourceNormal: TslNode = tslVec3(normalX, normalY, normalZ).normalize();
  const palette = createFarClipmapPaletteUniforms();
  // Per-vertex value noise (interpolated across the coarse grid) breaks the
  // elevation bands' contour striping without any per-fragment noise cost.
  const bandNoise: TslNode = varying(tslValueNoise(worldXZ.mul(0.011)));
  const tintNoise: TslNode = varying(tslValueNoise(worldXZ.mul(0.0023).add(37.7)));
  const biomeColor: TslNode = tslMix(
    tslMix(
      tslMix(
        tslMix(
          tslMix(palette.uGroundMeadow, palette.uGroundForest, tslSmoothstep(0.15, 0.85, materialId)),
          palette.uGroundSwamp,
          tslSmoothstep(1.15, 1.85, materialId),
        ),
        palette.uGroundMountain,
        tslSmoothstep(2.15, 2.85, materialId),
      ),
      palette.uGroundPlains,
      tslSmoothstep(3.15, 3.85, materialId),
    ),
    palette.uGroundCoast,
    tslSmoothstep(4.15, 4.85, materialId),
  );
  // Elevation bands mirror the near-terrain texture layer ranges (layerRanges in
  // terrainTextureArrays: sand<24, ground 22-66, rock 58-106, snow 86-132, absolute Y)
  // so the far palette hands off to the textured pages without a colour step.
  const bandHeight: TslNode = terrainHeight.add(bandNoise.sub(0.5).mul(12.0));
  // Beach stays a narrow ring like the near sand layer (fades out by ~24 m); the
  // lowland above it is dirt+grass like the vegetated near ground, with the biome
  // colour only as a tint so coast/plains ids cannot repaint whole islands yellow.
  const sandBand: TslNode = tslSmoothstep(20.0, 26.0, bandHeight).oneMinus();
  const slopeRock: TslNode = tslSmoothstep(0.10, 0.46, normalY.oneMinus());
  const rockBand: TslNode = max(tslSmoothstep(58.0, 96.0, bandHeight), slopeRock);
  const snowBand: TslNode = tslSmoothstep(86.0, 132.0, bandHeight).mul(tslSmoothstep(0.58, 0.92, normalY));
  // Calibrated against near-render seam pixels: the visible near ground at 24-58 m
  // resolves to a neutral dirt/rock brown (wet/moss tinting mutes the raw layers), so
  // the biome hue only contributes a quarter of the lowland colour.
  const lowland: TslNode = tslMix(tslMix(palette.uDirt, palette.uRock, 0.5), biomeColor, 0.25);
  const groundAlbedo: TslNode = tslMix(tslMix(lowland, palette.uSand, sandBand), palette.uRock, rockBand);
  const landAlbedo: TslNode = tslMix(groundAlbedo, palette.uSnow, snowBand);
  // Same lighting rig as the near CLOD terrain (terrain_node_material): hemisphere
  // ground->sky by upness plus sun with the near falloff exponent. The uniforms track
  // the live EnvironmentLighting via setFarClipmapMaterialLighting so both sides of
  // the ownership seam are lit by the same sun.
  const lighting = createFarClipmapLightingUniforms();
  const directLight: TslNode = max(0.0, sourceNormal.dot(lighting.uSunDirection));
  const hemiLight: TslNode = tslMix(lighting.uGroundLight, lighting.uSkyLight, normalY.mul(0.5).add(0.5));
  const terrainLight: TslNode = hemiLight.add(lighting.uSunColor.mul(directLight.pow(1.35)));
  const tintVariation: TslNode = tintNoise.sub(0.5).mul(0.16).add(1.0);
  const landColor: TslNode = landAlbedo.mul(terrainLight).mul(tintVariation).mul(palette.uExposure);
  // Distance fog is applied once in the shared post-process path so refined CLOD and
  // clipmap terrain cross the same haze field instead of exposing a material boundary.
  const waterDepth: TslNode = waterSample.x.sub(rawHeight);
  const waterBodyColor: TslNode = tslMix(
    tslVec3(0.10, 0.30, 0.34),
    tslVec3(0.055, 0.13, 0.24),
    tslSmoothstep(0.4, 6.0, waterDepth),
  );
  const finalColor: TslNode = tslMix(landColor, waterBodyColor, waterMask);
  // Debug-mode codes mirror the WebGL fragment shader: 1=biome, 2=height, 3=ownership.
  // Ownership colours the per-cell mask directly (amber = far clipmap owns as fallback,
  // blue = refined pages own) so the sector hand-off is provable from a capture.
  const heightShade: TslNode = terrainHeight.add(64.0).div(256.0).clamp(0.0, 1.0);
  const ownershipDebugColor: TslNode = tslSelect(
    ownershipSample.greaterThan(0.5),
    tslVec3(1.0, 0.82, 0.18),
    tslVec3(0.05, 0.35, 0.95),
  );
  const debugMode: TslNode = uniforms.uDebugMode;

  const material = new MeshBasicNodeMaterial() as FarClipmapMaterial & MeshBasicNodeMaterial;
  material.name = "FarClipmapTerrainNodeShader";
  material.positionNode = localPosition;
  material.colorNode = tslSelect(
    debugMode.greaterThan(2.5),
    ownershipDebugColor,
    tslSelect(
      debugMode.greaterThan(1.5),
      tslVec3(heightShade, heightShade, heightShade),
      tslSelect(debugMode.greaterThan(0.5), biomeColor, finalColor),
    ),
  );
  material.maskNode = distance.lessThanEqual(uniforms.uClipOuterRadius).and(
    distance.greaterThanEqual(uniforms.uClipInnerRadius).or(ownershipSample.greaterThan(0.5)),
  );
  material.depthWrite = true;
  material.depthTest = true;
  // Positive offset pushes the clipmap behind coincident geometry: with real heights in
  // the ownership-fallback band it sits at the same depth as ready CLOD pages, and a
  // negative bias would overdraw them; the hand-off must land under the refined pages.
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;
  material.transparent = false;
  // DoubleSide: far terrain is a thin displaced sheet; single-sided rendering lets grazing/underside
  // camera angles see straight through it to the clear colour (the "black under-terrain" artifact).
  material.side = THREE.DoubleSide;
  material.toneMapped = true;
  material.userData[FAR_CLIPMAP_NODE_UNIFORMS] = uniforms;
  material.userData[FAR_CLIPMAP_SOURCE_DATA] = sourceData;
  material.userData[FAR_CLIPMAP_WATER_DATA] = waterData;
  material.userData[FAR_CLIPMAP_SOURCE_STORAGE] = sourceStorage;
  material.userData[FAR_CLIPMAP_WATER_STORAGE] = waterStorage;
  material.userData[FAR_CLIPMAP_OWNERSHIP_DATA] = ownershipData;
  material.userData[FAR_CLIPMAP_OWNERSHIP_STORAGE] = ownershipStorage;
  material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] = "shader" satisfies FarClipmapDisplacementMode;
  material.userData[FAR_CLIPMAP_PALETTE_UNIFORMS] = palette;
  material.userData[FAR_CLIPMAP_PALETTE_REVISION] = terrainLayerAverageAlbedoRevision();
  material.userData[FAR_CLIPMAP_LIGHTING_UNIFORMS] = lighting;
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
    side: THREE.DoubleSide,
  }) as unknown as FarClipmapMaterial;
  material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] = "shader" satisfies FarClipmapDisplacementMode;
  return material;
}

export function farClipmapMaterialDisplacementMode(material: FarClipmapMaterial): FarClipmapDisplacementMode {
  return material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] === "cpu-baked" ? "cpu-baked" : "shader";
}

export function disposeFarClipmapMaterialSourceTextures(material: FarClipmapMaterial): void {
  (material.userData[FAR_CLIPMAP_SOURCE_TEXTURE] as THREE.DataTexture | undefined)?.dispose();
  (material.userData[FAR_CLIPMAP_WATER_TEXTURE] as THREE.DataTexture | undefined)?.dispose();
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
  refreshFarClipmapMaterialPalette(material);
}

function normalizedRefinedPageCoords(keys: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const [levelText, coordText] = key.split(":");
    const [xText, zText] = (coordText ?? "").split(",");
    const level = Number(levelText?.startsWith("L") ? levelText.slice(1) : levelText);
    const x = Number(xText);
    const z = Number(zText);
    if (level === 0 && Number.isInteger(x) && Number.isInteger(z)) out.add(`${x},${z}`);
  }
  return out;
}

export function updateFarClipmapMaterialOwnershipMask(material: FarClipmapMaterial, input: {
  gridResolution: number;
  ringOriginX: number;
  ringOriginZ: number;
  cellSizeM: number;
  centerX: number;
  centerZ: number;
  innerRadiusM: number;
  outerRadiusM: number;
  pageSizeM: number;
  readyPageKeys: readonly string[];
} | null): number {
  const data = material.userData[FAR_CLIPMAP_OWNERSHIP_DATA] as Float32Array | undefined;
  const ownershipStorage = material.userData[FAR_CLIPMAP_OWNERSHIP_STORAGE] as StorageBufferAttribute | undefined;
  if (!data || !ownershipStorage) return 0;
  data.fill(0);
  if (!input) {
    ownershipStorage.needsUpdate = true;
    return 0;
  }
  const resolution = Math.max(2, Math.floor(input.gridResolution));
  const pageSizeM = Math.max(1, input.pageSizeM);
  const refinedReady = normalizedRefinedPageCoords(input.readyPageKeys);
  const fallbackOwnsPoint = (worldX: number, worldZ: number): boolean => {
    const distanceM = Math.hypot(worldX - input.centerX, worldZ - input.centerZ);
    if (distanceM < input.innerRadiusM || distanceM >= input.outerRadiusM) return false;
    const px = Math.floor(worldX / pageSizeM);
    const pz = Math.floor(worldZ / pageSizeM);
    return !refinedReady.has(`${px},${pz}`);
  };
  let fallbackVertices = 0;
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const worldX = input.ringOriginX + x * input.cellSizeM;
      const worldZ = input.ringOriginZ + z * input.cellSizeM;
      let fallbackOwned = false;
      // Ownership is interpolated across the coarse clipmap triangle. Dilate the missing-page
      // complement by one grid cell so the interpolation transition lands under ready CLOD
      // geometry instead of cutting a triangular hole at the exact page boundary.
      for (let oz = -1; oz <= 1 && !fallbackOwned; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (fallbackOwnsPoint(worldX + ox * input.cellSizeM, worldZ + oz * input.cellSizeM)) {
            fallbackOwned = true;
            break;
          }
        }
      }
      if (!fallbackOwned) continue;
      data[z * resolution + x] = 1;
      fallbackVertices++;
    }
  }
  ownershipStorage.needsUpdate = true;
  return fallbackVertices;
}

export function updateFarClipmapMaterialSourceTexture(material: FarClipmapMaterial, input: {
  source: FarClipmapSource;
  gridResolution: number;
  ringOriginX: number;
  ringOriginZ: number;
  cellSizeM: number;
  cameraX: number;
  cameraZ: number;
  clipInnerRadiusM?: number;
  clipOuterRadiusM?: number;
  /** When set, cells without summary tiles that sample below this height become open ocean
   *  (deep-ocean tiles are never built, so without this the horizon renders as dry sea floor). */
  seaLevelM?: number;
  /** Sample cells inside the inner clip radius instead of zeroing them. Required when the
   *  refined-ownership fallback renders there: zeroed cells otherwise draw as a flat
   *  height-0 shelf under missing CLOD pages (the visible near->far seam). */
  includeInnerRadius?: boolean;
  deferUpload?: boolean;
}): FarClipmapSourceTextureStats {
  const sourceTexture = material.userData[FAR_CLIPMAP_SOURCE_TEXTURE] as THREE.DataTexture | undefined;
  const data = material.userData[FAR_CLIPMAP_SOURCE_DATA] as Float32Array | undefined;
  const waterTexture = material.userData[FAR_CLIPMAP_WATER_TEXTURE] as THREE.DataTexture | undefined;
  const waterData = material.userData[FAR_CLIPMAP_WATER_DATA] as Float32Array | undefined;
  const sourceStorage = material.userData[FAR_CLIPMAP_SOURCE_STORAGE] as StorageBufferAttribute | undefined;
  const waterStorage = material.userData[FAR_CLIPMAP_WATER_STORAGE] as StorageBufferAttribute | undefined;
  if (!data || !waterData || (!sourceTexture && !sourceStorage) || (!waterTexture && !waterStorage)) {
    return { fallbackSamples: 0, exceptionSamples: 0 };
  }

  const gridResolution = Math.max(2, Math.floor(input.gridResolution));
  let fallbackSamples = 0;
  let exceptionSamples = 0;
  const summary = {
    height: 0, normalX: 0, normalY: 1, normalZ: 0, material: 0,
    waterCoverage: 0, waterLevel: 0, bodyKind: 0, shoreDistance: 0,
    unifiedChannels: false,
  };
  for (let z = 0; z < gridResolution; z++) {
    for (let x = 0; x < gridResolution; x++) {
      const worldX = input.ringOriginX + x * input.cellSizeM;
      const worldZ = input.ringOriginZ + z * input.cellSizeM;
      const distanceM = Math.hypot(worldX - input.cameraX, worldZ - input.cameraZ);
      const offset = (z * gridResolution + x) * 4;
      const outsideInnerRadius = input.includeInnerRadius !== true
        && input.clipInnerRadiusM !== undefined
        && distanceM + input.cellSizeM < input.clipInnerRadiusM;
      const outsideOuterRadius = input.clipOuterRadiusM !== undefined
        && distanceM > input.clipOuterRadiusM + input.cellSizeM;
      if (outsideInnerRadius || outsideOuterRadius) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        waterData[offset] = 0;
        waterData[offset + 1] = 0;
        waterData[offset + 2] = 0;
        waterData[offset + 3] = -1;
        continue;
      }
      try {
        const hasSummary = input.source.sampleSummaryInto?.(worldX, worldZ, distanceM, summary) === true;
        if (!hasSummary) fallbackSamples++;
        const height = hasSummary ? summary.height : input.source.sampleHeight(worldX, worldZ);
        const normal = hasSummary
          ? { x: summary.normalX, y: summary.normalY, z: summary.normalZ }
          : estimateNormal(input.source, worldX, worldZ, input.cellSizeM);
        // Inside the inner radius the clipmap only backfills missing CLOD pages; sink it
        // below the true surface so any page that did render wins the depth test even
        // where the coarse grid would interpolate above the fine geometry. The sink fades
        // out across one cell at the boundary so the owned band beyond stays exact.
        let renderHeight = height;
        if (input.includeInnerRadius === true && input.clipInnerRadiusM !== undefined && distanceM < input.clipInnerRadiusM) {
          const sink = Math.min(1, (input.clipInnerRadiusM - distanceM) / Math.max(input.cellSizeM, 1));
          renderHeight = height - 4 * sink;
        }
        data[offset] = finiteOr(renderHeight, 0);
        data[offset + 1] = finiteOr(normal.x, 0);
        data[offset + 2] = finiteOr(normal.z, 0);
        data[offset + 3] = finiteOr(hasSummary ? summary.material : input.source.sampleMaterial(worldX, worldZ), 0);
        const oceanFallback = !hasSummary
          && input.seaLevelM !== undefined
          && Number.isFinite(height)
          && height < input.seaLevelM;
        if (oceanFallback) {
          waterData[offset] = input.seaLevelM!;
          waterData[offset + 1] = 1;
          waterData[offset + 2] = 96;
          waterData[offset + 3] = 1;
        } else {
          waterData[offset] = finiteOr(hasSummary ? summary.waterLevel : height, height);
          waterData[offset + 1] = finiteOr(hasSummary ? summary.bodyKind : 0, 0);
          waterData[offset + 2] = finiteOr(hasSummary ? summary.shoreDistance : 0, 0);
          waterData[offset + 3] = hasSummary && summary.unifiedChannels === true
            ? finiteOr(summary.waterCoverage, 0)
            : -1;
        }
      } catch {
        exceptionSamples++;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        waterData[offset] = 0;
        waterData[offset + 1] = 0;
        waterData[offset + 2] = 0;
        waterData[offset + 3] = -1;
      }
    }
  }
  smoothFarClipmapLandHeights(data, waterData, gridResolution);
  if (input.deferUpload) return { fallbackSamples, exceptionSamples };
  if (sourceStorage && waterStorage) {
    sourceStorage.needsUpdate = true;
    waterStorage.needsUpdate = true;
  } else {
    sourceTexture!.needsUpdate = true;
    waterTexture!.needsUpdate = true;
  }
  return { fallbackSamples, exceptionSamples };
}

export function smoothFarClipmapLandHeights(
  sourceData: Float32Array,
  waterData: Float32Array,
  gridResolution: number,
): void {
  const resolution = Math.max(2, Math.floor(gridResolution));
  if (resolution < 3) return;
  const originalHeights = new Float32Array(resolution * resolution);
  for (let i = 0; i < originalHeights.length; i++) originalHeights[i] = sourceData[i * 4] ?? 0;

  const dryUnifiedSample = (x: number, z: number): boolean => {
    const coverage = waterData[(z * resolution + x) * 4 + 3] ?? -1;
    return coverage >= 0 && coverage <= 0.04;
  };
  for (let z = 1; z < resolution - 1; z++) {
    for (let x = 1; x < resolution - 1; x++) {
      if (
        !dryUnifiedSample(x, z)
        || !dryUnifiedSample(x - 1, z)
        || !dryUnifiedSample(x + 1, z)
        || !dryUnifiedSample(x, z - 1)
        || !dryUnifiedSample(x, z + 1)
      ) continue;
      const center = z * resolution + x;
      const smoothed = originalHeights[center] * 0.5
        + (originalHeights[center - 1]
          + originalHeights[center + 1]
          + originalHeights[center - resolution]
          + originalHeights[center + resolution]) * 0.125;
      sourceData[center * 4] = smoothed;
    }
  }
}

export function commitFarClipmapMaterialSourceUpdate(
  material: FarClipmapMaterial,
  channel: "source" | "water",
  byteOffset: number,
  maxBytes: number,
): boolean {
  const sourceStorage = material.userData[FAR_CLIPMAP_SOURCE_STORAGE] as StorageBufferAttribute | undefined;
  const waterStorage = material.userData[FAR_CLIPMAP_WATER_STORAGE] as StorageBufferAttribute | undefined;
  if (sourceStorage && waterStorage) {
    const context = getActiveWebGpuRendererContext();
    const backend = context?.renderer.backend as unknown as {
      get(attribute: StorageBufferAttribute): { buffer?: GPUBuffer };
    } | undefined;
    const sourceBuffer = backend?.get(sourceStorage).buffer;
    const waterBuffer = backend?.get(waterStorage).buffer;
    if (context && sourceBuffer && waterBuffer) {
      const attribute = channel === "source" ? sourceStorage : waterStorage;
      const buffer = channel === "source" ? sourceBuffer : waterBuffer;
      const data = attribute.array as Float32Array;
      const bytes = Math.min(maxBytes, data.byteLength - byteOffset);
      context.device.queue.writeBuffer(buffer, byteOffset, data.buffer, data.byteOffset + byteOffset, bytes);
      return byteOffset + bytes >= data.byteLength;
    }
    if (channel === "source") sourceStorage.needsUpdate = true;
    else waterStorage.needsUpdate = true;
    return true;
  }
  const sourceTexture = material.userData[FAR_CLIPMAP_SOURCE_TEXTURE] as THREE.DataTexture | undefined;
  const waterTexture = material.userData[FAR_CLIPMAP_WATER_TEXTURE] as THREE.DataTexture | undefined;
  if (channel === "source" && sourceTexture) sourceTexture.needsUpdate = true;
  if (channel === "water" && waterTexture) waterTexture.needsUpdate = true;
  return true;
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
