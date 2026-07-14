import * as THREE from "three";
import {
  copyTreeImpostorPixels,
  dilateTreeImpostorAtlasTiles,
  flipTreeImpostorPixelRows,
} from "./tree_impostor_atlas_pixels.js";

const TREE_IMPOSTOR_ATLAS_ANISOTROPY = 4;

export interface TreeImpostorReadbackRenderer {
  readRenderTargetPixelsAsync?(
    target: THREE.WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<ArrayBufferView>;
}

export function createTreeImpostorRenderTarget(
  width: number,
  height: number,
  name: string,
): THREE.WebGLRenderTarget {
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });
  renderTarget.texture.name = name;
  renderTarget.texture.colorSpace = THREE.NoColorSpace;
  configureTreeImpostorAtlasTexture(renderTarget.texture);
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
  return copyTreeImpostorPixels(raw, width * height * 4);
}

export function createTreeImpostorDataTexture(
  pixels: Uint8Array,
  width: number,
  height: number,
  name: string,
): THREE.DataTexture {
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
  const albedo = await readTreeImpostorAtlasPixels(renderer, albedoTarget, width, height);
  if (!albedo) return null;
  const normalDepth = await readTreeImpostorAtlasPixels(renderer, normalDepthTarget, width, height);
  if (!normalDepth) return null;
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
