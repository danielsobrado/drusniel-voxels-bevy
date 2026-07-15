import type { HeightfieldTileCache } from "./heightfield_tile_cache.js";
import { HEIGHTFIELD_TILE_RES } from "./heightfield_tile.js";
import { WORLD_TILE_SIZE_M, worldToTile, type WorldTileKey } from "../tile_key.js";
import {
  maskVegetationAuthorityHeightfieldTile,
  vegetationAuthorityHeightfieldMaskRevision,
} from "../../vegetation/gpu_authority/heightfield_mask.js";

const DEFAULT_TILES_PER_SIDE = 7;

interface AtlasState {
  readonly device: GPUDevice;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly residencyTexture: GPUTexture;
  readonly residencyView: GPUTextureView;
  readonly params: GPUBuffer;
  readonly tilesPerSide: number;
  readonly uploaded: Set<string>;
  readonly uploadedHeights: Map<string, Float32Array>;
  readonly uploadedMaskRevisions: Map<string, number>;
  uploads: number;
}

let source: HeightfieldTileCache | null = null;
let authoritative = false;
let atlas: AtlasState | null = null;
let fallback: {
  readonly device: GPUDevice;
  readonly texture: GPUTexture;
  readonly residencyTexture: GPUTexture;
  readonly params: GPUBuffer;
} | null = null;

export interface HeightfieldTileGpuAtlasBindings {
  readonly heightView: GPUTextureView;
  readonly residencyView: GPUTextureView;
  readonly params: GPUBuffer;
  readonly enabled: boolean;
}

const keyString = (key: WorldTileKey): string => `${key.x},${key.z}`;
const positiveMod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;
const MISSING_RESIDENCY_KEY = -0x8000_0000;

function clearAtlasTileResidency(target: AtlasState, key: WorldTileKey): boolean {
  const id = keyString(key);
  if (!target.uploaded.delete(id)) return false;
  target.uploadedHeights.delete(id);
  target.uploadedMaskRevisions.delete(id);
  target.device.queue.writeTexture(
    {
      texture: target.residencyTexture,
      origin: {
        x: positiveMod(key.x, target.tilesPerSide),
        y: positiveMod(key.z, target.tilesPerSide),
      },
    },
    new Int32Array([MISSING_RESIDENCY_KEY, MISSING_RESIDENCY_KEY]),
    { bytesPerRow: 2 * Int32Array.BYTES_PER_ELEMENT },
    { width: 1, height: 1 },
  );
  return true;
}

function clearAtlasResidency(target: AtlasState): void {
  const missing = new Int32Array(target.tilesPerSide * target.tilesPerSide * 2);
  missing.fill(MISSING_RESIDENCY_KEY);
  target.device.queue.writeTexture(
    { texture: target.residencyTexture },
    missing,
    { bytesPerRow: target.tilesPerSide * 2 * Int32Array.BYTES_PER_ELEMENT },
    { width: target.tilesPerSide, height: target.tilesPerSide },
  );
  target.uploaded.clear();
  target.uploadedHeights.clear();
  target.uploadedMaskRevisions.clear();
}

export function heightfieldTileAtlasTexel(
  key: WorldTileKey,
  localX: number,
  localZ: number,
  tilesPerSide: number,
): { x: number; z: number } {
  return {
    x: positiveMod(key.x, tilesPerSide) * HEIGHTFIELD_TILE_RES + localX,
    z: positiveMod(key.z, tilesPerSide) * HEIGHTFIELD_TILE_RES + localZ,
  };
}

export function registerHeightfieldTileGpuSource(cache: HeightfieldTileCache, isAuthoritative: boolean): void {
  if (atlas && (source !== cache || authoritative !== isAuthoritative)) clearAtlasResidency(atlas);
  source = cache;
  authoritative = isAuthoritative;
}

export function unregisterHeightfieldTileGpuSource(cache: HeightfieldTileCache): void {
  if (source !== cache) return;
  source = null;
  authoritative = false;
  if (atlas) clearAtlasResidency(atlas);
}

export function createHeightfieldTileGpuAtlas(device: GPUDevice, tilesPerSide = DEFAULT_TILES_PER_SIDE): AtlasState | null {
  if (!source || !authoritative) return null;
  if (atlas?.device === device) return atlas;
  atlas?.texture.destroy();
  atlas?.residencyTexture.destroy();
  atlas?.params.destroy();
  const side = Math.max(3, Math.floor(tilesPerSide));
  const texture = device.createTexture({
    label: "continent heightfield tile atlas",
    size: { width: side * HEIGHTFIELD_TILE_RES, height: side * HEIGHTFIELD_TILE_RES },
    format: "r32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const params = device.createBuffer({
    label: "continent heightfield tile atlas params",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(params, 0, new Float32Array([
    WORLD_TILE_SIZE_M,
    HEIGHTFIELD_TILE_RES,
    side,
    1,
  ]));
  const residencyTexture = device.createTexture({
    label: "continent heightfield tile residency",
    size: { width: side, height: side },
    format: "rg32sint",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  atlas = {
    device,
    texture,
    view: texture.createView(),
    residencyTexture,
    residencyView: residencyTexture.createView(),
    params,
    tilesPerSide: side,
    uploaded: new Set(),
    uploadedHeights: new Map(),
    uploadedMaskRevisions: new Map(),
    uploads: 0,
  };
  clearAtlasResidency(atlas);
  return atlas;
}

export function heightfieldTileGpuAtlasBindings(device: GPUDevice): HeightfieldTileGpuAtlasBindings {
  const active = createHeightfieldTileGpuAtlas(device);
  if (active) {
    return {
      heightView: active.view,
      residencyView: active.residencyView,
      params: active.params,
      enabled: true,
    };
  }
  if (!fallback || fallback.device !== device) {
    fallback?.texture.destroy();
    fallback?.residencyTexture.destroy();
    fallback?.params.destroy();
    const texture = device.createTexture({
      label: "continent heightfield tile atlas fallback",
      size: { width: 1, height: 1 },
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    const residencyTexture = device.createTexture({
      label: "continent heightfield tile residency fallback",
      size: { width: 1, height: 1 },
      format: "rg32sint",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    const params = device.createBuffer({
      label: "continent heightfield tile atlas fallback params",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(params, 0, new Float32Array([1, 1, 1, 0]));
    fallback = { device, texture, residencyTexture, params };
  }
  return {
    heightView: fallback.texture.createView(),
    residencyView: fallback.residencyTexture.createView(),
    params: fallback.params,
    enabled: false,
  };
}

export function uploadHeightfieldTileToGpu(key: WorldTileKey): boolean {
  if (!atlas || !source) return false;
  const id = keyString(key);
  const tile = source.get(key);
  if (!tile) return false;
  const maskRevision = vegetationAuthorityHeightfieldMaskRevision();
  if (
    atlas.uploadedHeights.get(id) === tile.heights
    && atlas.uploadedMaskRevisions.get(id) === maskRevision
  ) {
    return true;
  }
  const slotX = positiveMod(key.x, atlas.tilesPerSide);
  const slotZ = positiveMod(key.z, atlas.tilesPerSide);
  for (const uploaded of [...atlas.uploaded]) {
    const [x, z] = uploaded.split(",").map(Number);
    if (positiveMod(x!, atlas.tilesPerSide) === slotX && positiveMod(z!, atlas.tilesPerSide) === slotZ) {
      atlas.uploaded.delete(uploaded);
      atlas.uploadedHeights.delete(uploaded);
      atlas.uploadedMaskRevisions.delete(uploaded);
    }
  }
  const uploadHeights = maskVegetationAuthorityHeightfieldTile(key, tile.heights);
  atlas.device.queue.writeTexture(
    { texture: atlas.texture, origin: { x: slotX * HEIGHTFIELD_TILE_RES, y: slotZ * HEIGHTFIELD_TILE_RES } },
    new Float32Array(uploadHeights.buffer as ArrayBuffer, uploadHeights.byteOffset, uploadHeights.length),
    { bytesPerRow: HEIGHTFIELD_TILE_RES * Float32Array.BYTES_PER_ELEMENT },
    { width: HEIGHTFIELD_TILE_RES, height: HEIGHTFIELD_TILE_RES },
  );
  atlas.device.queue.writeTexture(
    { texture: atlas.residencyTexture, origin: { x: slotX, y: slotZ } },
    new Int32Array([key.x, key.z]),
    { bytesPerRow: 2 * Int32Array.BYTES_PER_ELEMENT },
    { width: 1, height: 1 },
  );
  atlas.uploaded.add(id);
  atlas.uploadedHeights.set(id, tile.heights);
  atlas.uploadedMaskRevisions.set(id, maskRevision);
  atlas.uploads++;
  return true;
}

export function updateHeightfieldTileGpuAtlas(centerX: number, centerZ: number): void {
  if (!atlas || !source) return;
  const center = worldToTile(centerX, centerZ);
  const radius = Math.floor(atlas.tilesPerSide / 2);
  const maskRevision = vegetationAuthorityHeightfieldMaskRevision();
  const candidates: Array<{ key: WorldTileKey; d2: number }> = [];
  for (let z = center.z - radius; z <= center.z + radius; z++) for (let x = center.x - radius; x <= center.x + radius; x++) {
    const key = { x, z };
    const id = keyString(key);
    const tile = source.get(key);
    if (!tile) {
      clearAtlasTileResidency(atlas, key);
      continue;
    }
    if (
      atlas.uploadedHeights.get(id) === tile.heights
      && atlas.uploadedMaskRevisions.get(id) === maskRevision
    ) {
      continue;
    }
    candidates.push({ key, d2: (x - center.x) ** 2 + (z - center.z) ** 2 });
  }
  candidates.sort((a, b) => a.d2 - b.d2);
  if (candidates[0]) uploadHeightfieldTileToGpu(candidates[0].key);
}

export function heightfieldTileGpuAtlasHas(key: WorldTileKey): boolean {
  return atlas?.uploaded.has(keyString(key)) ?? false;
}

export function invalidateHeightfieldTileGpuAtlasBounds(
  cache: HeightfieldTileCache,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
): number {
  if (!atlas || source !== cache) return 0;
  const min = worldToTile(bounds.minX, bounds.minZ);
  const max = worldToTile(
    bounds.maxX > bounds.minX ? bounds.maxX - 1e-7 : bounds.maxX,
    bounds.maxZ > bounds.minZ ? bounds.maxZ - 1e-7 : bounds.maxZ,
  );
  let invalidated = 0;
  for (let z = min.z; z <= max.z; z++) {
    for (let x = min.x; x <= max.x; x++) {
      if (clearAtlasTileResidency(atlas, { x, z })) invalidated++;
    }
  }
  return invalidated;
}

export function uploadHeightfieldTilesForPage(
  coord: { px: number; pz: number; level?: number },
  basePageSizeM: number,
): boolean {
  if (!atlas || !source) return false;
  const span = basePageSizeM * (2 ** Math.max(0, Math.floor(coord.level ?? 0)));
  const minX = coord.px * span;
  const minZ = coord.pz * span;
  const lastTileX = Math.ceil((minX + span) / WORLD_TILE_SIZE_M) - 1;
  const lastTileZ = Math.ceil((minZ + span) / WORLD_TILE_SIZE_M) - 1;
  let ready = true;
  for (let z = Math.floor(minZ / WORLD_TILE_SIZE_M); z <= lastTileZ; z++) {
    for (let x = Math.floor(minX / WORLD_TILE_SIZE_M); x <= lastTileX; x++) {
      ready = uploadHeightfieldTileToGpu({ x, z }) && ready;
    }
  }
  return ready;
}

export function heightfieldTileGpuAtlasStats(): { enabled: number; uploads: number; resident: number } {
  return {
    enabled: atlas && source && authoritative ? 1 : 0,
    uploads: atlas?.uploads ?? 0,
    resident: atlas?.uploaded.size ?? 0,
  };
}

export type HeightfieldTileGpuAtlas = AtlasState;
