import { describe, expect, it } from "vitest";
import type { VoxelEditSnapshot } from "../../terrain/voxel_edits/voxel_edit_types.js";
import { canonicalVoxelSnapshot, mergePartitionedVoxelSnapshots, partitionVoxelSnapshot, voxelDeltaCount } from "../voxel_partition.js";

function snapshot(): VoxelEditSnapshot {
  return {
    revision: 9,
    deltas: [
      { x: 1, y: 2, z: 3, density: 0.25, materialSlot: 1, revision: 5 },
      { x: 512, y: 2, z: 3, density: -0.5, revision: 6 },
      { x: -1, y: 8, z: -513, density: 0.75, materialSlot: 3, revision: 7 },
      { x: 1, y: 2, z: 3, density: 0.5, materialSlot: 2, revision: 8 },
    ],
  };
}

describe("voxel save partition", () => {
  it("assigns each canonical delta to exactly one region", () => {
    const parts = partitionVoxelSnapshot(snapshot());
    const keys = parts.map((part) => part.regionKey).sort();

    expect(keys).toEqual(["r_-1_-2", "r_0_0", "r_1_0"]);
    expect(voxelDeltaCount(parts)).toBe(3);
    for (const part of parts) {
      for (const delta of part.deltas) expect(part.regionKey).toBe(delta.x === 512 ? "r_1_0" : delta.x === -1 ? "r_-1_-2" : "r_0_0");
    }
  });

  it("partition then merge round-trips the canonical snapshot", () => {
    const canonical = canonicalVoxelSnapshot(snapshot());
    const merged = mergePartitionedVoxelSnapshots(partitionVoxelSnapshot(snapshot()));

    expect(merged.deltas).toEqual(canonical.deltas);
    expect(merged.revision).toBe(Math.max(...canonical.deltas.map((d) => d.revision)));
  });

  it("merge revision is max of parts", () => {
    const parts = partitionVoxelSnapshot(snapshot());
    parts[0] = { ...parts[0], deltas: parts[0].deltas.map((delta) => ({ ...delta, revision: 12 })) };

    expect(mergePartitionedVoxelSnapshots(parts).revision).toBe(12);
  });

  it("rejects deltas stored under the wrong region", () => {
    const parts = partitionVoxelSnapshot(snapshot());
    const broken = [{ ...parts[0], regionKey: "r_99_99" }, ...parts.slice(1)];

    expect(() => mergePartitionedVoxelSnapshots(broken)).toThrow(/belongs/i);
  });
});
