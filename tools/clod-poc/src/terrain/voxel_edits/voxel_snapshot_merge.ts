import type { VoxelDelta, VoxelEditSnapshot } from "./voxel_edit_types.js";

function voxelKey(delta: Pick<VoxelDelta, "x" | "y" | "z">): string {
  return `${delta.x},${delta.y},${delta.z}`;
}

function compareVoxelDeltas(a: VoxelDelta, b: VoxelDelta): number {
  return a.x - b.x || a.y - b.y || a.z - b.z || a.revision - b.revision;
}

function cloneDelta(delta: VoxelDelta): VoxelDelta {
  return delta.materialSlot === undefined
    ? { x: delta.x, y: delta.y, z: delta.z, density: delta.density, revision: delta.revision }
    : { x: delta.x, y: delta.y, z: delta.z, density: delta.density, materialSlot: delta.materialSlot, revision: delta.revision };
}

export function mergeVoxelSnapshots(parts: readonly VoxelEditSnapshot[]): VoxelEditSnapshot {
  const latestByVoxel = new Map<string, VoxelDelta>();
  let revision = 0;

  for (const part of parts) {
    revision = Math.max(revision, part.revision);
    for (const delta of part.deltas) {
      revision = Math.max(revision, delta.revision);
      const key = voxelKey(delta);
      const existing = latestByVoxel.get(key);
      if (!existing || delta.revision >= existing.revision) latestByVoxel.set(key, cloneDelta(delta));
    }
  }

  return {
    revision,
    deltas: [...latestByVoxel.values()].sort(compareVoxelDeltas),
  };
}
