import * as THREE from "three";
import { LIGHT_SAMPLE, type LightTile } from "./light_builder.js";
import type { SunLightOptions } from "./sun_light_options.js";
import type { SunVisibilityTileKey } from "./sun_visibility_tile.js";

const DEFAULT_ATLAS_SIZE = 1;
const VISIBILITY_LIT = 255;
const VISIBILITY_SHADED = 0;
const VISIBILITY_MISSING = 128;

export interface SunLightGpuAtlasState {
  texture: THREE.DataTexture;
  originX: number;
  originZ: number;
  worldSize: number;
  valid: number;
  version: number;
}

export interface SunLightGpuAtlasSample {
  readonly visibility: number;
  readonly valid: boolean;
  readonly revision: number;
  readonly cellSizeM: number;
}

const state: SunLightGpuAtlasState = {
  texture: createTexture(DEFAULT_ATLAS_SIZE, DEFAULT_ATLAS_SIZE, new Uint8Array([VISIBILITY_LIT])),
  originX: 0,
  originZ: 0,
  worldSize: 1,
  valid: 0,
  version: 0,
};

function createTexture(width: number, height: number, data: Uint8Array): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.name = "drusniel-sun-light-visibility-atlas";
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function sampleToByte(value: number): number {
  if (value === LIGHT_SAMPLE.shaded) return VISIBILITY_SHADED;
  if (value === LIGHT_SAMPLE.missing) return VISIBILITY_MISSING;
  return VISIBILITY_LIT;
}

function resizeTexture(width: number, height: number, data: Uint8Array): void {
  state.texture.image = { data, width, height };
  state.texture.needsUpdate = true;
}

export function getSunLightGpuAtlas(): SunLightGpuAtlasState {
  return state;
}

export function sampleSunLightGpuAtlas(x: number, z: number): SunLightGpuAtlasSample {
  const image = atlasImage();
  const cellSizeM = image.width > 0 && state.worldSize > 0 ? state.worldSize / image.width : 0;
  const fallback: SunLightGpuAtlasSample = {
    visibility: 1,
    valid: false,
    revision: state.version,
    cellSizeM,
  };
  if (
    state.valid <= 0
    || !Number.isFinite(x)
    || !Number.isFinite(z)
    || !(state.worldSize > 0)
    || image.width <= 0
    || image.height <= 0
  ) {
    return fallback;
  }

  const u = (x - state.originX) / state.worldSize;
  const v = (z - state.originZ) / state.worldSize;
  if (u < 0 || v < 0 || u > 1 || v > 1) return fallback;

  const ix = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
  const iz = Math.min(image.height - 1, Math.max(0, Math.floor(v * image.height)));
  const value = Number(image.data[iz * image.width + ix]);
  if (!Number.isFinite(value) || value === VISIBILITY_MISSING) return fallback;

  return {
    visibility: Math.min(1, Math.max(0, value / VISIBILITY_LIT)),
    valid: true,
    revision: state.version,
    cellSizeM,
  };
}

export function updateSunLightGpuAtlas(
  centerTile: SunVisibilityTileKey,
  tiles: readonly LightTile[],
  options: SunLightOptions,
): void {
  const radius = options.build.materialTileRadius;
  const tileCount = radius * 2 + 1;
  const resolution = options.tile.resolution;
  const width = Math.max(DEFAULT_ATLAS_SIZE, tileCount * resolution);
  const height = width;
  const data = new Uint8Array(width * height);
  data.fill(VISIBILITY_LIT);

  const minTileX = centerTile.tileX - radius;
  const minTileZ = centerTile.tileZ - radius;
  for (const tile of tiles) {
    const localTileX = tile.key.tileX - minTileX;
    const localTileZ = tile.key.tileZ - minTileZ;
    if (localTileX < 0 || localTileZ < 0 || localTileX >= tileCount || localTileZ >= tileCount) continue;
    if (tile.resolution !== resolution) continue;

    for (let z = 0; z < resolution; z++) {
      const atlasRow = (localTileZ * resolution + z) * width;
      const tileRow = z * resolution;
      for (let x = 0; x < resolution; x++) {
        data[atlasRow + localTileX * resolution + x] = sampleToByte(tile.values[tileRow + x] ?? LIGHT_SAMPLE.missing);
      }
    }
  }

  state.originX = minTileX * options.tile.sizeWorld;
  state.originZ = minTileZ * options.tile.sizeWorld;
  state.worldSize = tileCount * options.tile.sizeWorld;
  state.valid = options.active && tileCount > 0 ? 1 : 0;
  state.version += 1;
  resizeTexture(width, height, data);
}

export function invalidateSunLightGpuAtlas(): void {
  // Called every frame while the feature is disabled; re-invalidating would
  // reallocate the texture and bump the version consumers re-upload on.
  if (state.valid === 0 && state.texture.image.width === DEFAULT_ATLAS_SIZE && state.texture.image.height === DEFAULT_ATLAS_SIZE) return;
  state.valid = 0;
  state.version += 1;
  resizeTexture(DEFAULT_ATLAS_SIZE, DEFAULT_ATLAS_SIZE, new Uint8Array([VISIBILITY_LIT]));
}

function atlasImage(): { readonly data: ArrayLike<number>; readonly width: number; readonly height: number } {
  const image = state.texture.image as { data?: ArrayLike<number>; width?: number; height?: number };
  return {
    data: image.data ?? [],
    width: Number.isInteger(image.width) ? Math.max(0, image.width as number) : 0,
    height: Number.isInteger(image.height) ? Math.max(0, image.height as number) : 0,
  };
}
