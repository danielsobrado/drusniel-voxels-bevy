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
