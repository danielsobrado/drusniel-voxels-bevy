import type {
  BaseDensitySampler,
  VoxelChunkKey,
  VoxelDelta,
  VoxelEditResult,
  VoxelEditSnapshot,
  VoxelEditTransaction,
} from "./voxel_edit_types.js";
import { voxelChunkKeyFor, voxelChunkKeyString, voxelKey } from "./voxel_keys.js";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

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

  sampleDensity(x: number, y: number, z: number, baseDensity: BaseDensitySampler): number {
    if (this.voxels.size === 0) return baseDensity(x, y, z);

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    // Only trilinear-blend in cells touched by stored overrides. Once any edit exists,
    // blending procedural density from integer lattice corners everywhere else would
    // change the field (and mesh normals) in untouched regions and break page seams
    // when only dirty pages are re-meshed after a dig.
    if (
      !this.voxelAt(x0, y0, z0)
      && !this.voxelAt(x0 + 1, y0, z0)
      && !this.voxelAt(x0, y0 + 1, z0)
      && !this.voxelAt(x0 + 1, y0 + 1, z0)
      && !this.voxelAt(x0, y0, z0 + 1)
      && !this.voxelAt(x0 + 1, y0, z0 + 1)
      && !this.voxelAt(x0, y0 + 1, z0 + 1)
      && !this.voxelAt(x0 + 1, y0 + 1, z0 + 1)
    ) {
      return baseDensity(x, y, z);
    }

    const tx = x - x0;
    const ty = y - y0;
    const tz = z - z0;
    const at = (ix: number, iy: number, iz: number): number => this.voxelAt(ix, iy, iz)?.density ?? baseDensity(ix, iy, iz);

    const c000 = at(x0, y0, z0);
    const c100 = at(x0 + 1, y0, z0);
    const c010 = at(x0, y0 + 1, z0);
    const c110 = at(x0 + 1, y0 + 1, z0);
    const c001 = at(x0, y0, z0 + 1);
    const c101 = at(x0 + 1, y0, z0 + 1);
    const c011 = at(x0, y0 + 1, z0 + 1);
    const c111 = at(x0 + 1, y0 + 1, z0 + 1);
    const c00 = lerp(c000, c100, tx);
    const c10 = lerp(c010, c110, tx);
    const c01 = lerp(c001, c101, tx);
    const c11 = lerp(c011, c111, tx);
    return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
  }

  materialAt(x: number, y: number, z: number): number | undefined {
    return this.voxelAt(Math.round(x), Math.round(y), Math.round(z))?.materialSlot;
  }
}

export const voxelEditStore = new VoxelEditStore();
