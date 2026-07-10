import type {
  BaseDensitySampler,
  VoxelDelta,
  VoxelEditResult,
  VoxelEditSnapshot,
  VoxelEditTransaction,
} from "./voxel_edit_types.js";
import { voxelChunkKeyFor, voxelChunkKeyString, voxelLocalIndex, VOXEL_CHUNK_SIZE } from "./voxel_keys.js";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class VoxelEditStore {
  private readonly chunks = new Map<string, Map<number, VoxelDelta>>();
  private readonly materialSlotCounts = new Map<number, number>();
  private voxelCount = 0;
  private currentRevision = 0;

  revision(): number {
    return this.currentRevision;
  }

  clear(): void {
    this.chunks.clear();
    this.voxelCount = 0;
    this.materialSlotCounts.clear();
    this.currentRevision++;
  }

  apply(transaction: VoxelEditTransaction): VoxelEditResult {
    if (transaction.revisionBase !== this.currentRevision) {
      throw new Error(`voxel transaction revision mismatch: expected ${this.currentRevision}, got ${transaction.revisionBase}`);
    }
    if (transaction.deltas.length === 0) {
      return { revision: this.currentRevision, changedVoxels: 0, dirtyChunks: [] };
    }

    const nextRevision = this.currentRevision + 1;
    for (const delta of transaction.deltas) {
      if (!Number.isFinite(delta.density)) throw new Error("voxel density must be finite");
      const voxel: VoxelDelta = { ...delta, revision: nextRevision };
      const chunk = voxelChunkKeyFor(delta.x, delta.y, delta.z);
      const chunkKey = voxelChunkKeyString(chunk);
      let bucket = this.chunks.get(chunkKey);
      if (!bucket) {
        bucket = new Map<number, VoxelDelta>();
        this.chunks.set(chunkKey, bucket);
      }
      const localIndex = voxelLocalIndex(delta.x, delta.y, delta.z);
      const previous = bucket.get(localIndex);
      if (previous) this.removeMaterialSlot(previous.materialSlot);
      if (!bucket.has(localIndex)) this.voxelCount++;
      bucket.set(localIndex, voxel);
      this.addMaterialSlot(voxel.materialSlot);
    }

    this.currentRevision = nextRevision;
    return {
      revision: this.currentRevision,
      changedVoxels: transaction.deltas.length,
      dirtyChunks: transaction.dirtyChunks,
    };
  }

  rollback(transaction: VoxelEditTransaction): void {
    if (this.currentRevision !== transaction.revisionBase + (transaction.deltas.length > 0 ? 1 : 0)) {
      throw new Error("cannot rollback voxel transaction after a newer revision");
    }
    for (const previous of transaction.previousValues) {
      const chunk = voxelChunkKeyFor(previous.x, previous.y, previous.z);
      const chunkKey = voxelChunkKeyString(chunk);
      const localIndex = voxelLocalIndex(previous.x, previous.y, previous.z);
      const bucket = this.chunks.get(chunkKey);
      const current = bucket?.get(localIndex);
      if (current) this.removeMaterialSlot(current.materialSlot);
      if (previous.value) {
        let target = bucket;
        if (!target) {
          target = new Map<number, VoxelDelta>();
          this.chunks.set(chunkKey, target);
        }
        if (!target.has(localIndex)) this.voxelCount++;
        target.set(localIndex, { ...previous.value });
        this.addMaterialSlot(previous.value.materialSlot);
      } else if (bucket?.delete(localIndex)) {
        this.voxelCount--;
        if (bucket.size === 0) this.chunks.delete(chunkKey);
      }
    }
    this.currentRevision = transaction.revisionBase;
  }

  load(snapshot: VoxelEditSnapshot): void {
    this.chunks.clear();
    this.voxelCount = 0;
    this.materialSlotCounts.clear();
    this.currentRevision = snapshot.revision;

    for (const delta of snapshot.deltas) {
      const chunk = voxelChunkKeyFor(delta.x, delta.y, delta.z);
      const chunkKey = voxelChunkKeyString(chunk);
      let bucket = this.chunks.get(chunkKey);
      if (!bucket) {
        bucket = new Map<number, VoxelDelta>();
        this.chunks.set(chunkKey, bucket);
      }
      const localIndex = voxelLocalIndex(delta.x, delta.y, delta.z);
      if (!bucket.has(localIndex)) this.voxelCount++;
      bucket.set(localIndex, { ...delta });
      this.addMaterialSlot(delta.materialSlot);
    }
  }

  snapshot(): VoxelEditSnapshot {
    return {
      revision: this.currentRevision,
      deltas: this.allDeltas(),
    };
  }

  snapshotBounds(minX: number, maxX: number, minZ: number, maxZ: number): VoxelEditSnapshot {
    const deltas: VoxelDelta[] = [];
    const minChunkX = Math.floor(minX / VOXEL_CHUNK_SIZE);
    const maxChunkX = Math.floor((maxX - 1) / VOXEL_CHUNK_SIZE);
    const minChunkZ = Math.floor(minZ / VOXEL_CHUNK_SIZE);
    const maxChunkZ = Math.floor((maxZ - 1) / VOXEL_CHUNK_SIZE);
    for (const [key, bucket] of this.chunks) {
      const [cx, , cz] = key.split(",").map(Number);
      if (cx < minChunkX || cx > maxChunkX || cz < minChunkZ || cz > maxChunkZ) continue;
      for (const delta of bucket.values()) {
        if (delta.x >= minX && delta.x < maxX && delta.z >= minZ && delta.z < maxZ) deltas.push({ ...delta });
      }
    }
    return {
      revision: this.currentRevision,
      deltas,
    };
  }

  count(): number {
    return this.voxelCount;
  }

  materialSlots(): number[] {
    return [...this.materialSlotCounts.keys()].sort((a, b) => a - b);
  }

  editedYRange(x0: number, x1: number, z0: number, z1: number): { minY: number; maxY: number } | null {
    const minChunkX = Math.floor(x0 / VOXEL_CHUNK_SIZE);
    const maxChunkX = Math.floor((x1 - 1) / VOXEL_CHUNK_SIZE);
    const minChunkZ = Math.floor(z0 / VOXEL_CHUNK_SIZE);
    const maxChunkZ = Math.floor((z1 - 1) / VOXEL_CHUNK_SIZE);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [key, bucket] of this.chunks) {
      const [cx, , cz] = key.split(",").map(Number);
      if (cx < minChunkX || cx > maxChunkX || cz < minChunkZ || cz > maxChunkZ) continue;
      for (const delta of bucket.values()) {
        if (delta.x < x0 || delta.x >= x1 || delta.z < z0 || delta.z >= z1) continue;
        minY = Math.min(minY, delta.y);
        maxY = Math.max(maxY, delta.y);
      }
    }
    return Number.isFinite(minY) ? { minY, maxY } : null;
  }

  hasEdits(): boolean {
    return this.voxelCount > 0;
  }

  voxelAt(x: number, y: number, z: number): VoxelDelta | undefined {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const chunk = voxelChunkKeyFor(ix, iy, iz);
    return this.chunks.get(voxelChunkKeyString(chunk))?.get(voxelLocalIndex(ix, iy, iz));
  }

  sampleDensity(x: number, y: number, z: number, baseDensity: BaseDensitySampler): number {
    if (this.voxelCount === 0) return baseDensity(x, y, z);

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

  private *iterDeltas(): Iterable<VoxelDelta> {
    for (const bucket of this.chunks.values()) yield* bucket.values();
  }

  private allDeltas(): VoxelDelta[] {
    return [...this.iterDeltas()].map((delta) => ({ ...delta }));
  }

  private addMaterialSlot(slot: number | undefined): void {
    if (slot === undefined) return;
    this.materialSlotCounts.set(slot, (this.materialSlotCounts.get(slot) ?? 0) + 1);
  }

  private removeMaterialSlot(slot: number | undefined): void {
    if (slot === undefined) return;
    const count = this.materialSlotCounts.get(slot) ?? 0;
    if (count <= 1) this.materialSlotCounts.delete(slot);
    else this.materialSlotCounts.set(slot, count - 1);
  }
}

export const voxelEditStore = new VoxelEditStore();
