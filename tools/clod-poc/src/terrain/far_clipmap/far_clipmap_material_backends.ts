import * as THREE from "three";
import { MeshBasicNodeMaterial, StorageBufferAttribute } from "three/webgpu";
import { max, mix, positionGeometry, select, smoothstep, storage, uniform, varying, vec2, vec3 } from "three/tsl";
import type { FarClipmapDebugMode } from "./far_clipmap_config.js";
import { DEFAULT_TERRAIN_NODE_LIGHTING } from "../../gpu/terrain_node_material.js";
import {
  getTerrainLayerAverageAlbedo,
  terrainLayerAverageAlbedoRevision,
} from "../../textures/terrain_layer_average_albedo.js";
import { TERRAIN_LAYER_HEIGHT_BANDS } from "../../textures/terrainTextureArrays.js";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./far_clipmap_material_webgl_shaders.js";
import type {
  FarClipmapDisplacementMode,
  FarClipmapMaterial,
  FarClipmapMaterialUniforms,
} from "./far_clipmap_material.js";

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

export const FAR_CLIPMAP_DEBUG_MODE_CODES: Record<FarClipmapDebugMode, number> = Object.freeze({
  final: 0,
  biome: 1,
  height: 2,
  ownership: 3,
});

export const FAR_CLIPMAP_NODE_UNIFORMS = "farClipmapNodeUniforms";
export const FAR_CLIPMAP_SOURCE_TEXTURE = "farClipmapSourceTexture";
export const FAR_CLIPMAP_SOURCE_DATA = "farClipmapSourceData";
export const FAR_CLIPMAP_WATER_TEXTURE = "farClipmapWaterTexture";
export const FAR_CLIPMAP_WATER_DATA = "farClipmapWaterData";
export const FAR_CLIPMAP_SOURCE_STORAGE = "farClipmapSourceStorage";
export const FAR_CLIPMAP_WATER_STORAGE = "farClipmapWaterStorage";
export const FAR_CLIPMAP_OWNERSHIP_DATA = "farClipmapOwnershipData";
export const FAR_CLIPMAP_OWNERSHIP_STORAGE = "farClipmapOwnershipStorage";
export const FAR_CLIPMAP_DISPLACEMENT_MODE = "farClipmapDisplacementMode";
export const FAR_CLIPMAP_PALETTE_UNIFORMS = "farClipmapPaletteUniforms";
export const FAR_CLIPMAP_PALETTE_REVISION = "farClipmapPaletteRevision";
export const FAR_CLIPMAP_LIGHTING_UNIFORMS = "farClipmapLightingUniforms";

// Land palette slots resolved from the near-terrain texture layers, keyed by biome
// material id order (meadows, forest, swamp, mountain, plains, coast) plus the
// elevation-band layers shared across biomes.
export const FAR_CLIPMAP_PALETTE_LAYERS = {
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

export type FarClipmapPaletteUniforms = Record<keyof typeof FAR_CLIPMAP_PALETTE_LAYERS, FarClipmapNodeUniform<THREE.Vector3>>;

export interface FarClipmapLightingUniforms {
  uSunDirection: FarClipmapNodeUniform<THREE.Vector3>;
  uSunColor: FarClipmapNodeUniform<THREE.Color>;
  uSkyLight: FarClipmapNodeUniform<THREE.Color>;
  uGroundLight: FarClipmapNodeUniform<THREE.Color>;
}

export interface FarClipmapNodeUniforms {
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

function farClipmapDebugModeCode(mode: FarClipmapDebugMode): number {
  return FAR_CLIPMAP_DEBUG_MODE_CODES[mode];
}

export function farClipmapFallbackColor(mode: FarClipmapDebugMode): THREE.Color {
  if (mode === "biome") return new THREE.Color(0x3e5a30);
  if (mode === "height") return new THREE.Color(0x6f7568);
  if (mode === "ownership") return new THREE.Color(0x2d69c7);
  return new THREE.Color(0x33432f);
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
  return Object.fromEntries(entries) as FarClipmapPaletteUniforms;
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

// The CPU-baked path (farClipmapShaderDisplacement=0) is a fallback / no-WebGPU path only. It is
// rendered as a flat, unlit debug ring — a single tint, not the per-vertex terrain colouring —
// so it reads unmistakably as a placeholder and never masquerades as the shipping far terrain
// (which is the GPU shader-displacement path). Flat colour also removes the coarse-grid vertex-
// colour "blockiness"; DoubleSide stops grazing/underside angles from showing black through it.
export function createCpuBakedFarClipmapMaterial(input: { debugMode: FarClipmapDebugMode }): FarClipmapMaterial {
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

export function createWebGpuFarClipmapMaterial(input: {
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
  // Elevation bands derive from the near-terrain layer table (absolute Y) so the far
  // palette hands off to the textured pages without a colour step.
  const bands = TERRAIN_LAYER_HEIGHT_BANDS;
  const bandHeight: TslNode = terrainHeight.add(bandNoise.sub(0.5).mul(12.0));
  // Beach stays a narrow ring fading out at the near sand layer's upper edge; the
  // lowland above it is dirt+rock like the vegetated near ground, with the biome
  // colour only as a tint so coast/plains ids cannot repaint whole islands yellow.
  const sandBand: TslNode = tslSmoothstep(bands.sand.heightMax - 4, bands.sand.heightMax + 2, bandHeight).oneMinus();
  const slopeRock: TslNode = tslSmoothstep(0.10, 0.46, normalY.oneMinus());
  const rockBand: TslNode = max(tslSmoothstep(bands.rock.heightMin, bands.rock.heightMax, bandHeight), slopeRock);
  const snowBand: TslNode = tslSmoothstep(bands.snow.heightMin, bands.snow.heightMax, bandHeight)
    .mul(tslSmoothstep(0.58, 0.92, normalY));
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
  const landColor: TslNode = landAlbedo.mul(terrainLight).mul(tintVariation);
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

export function createWebGlFarClipmapMaterial(input: {
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
}): FarClipmapMaterial {
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
