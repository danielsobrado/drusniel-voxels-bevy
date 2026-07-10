import { afterEach, describe, expect, it } from "vitest";
import { createTerrainEditChangeTracker } from "../far_light_height.js";
import { addDigEdit, clearDigEdits, getVoxelEditSnapshot, replaceVoxelEdits, surfaceHeight } from "../../terrain.js";

afterEach(clearDigEdits);

describe("terrain edit change tracker", () => {
  it("reports no regions when nothing changed", () => {
    const tracker = createTerrainEditChangeTracker();
    expect(tracker.consumeChangedRegions()).toEqual([]);
  });

  it("reports a region covering a new dig edit, then nothing on the next call", () => {
    const tracker = createTerrainEditChangeTracker();
    const x = 100;
    const z = 100;
    addDigEdit({ x, y: surfaceHeight(x, z), z, r: 3 });
    const regions = tracker.consumeChangedRegions();
    expect(regions).not.toBeNull();
    expect(regions!.length).toBeGreaterThan(0);
    const region = regions![0];
    expect(region.minX).toBeLessThanOrEqual(x);
    expect(region.maxX).toBeGreaterThanOrEqual(x);
    expect(region.minZ).toBeLessThanOrEqual(z);
    expect(region.maxZ).toBeGreaterThanOrEqual(z);
    expect(tracker.consumeChangedRegions()).toEqual([]);
  });

  it("reports no regions when the same snapshot is reloaded (streaming world rebuild)", () => {
    const x = 100;
    const z = 100;
    addDigEdit({ x, y: surfaceHeight(x, z), z, r: 3 });
    const tracker = createTerrainEditChangeTracker();
    replaceVoxelEdits(getVoxelEditSnapshot());
    expect(tracker.consumeChangedRegions()).toEqual([]);
  });

  it("requests a full refresh when edits are removed", () => {
    const x = 100;
    const z = 100;
    addDigEdit({ x, y: surfaceHeight(x, z), z, r: 3 });
    const tracker = createTerrainEditChangeTracker();
    clearDigEdits();
    expect(tracker.consumeChangedRegions()).toBeNull();
  });
});
