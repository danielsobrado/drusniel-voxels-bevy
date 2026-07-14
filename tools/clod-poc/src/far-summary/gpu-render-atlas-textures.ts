import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import {
  FAR_SUMMARY_RENDER_ATLAS_FORMAT,
  FAR_SUMMARY_RENDER_ATLAS_RGBA_COMPONENTS,
} from "./gpu-render-atlas-constants.js";
import type {
  FarSummaryRenderAtlasFrontTextures,
  FarSummaryRenderAtlasTextureSet,
} from "./gpu-render-atlas-types.js";

interface RendererTextureBackend {
  get(texture: THREE.Texture): { texture?: GPUTexture; format?: GPUTextureFormat };
}

interface RendererTextureManager {
  updateTexture(texture: THREE.Texture): void;
}

interface WebGpuRendererWithTextureAccess {
  backend: RendererTextureBackend;
  _textures?: RendererTextureManager;
}

export function createFarSummaryRenderAtlasFrontTextures(
  width: number,
  height: number,
): FarSummaryRenderAtlasFrontTextures {
  return {
    height: createFrontTexture(width, height, "far-summary-render-height"),
    material: createFrontTexture(width, height, "far-summary-render-material"),
    normal: createFrontTexture(width, height, "far-summary-render-normal"),
    coverage: createFrontTexture(width, height, "far-summary-render-coverage"),
  };
}

export function initializeFarSummaryRenderAtlasFrontTextures(
  rendererInput: WebGPURenderer,
  textures: FarSummaryRenderAtlasFrontTextures,
): FarSummaryRenderAtlasTextureSet {
  const renderer = rendererInput as unknown as WebGpuRendererWithTextureAccess;
  const textureManager = renderer._textures;
  if (!textureManager) throw new Error("renderer texture manager unavailable");
  return {
    height: initializeFrontGpuTexture(renderer, textureManager, textures.height),
    material: initializeFrontGpuTexture(renderer, textureManager, textures.material),
    normal: initializeFrontGpuTexture(renderer, textureManager, textures.normal),
    coverage: initializeFrontGpuTexture(renderer, textureManager, textures.coverage),
  };
}

export function createFarSummaryRenderAtlasBackTextures(
  device: GPUDevice,
  width: number,
  height: number,
): FarSummaryRenderAtlasTextureSet {
  return {
    height: createBackTexture(device, width, height, "far-summary-render-height-back"),
    material: createBackTexture(device, width, height, "far-summary-render-material-back"),
    normal: createBackTexture(device, width, height, "far-summary-render-normal-back"),
    coverage: createBackTexture(device, width, height, "far-summary-render-coverage-back"),
  };
}

export function destroyFarSummaryRenderAtlasTextureSet(textures: FarSummaryRenderAtlasTextureSet): void {
  textures.height.destroy();
  textures.material.destroy();
  textures.normal.destroy();
  textures.coverage.destroy();
}

export function disposeFarSummaryRenderAtlasFrontTextures(textures: FarSummaryRenderAtlasFrontTextures): void {
  textures.height.dispose();
  textures.material.dispose();
  textures.normal.dispose();
  textures.coverage.dispose();
}

function createFrontTexture(width: number, height: number, name: string): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint16Array(width * height * FAR_SUMMARY_RENDER_ATLAS_RGBA_COMPONENTS),
    width,
    height,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  texture.name = name;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  // three types `internalFormat` as its WebGL-style `PixelFormatGPU`, so intersecting it with a
  // WebGPU `GPUTextureFormat` collapses to `never`; widen instead of changing what is written.
  (texture as unknown as { internalFormat: string }).internalFormat = FAR_SUMMARY_RENDER_ATLAS_FORMAT;
  texture.needsUpdate = true;
  return texture;
}

function initializeFrontGpuTexture(
  renderer: WebGpuRendererWithTextureAccess,
  textureManager: RendererTextureManager,
  texture: THREE.DataTexture,
): GPUTexture {
  textureManager.updateTexture(texture);
  const data = renderer.backend.get(texture);
  if (!data.texture) throw new Error(`missing GPU texture for ${texture.name}`);
  if (data.format && data.format !== FAR_SUMMARY_RENDER_ATLAS_FORMAT) {
    throw new Error(
      `unexpected ${texture.name} format ${data.format}; expected ${FAR_SUMMARY_RENDER_ATLAS_FORMAT}`,
    );
  }
  return data.texture;
}

function createBackTexture(device: GPUDevice, width: number, height: number, label: string): GPUTexture {
  return device.createTexture({
    label,
    size: { width, height, depthOrArrayLayers: 1 },
    format: FAR_SUMMARY_RENDER_ATLAS_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.RENDER_ATTACHMENT,
  });
}
