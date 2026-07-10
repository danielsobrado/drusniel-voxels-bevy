export interface VoxelCoord {
  x: number;
  y: number;
  z: number;
}

export interface VoxelChunkKey {
  x: number;
  y: number;
  z: number;
}

export interface VoxelDelta extends VoxelCoord {
  density: number;
  materialSlot?: number;
  revision: number;
}

export interface VoxelDeltaBefore extends VoxelCoord {
  value: VoxelDelta | null;
}

export interface VoxelEditBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface VoxelEditTransaction {
  id: number;
  source: string;
  revisionBase: number;
  deltas: readonly Omit<VoxelDelta, "revision">[];
  previousValues: readonly VoxelDeltaBefore[];
  dirtyChunks: readonly VoxelChunkKey[];
  dirtyBounds: VoxelEditBounds;
  affectedMaterialSlots: readonly number[];
}

export interface VoxelEditResult {
  revision: number;
  changedVoxels: number;
  dirtyChunks: readonly VoxelChunkKey[];
}

export interface VoxelEditSnapshot {
  revision: number;
  deltas: readonly VoxelDelta[];
}

export type BaseDensitySampler = (x: number, y: number, z: number) => number;
