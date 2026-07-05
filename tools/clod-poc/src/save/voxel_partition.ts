import type { VoxelDelta, VoxelEditSnapshot } from "../terrain/voxel_edits/voxel_edit_types.js";
import { regionKeyForWorld } from "./region_key.js";
import { SAVE_SCHEMA_VERSION } from "./save_config.js";
import type { RegionVoxelDeltas } from "./save_schema.js";
import { regionVoxelDeltasToDeltas } from "./save_schema.js";

function voxelSortKey(delta: VoxelDelta): string {
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

export function canonicalVoxelSnapshot(snapshot: VoxelEditSnapshot): VoxelEditSnapshot {
  const latestByVoxel = new Map<string, VoxelDelta>();
  let revision = snapshot.revision;

  for (const delta of snapshot.deltas) {
    revision = Math.max(revision, delta.revision);
    const key = voxelSortKey(delta);
    const existing = latestByVoxel.get(key);
    if (!existing || delta.revision >= existing.revision) latestByVoxel.set(key, cloneDelta(delta));
  }

  return {
    revision,
    deltas: [...latestByVoxel.values()].sort(compareVoxelDeltas),
  };
}

export function partitionVoxelSnapshot(snapshot: VoxelEditSnapshot): RegionVoxelDeltas[] {
  const canonical = canonicalVoxelSnapshot(snapshot);
  const byRegion = new Map<string, VoxelDelta[]>();

  for (const delta of canonical.deltas) {
    const regionKey = regionKeyForWorld(delta.x, delta.z);
    const region = byRegion.get(regionKey);
    if (region) region.push(cloneDelta(delta));
    else byRegion.set(regionKey, [cloneDelta(delta)]);
  }

  return [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([regionKey, deltas]) => ({
      schemaVersion: SAVE_SCHEMA_VERSION,
      regionKey,
      format: "json",
      deltas,
    }));
}

export function mergePartitionedVoxelSnapshots(parts: readonly RegionVoxelDeltas[]): VoxelEditSnapshot {
  const latestByVoxel = new Map<string, VoxelDelta>();
  let revision = 0;

  for (const part of parts) {
    for (const delta of regionVoxelDeltasToDeltas(part)) {
      const actualRegion = regionKeyForWorld(delta.x, delta.z);
      if (actualRegion !== part.regionKey) {
        throw new Error(`voxel delta belongs to ${actualRegion}, not ${part.regionKey}`);
      }
      revision = Math.max(revision, delta.revision);
      const key = voxelSortKey(delta);
      const existing = latestByVoxel.get(key);
      if (!existing || delta.revision >= existing.revision) latestByVoxel.set(key, cloneDelta(delta));
    }
  }

  return {
    revision,
    deltas: [...latestByVoxel.values()].sort(compareVoxelDeltas),
  };
}

export function voxelDeltaCount(parts: readonly RegionVoxelDeltas[]): number {
  return parts.reduce((total, part) => total + regionVoxelDeltasToDeltas(part).length, 0);
}
