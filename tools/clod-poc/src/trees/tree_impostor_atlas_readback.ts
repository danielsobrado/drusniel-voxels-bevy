import * as THREE from "three";
import {
  copyTreeImpostorPixels,
  dilateTreeImpostorAtlasTiles,
  flipTreeImpostorPixelRows,
  viewTreeImpostorPixels,
} from "./tree_impostor_atlas_pixels.js";

const TREE_IMPOSTOR_ATLAS_ANISOTROPY = 8;
export const TREE_IMPOSTOR_PORTABLE_MAX_TEXTURE_DIMENSION = 8192;

export interface TreeImpostorReadbackRenderer {
  readRenderTargetPixelsAsync?(
    target: THREE.WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<ArrayBufferView>;
}

export function validateTreeImpostorRenderTargetSize(
  width: number,
  height: number,
  maxDimension = TREE_IMPOSTOR_PORTABLE_MAX_TEXTURE_DIMENSION,
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`tree impostor atlas dimensions must be positive integers; received ${width}x${height}`);
  }
  if (!Number.isInteger(maxDimension) || maxDimension <= 0) {
    throw new Error(`tree impostor max texture dimension must be a positive integer; received ${maxDimension}`);
  }
  if (width > maxDimension || height > maxDimension) {
    throw new Error(
      `tree impostor atlas ${width}x${height} exceeds the portable ${maxDimension}px texture limit; ` +
      "reduce resolution or disable age-layer baking",
    );
  }
}

export function createTreeImpostorRenderTarget(
  width: number,
  height: number,
  name: string,
): THREE.WebGLRenderTarget {
  validateTreeImpostorRenderTargetSize(width, height);
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  renderTarget.texture.name = name;
  renderTarget.texture.colorSpace = THREE.NoColorSpace;
  renderTarget.texture.wrapS = THREE.ClampToEdgeWrapping;
  renderTarget.texture.wrapT = THREE.ClampToEdgeWrapping;
  return renderTarget;
}

export function configureTreeImpostorAtlasTexture(texture: THREE.Texture): void {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.max(texture.anisotropy, TREE_IMPOSTOR_ATLAS_ANISOTROPY);
}

export async function readTreeImpostorAtlasPixels(
  renderer: TreeImpostorReadbackRenderer,
  target: THREE.WebGLRenderTarget,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const readPixels = renderer.readRenderTargetPixelsAsync?.bind(renderer);
  if (!readPixels) return null;
  const raw = await readPixels(target, 0, 0, width, height);
  return viewTreeImpostorPixels(raw, width * height * 4);
}

export function createTreeImpostorDataTexture(
  pixels: Uint8Array,
  width: number,
  height: number,
  name: string,
): THREE.DataTexture {
  validateTreeImpostorRenderTargetSize(width, height);
  const texture = new THREE.DataTexture(
    pixels,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = name;
  texture.colorSpace = THREE.NoColorSpace;
  configureTreeImpostorAtlasTexture(texture);
  texture.needsUpdate = true;
  return texture;
}

export async function readCleanedTreeImpostorAtlasTextures(
  renderer: TreeImpostorReadbackRenderer,
  albedoTarget: THREE.WebGLRenderTarget,
  normalDepthTarget: THREE.WebGLRenderTarget,
  width: number,
  height: number,
  tileSize: number,
  webgpu: boolean,
): Promise<{ albedo: THREE.DataTexture; normalDepth: THREE.DataTexture } | null> {
  const readPixels = renderer.readRenderTargetPixelsAsync?.bind(renderer);
  if (!readPixels) return null;
  const expectedLength = width * height * 4;
  const rawAlbedo = await readPixels(albedoTarget, 0, 0, width, height);
  const rawNormalDepth = await readPixels(normalDepthTarget, 0, 0, width, height);
  const albedo = copyTreeImpostorPixels(rawAlbedo, expectedLength);
  const normalDepth = copyTreeImpostorPixels(rawNormalDepth, expectedLength);
  if (webgpu) {
    flipTreeImpostorPixelRows(albedo, width, height);
    flipTreeImpostorPixelRows(normalDepth, width, height);
  }
  dilateTreeImpostorAtlasTiles({ albedo, normalDepth, width, height, tileSize });
  return {
    albedo: createTreeImpostorDataTexture(albedo, width, height, albedoTarget.texture.name),
    normalDepth: createTreeImpostorDataTexture(normalDepth, width, height, normalDepthTarget.texture.name),
  };
}
