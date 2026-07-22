import * as THREE from "three";
import type { FarSummaryTile } from "../types.js";
import {
  clamp01,
  packUnorm8,
  type FarSummaryAtlasPackingSpec,
} from "../farSummaryAtlasPacking.js";
import type { AtlasData, HeightAtlasData } from "./farSummaryAtlasTextures.js";
import type { AtlasDirtyRect } from "./farSummaryAtlasDirtyRects.js";

export const RGBA_COMPONENTS = 4;
const NORMAL_ENCODE_BIAS = 0.5;
const NORMAL_ENCODE_SCALE = 0.5;
const HALF_FLOAT_MAX = 65504;

export function writeHeight(
  heightData: HeightAtlasData,
  packing: FarSummaryAtlasPackingSpec,
  pixel: number,
  avgHeight: number,
  minHeight: number,
  maxHeight: number,
): void {
  const dst = pixel * packing.heightComponents;
  if (heightData instanceof Uint16Array) {
    heightData[dst] = THREE.DataUtils.toHalfFloat(clampHalfFloatHeight(avgHeight));
    return;
  }
  heightData[dst] = finiteOrZero(avgHeight);
  if (!packing.storesHeightRange) return;
  heightData[dst + 1] = finiteOrZero(minHeight);
  heightData[dst + 2] = finiteOrZero(maxHeight);
  heightData[dst + 3] = 1;
}

export function writeRgba(data: AtlasData, dst: number, r: number, g: number, b: number, a: number): void {
  if (data instanceof Float32Array) {
    data[dst] = clamp01(r);
    data[dst + 1] = clamp01(g);
    data[dst + 2] = clamp01(b);
    data[dst + 3] = clamp01(a);
    return;
  }
  data[dst] = packUnorm8(r);
  data[dst + 1] = packUnorm8(g);
  data[dst + 2] = packUnorm8(b);
  data[dst + 3] = packUnorm8(a);
}

export function writeCoverage(
  coverageData: AtlasData,
  packing: FarSummaryAtlasPackingSpec,
  pixel: number,
  canopy: number,
  water: number,
): void {
  const dst = pixel * packing.coverageComponents;
  if (coverageData instanceof Float32Array) {
    coverageData[dst] = clamp01(canopy);
    coverageData[dst + 1] = clamp01(water);
    if (packing.coverageComponents >= RGBA_COMPONENTS) {
      coverageData[dst + 2] = 1;
      coverageData[dst + 3] = 1;
    }
    return;
  }
  coverageData[dst] = packUnorm8(canopy);
  coverageData[dst + 1] = packUnorm8(water);
  if (packing.coverageComponents >= RGBA_COMPONENTS) {
    coverageData[dst + 2] = 255;
    coverageData[dst + 3] = 255;
  }
}

export function clearRectData(
  data: HeightAtlasData | AtlasData,
  rect: AtlasDirtyRect,
  atlasWidth: number,
  componentCount: number,
): void {
  for (let row = 0; row < rect.height; row++) {
    const start = ((rect.y + row) * atlasWidth + rect.x) * componentCount;
    data.fill(0, start, start + rect.width * componentCount);
  }
}

export function encodeNormalChannel(value: number): number {
  return clamp01(value * NORMAL_ENCODE_SCALE + NORMAL_ENCODE_BIAS);
}

export function deriveSummaryNormal(tile: FarSummaryTile, x: number, z: number): THREE.Vector3 {
  const left = sampleTileHeight(tile, x - 1, z);
  const right = sampleTileHeight(tile, x + 1, z);
  const down = sampleTileHeight(tile, x, z - 1);
  const up = sampleTileHeight(tile, x, z + 1);
  return new THREE.Vector3(left - right, 2, down - up).normalize();
}

function sampleTileHeight(tile: FarSummaryTile, x: number, z: number): number {
  const cx = Math.max(0, Math.min(tile.resolution - 1, x));
  const cz = Math.max(0, Math.min(tile.resolution - 1, z));
  return tile.avgHeight[cz * tile.resolution + cx] ?? 0;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampHalfFloatHeight(value: number): number {
  return Math.min(HALF_FLOAT_MAX, Math.max(-HALF_FLOAT_MAX, finiteOrZero(value)));
}
