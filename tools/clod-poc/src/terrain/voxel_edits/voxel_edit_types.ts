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

export interface VoxelEditTransaction {
  id: number;
  source: string;
  revisionBase: number;
  deltas: readonly Omit<VoxelDelta, "revision">[];
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
