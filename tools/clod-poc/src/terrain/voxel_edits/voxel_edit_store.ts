import type {
  VoxelChunkKey,
  VoxelDelta,
  VoxelEditResult,
  VoxelEditSnapshot,
  VoxelEditTransaction,
} from "./voxel_edit_types.js";
import { voxelChunkKeyFor, voxelChunkKeyString, voxelKey } from "./voxel_keys.js";

export class VoxelEditStore {
  private readonly voxels = new Map<string, VoxelDelta>();
  private readonly chunkIndex = new Map<string, Set<string>>();
  private currentRevision = 0;

  revision(): number {
    return this.currentRevision;
  }

  clear(): void {
    this.voxels.clear();
    this.chunkIndex.clear();
    this.currentRevision++;
  }

  apply(transaction: VoxelEditTransaction): VoxelEditResult {
    if (transaction.deltas.length === 0) {
      return { revision: this.currentRevision, changedVoxels: 0, dirtyChunks: [] };
    }

    const nextRevision = this.currentRevision + 1;
    const dirty = new Map<string, VoxelChunkKey>();

    for (const delta of transaction.deltas) {
      if (!Number.isFinite(delta.density)) throw new Error("voxel density must be finite");
      const key = voxelKey(delta.x, delta.y, delta.z);
      const voxel: VoxelDelta = { ...delta, revision: nextRevision };
      this.voxels.set(key, voxel);

      const chunk = voxelChunkKeyFor(delta.x, delta.y, delta.z);
      const chunkKey = voxelChunkKeyString(chunk);
      let bucket = this.chunkIndex.get(chunkKey);
      if (!bucket) {
        bucket = new Set<string>();
        this.chunkIndex.set(chunkKey, bucket);
      }
      bucket.add(key);
      dirty.set(chunkKey, chunk);
    }

    this.currentRevision = nextRevision;
    return {
      revision: this.currentRevision,
      changedVoxels: transaction.deltas.length,
      dirtyChunks: [...dirty.values()],
    };
  }

  load(snapshot: VoxelEditSnapshot): void {
    this.voxels.clear();
    this.chunkIndex.clear();
    this.currentRevision = snapshot.revision;

    for (const delta of snapshot.deltas) {
      const key = voxelKey(delta.x, delta.y, delta.z);
      this.voxels.set(key, { ...delta });
      const chunk = voxelChunkKeyFor(delta.x, delta.y, delta.z);
      const chunkKey = voxelChunkKeyString(chunk);
      let bucket = this.chunkIndex.get(chunkKey);
      if (!bucket) {
        bucket = new Set<string>();
        this.chunkIndex.set(chunkKey, bucket);
      }
      bucket.add(key);
    }
  }

  snapshot(): VoxelEditSnapshot {
    return {
      revision: this.currentRevision,
      deltas: [...this.voxels.values()].map((delta) => ({ ...delta })),
    };
  }

  hasEdits(): boolean {
    return this.voxels.size > 0;
  }

  voxelAt(x: number, y: number, z: number): VoxelDelta | undefined {
    return this.voxels.get(voxelKey(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  materialAt(x: number, y: number, z: number): number | undefined {
    return this.voxelAt(Math.round(x), Math.round(y), Math.round(z))?.materialSlot;
  }
}

export const voxelEditStore = new VoxelEditStore();
