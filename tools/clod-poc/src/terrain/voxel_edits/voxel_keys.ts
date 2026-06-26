import type { VoxelChunkKey } from "./voxel_edit_types.js";

export const VOXEL_CHUNK_SHIFT = 4;
export const VOXEL_CHUNK_SIZE = 1 << VOXEL_CHUNK_SHIFT;

const KEY_OFFSET = 1_048_576;
const KEY_STRIDE = 2_097_152;

function assertSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer`);
  }
}

export function voxelKey(x: number, y: number, z: number): string {
  assertSafeInteger("voxel x", x);
  assertSafeInteger("voxel y", y);
  assertSafeInteger("voxel z", z);
  return `${x},${y},${z}`;
}

export function voxelChunkKeyFor(x: number, y: number, z: number): VoxelChunkKey {
  return {
    x: Math.floor(x / VOXEL_CHUNK_SIZE),
    y: Math.floor(y / VOXEL_CHUNK_SIZE),
    z: Math.floor(z / VOXEL_CHUNK_SIZE),
  };
}

export function voxelChunkKeyString(chunk: VoxelChunkKey): string {
  return `${chunk.x},${chunk.y},${chunk.z}`;
}

export function legacyVoxelCellKey(x: number, y: number, z: number): number {
  return ((x + KEY_OFFSET) * KEY_STRIDE + (y + KEY_OFFSET)) * KEY_STRIDE + (z + KEY_OFFSET);
}
