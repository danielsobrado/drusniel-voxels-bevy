import { describe, expect, it } from "vitest";
import { SaveDirtyRegionRevisions } from "./save_dirty_region_revisions.js";

describe("SaveDirtyRegionRevisions", () => {
  it("acknowledges an unchanged dirty region", () => {
    const dirty = new SaveDirtyRegionRevisions();
    dirty.mark(["0,0"], 1);
    const snapshot = dirty.capture(["0,0"]);

    expect(dirty.acknowledge(["0,0"], snapshot)).toEqual(["0,0"]);
    expect(dirty.size).toBe(0);
  });

  it("keeps a region dirty when a newer edit arrives during the flush", () => {
    const dirty = new SaveDirtyRegionRevisions();
    dirty.mark(["0,0"], 1);
    const snapshot = dirty.capture(["0,0"]);
    dirty.mark(["0,0"], 2);

    expect(dirty.acknowledge(["0,0"], snapshot)).toEqual([]);
    expect(dirty.keys()).toEqual(["0,0"]);
  });
});
