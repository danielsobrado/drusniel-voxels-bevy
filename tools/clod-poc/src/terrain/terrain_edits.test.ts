import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDigEditTransaction,
  clearDigEdits,
  digEditCount,
  getDigEditRevision,
  getVoxelEditSnapshot,
  rollbackDigEditTransaction,
  type DigEdit,
  type VoxelEditTransaction,
} from "./terrain.js";

function emptyTransaction(): VoxelEditTransaction {
  return {
    id: 1,
    source: "test",
    revisionBase: getVoxelEditSnapshot().revision,
    deltas: [],
    previousValues: [],
    dirtyChunks: [],
    dirtyBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    affectedMaterialSlots: [],
  };
}

describe("terrain edit transactions", () => {
  beforeEach(() => clearDigEdits());

  it("does not record or revise an empty edit", () => {
    const transaction = emptyTransaction();
    const edit: DigEdit = { x: 0, y: 10, z: 0, r: 2, op: "remove", strength: 0 };
    const revision = getDigEditRevision();

    applyDigEditTransaction(transaction, edit);
    rollbackDigEditTransaction(transaction);

    expect(digEditCount()).toBe(0);
    expect(getDigEditRevision()).toBe(revision);
  });
});
