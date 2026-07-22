import * as THREE from "three";
import type { FarClipmapDebugMode } from "./far_clipmap_config.js";
import {
  getTerrainLayerAverageAlbedo,
  terrainLayerAverageAlbedoRevision,
} from "../../textures/terrain_layer_average_albedo.js";
import {
  createCpuBakedFarClipmapMaterial,
  createWebGlFarClipmapMaterial,
  createWebGpuFarClipmapMaterial,
  FAR_CLIPMAP_DEBUG_MODE_CODES,
  FAR_CLIPMAP_DISPLACEMENT_MODE,
  FAR_CLIPMAP_LIGHTING_UNIFORMS,
  FAR_CLIPMAP_NODE_UNIFORMS,
  FAR_CLIPMAP_PALETTE_LAYERS,
  FAR_CLIPMAP_PALETTE_REVISION,
  FAR_CLIPMAP_PALETTE_UNIFORMS,
  farClipmapFallbackColor,
  type FarClipmapLightingUniforms,
  type FarClipmapNodeUniforms,
  type FarClipmapPaletteUniforms,
} from "./far_clipmap_material_backends.js";

export {
  commitFarClipmapMaterialSourceUpdate,
  disposeFarClipmapMaterialSourceTextures,
  smoothFarClipmapLandHeights,
  updateFarClipmapMaterialOwnershipMask,
  updateFarClipmapMaterialSourceTexture,
} from "./far_clipmap_material_source_upload.js";

const FAR_CLIPMAP_SHADER_RENDER_ORDER = 20;

export interface FarClipmapLighting {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface FarClipmapMaterialUniforms {
  /* eslint-disable @typescript-eslint/no-explicit-any */
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

export interface FarClipmapSourceTextureStats {
  fallbackSamples: number;
  exceptionSamples: number;
}

export type FarClipmapDisplacementMode = "shader" | "cpu-baked";

export type FarClipmapMaterial = THREE.Material & {
  uniforms?: FarClipmapMaterialUniforms;
};

export function farClipmapDebugModeCode(mode: FarClipmapDebugMode): number {
  return FAR_CLIPMAP_DEBUG_MODE_CODES[mode];
}

export function farClipmapShaderRenderOrder(): number {
  return FAR_CLIPMAP_SHADER_RENDER_ORDER;
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
  return createWebGlFarClipmapMaterial(input);
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
  refreshFarClipmapMaterialPalette(material);
}
