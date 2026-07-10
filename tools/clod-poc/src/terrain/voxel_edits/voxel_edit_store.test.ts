import { describe, expect, it } from "vitest";
import { VoxelEditStore } from "./voxel_edit_store.js";
import type { VoxelEditTransaction } from "./voxel_edit_types.js";

function transaction(
  id: number,
  revisionBase: number,
  deltas: VoxelEditTransaction["deltas"],
  previousValues: VoxelEditTransaction["previousValues"] = [],
): VoxelEditTransaction {
  return {
    id,
    source: "test",
    revisionBase,
    deltas,
    previousValues,
    dirtyChunks: [{ x: 0, y: 0, z: 0 }],
    dirtyBounds: { minX: -32, maxX: 32, minY: -32, maxY: 32, minZ: -32, maxZ: 32 },
    affectedMaterialSlots: [],
  };
}

describe("VoxelEditStore", () => {
  it("restores only values touched by a failed transaction", () => {
    const store = new VoxelEditStore();
    store.apply(transaction(1, 0, [{ x: -1, y: 2, z: 3, density: 4 }]));
    const previous = store.voxelAt(-1, 2, 3)!;
    const edit = transaction(
      2,
      1,
      [
        { x: -1, y: 2, z: 3, density: 9 },
        { x: 16, y: 2, z: 3, density: 5 },
      ],
      [
        { x: -1, y: 2, z: 3, value: { ...previous } },
        { x: 16, y: 2, z: 3, value: null },
      ],
    );

    store.apply(edit);
    store.rollback(edit);

    expect(store.revision()).toBe(1);
    expect(store.voxelAt(-1, 2, 3)).toEqual(previous);
    expect(store.voxelAt(16, 2, 3)).toBeUndefined();
    expect(store.count()).toBe(1);
  });

  it("snapshots only voxels inside requested horizontal bounds", () => {
    const store = new VoxelEditStore();
    store.apply(transaction(1, 0, [
      { x: -17, y: 1, z: -1, density: 1 },
      { x: 4, y: 2, z: 4, density: 2, materialSlot: 3 },
      { x: 20, y: 3, z: 20, density: 3 },
    ]));

    expect(store.snapshotBounds(0, 16, 0, 16).deltas).toEqual([
      expect.objectContaining({ x: 4, y: 2, z: 4, materialSlot: 3 }),
    ]);
    expect(store.materialSlots()).toEqual([3]);
    expect(store.editedYRange(0, 16, 0, 16)).toEqual({ minY: 2, maxY: 2 });
  });

  it("rejects an out-of-order transaction", () => {
    const store = new VoxelEditStore();
    expect(() => store.apply(transaction(1, 2, [{ x: 0, y: 0, z: 0, density: 1 }]))).toThrow(/revision mismatch/);
  });
});
