import * as THREE from "three";
import type { FarSummaryAtlasPackingSpec } from "../farSummaryAtlasPacking.js";

export type HeightAtlasData = Float32Array | Uint16Array;
export type AtlasData = Float32Array | Uint8Array;

export function createHeightAtlasTexture(
  data: HeightAtlasData,
  width: number,
  height: number,
  packing: FarSummaryAtlasPackingSpec,
  name: string,
): THREE.DataTexture {
  const format = packing.format === "debug_rgba32f" ? THREE.RGBAFormat : THREE.RedFormat;
  const type = packing.heightFormat === "r16f" ? THREE.HalfFloatType : THREE.FloatType;
  return createAtlasTexture(data, width, height, format, type, name);
}

export function createPackedAtlasTexture(
  data: AtlasData,
  width: number,
  height: number,
  packing: FarSummaryAtlasPackingSpec,
  name: string,
): THREE.DataTexture {
  const type = packing.format === "debug_rgba32f" ? THREE.FloatType : THREE.UnsignedByteType;
  return createAtlasTexture(data, width, height, THREE.RGBAFormat, type, name);
}

export function createCoverageAtlasTexture(
  data: AtlasData,
  width: number,
  height: number,
  packing: FarSummaryAtlasPackingSpec,
  name: string,
): THREE.DataTexture {
  const format = packing.format === "debug_rgba32f" ? THREE.RGBAFormat : THREE.RGFormat;
  const type = packing.format === "debug_rgba32f" ? THREE.FloatType : THREE.UnsignedByteType;
  return createAtlasTexture(data, width, height, format, type, name);
}

function createAtlasTexture(
  data: HeightAtlasData | AtlasData,
  width: number,
  height: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
  name: string,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, format, type);
  texture.name = name;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
