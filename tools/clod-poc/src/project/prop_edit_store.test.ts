import { describe, expect, it } from "vitest";
import { PropEditStore } from "./prop_edit_store.js";

function makeStore(): PropEditStore {
  let n = 0;
  return new PropEditStore({ idFactory: () => `generated-${++n}` });
}

describe("PropEditStore", () => {
  it("adds, updates, removes, and snapshots project props", () => {
    const edits = makeStore();
    const added = edits.add({
      prefabId: "asset-a",
      position: [1, 2, 3],
      seed: 42,
    });

    expect(added.id).toBe("generated-1");
    expect(added.scale).toEqual([1, 1, 1]);
    expect(added.anchor).toBe("terrain");
    expect(added.revision).toBe(1);

    const updated = edits.update(added.id, {
      position: [4, 5, 6],
      rotation: [0, 0.70710678, 0, 0.70710678],
      scale: [2, 2, 2],
      anchor: "world",
    });

    expect(updated.position).toEqual([4, 5, 6]);
    expect(updated.anchor).toBe("world");
    expect(updated.revision).toBe(2);
    expect(edits.snapshot()).toHaveLength(1);

    const removed = edits.remove(added.id);
    expect(removed.changedPropIds).toEqual([added.id]);
    expect(edits.snapshot()).toEqual([]);
  });

  it("restores immutable snapshots and emits revisions", () => {
    const edits = makeStore();
    const revisions: number[] = [];
    edits.subscribe((result) => revisions.push(result.revision));

    edits.restore([{
      id: "prop-a",
      prefabId: "asset-b",
      position: [10, 20, 30],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      anchor: "terrain",
      seed: 9,
      variationId: 2,
      flags: 1,
      revision: 5,
    }]);

    const snapshot = edits.snapshot();
    snapshot[0]!.position[0] = 999;

    expect(revisions).toEqual([6]);
    expect(edits.revision()).toBe(6);
    expect(edits.get("prop-a")?.position).toEqual([10, 20, 30]);
    expect(edits.toPlacementScene("archive").instances[0]).toMatchObject({
      assetId: "asset-b",
      position: [10, 20, 30],
      seed: 9,
      variationId: 2,
      flags: 1,
      revision: 5,
    });
  });

  it("rejects invalid props and duplicate ids", () => {
    const edits = makeStore();
    edits.add({ id: "fixed", prefabId: "asset-a", position: [0, 0, 0] });

    expect(() => edits.add({ id: "fixed", prefabId: "asset-a", position: [0, 0, 0] })).toThrow(/already exists/i);
    expect(() => edits.add({ prefabId: "", position: [0, 0, 0] })).toThrow(/prefabId/i);
    expect(() => edits.add({ prefabId: "asset-a", position: [0, Number.NaN, 0] })).toThrow(/position/i);
    expect(() => edits.add({ prefabId: "asset-a", position: [0, 0, 0], scale: [1, 0, 1] })).toThrow(/scale/i);
  });
});
