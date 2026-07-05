import { describe, expect, it } from "vitest";
import { assertRegionRecordSet, assertSavedPropInstance, type RegionManifest, type RegionVoxelDeltas, type SavedPropInstance } from "../save_schema.js";

function regionManifest(regionKey = "r_0_0", propCount = 1): RegionManifest {
  return {
    schemaVersion: 1,
    regionKey,
    rx: Number(regionKey.split("_")[1]),
    rz: Number(regionKey.split("_")[2]),
    revision: 1,
    authorityRevision: 0,
    voxelDeltaCount: 0,
    propCount,
    updatedAt: "2026-07-05T00:00:00.000Z",
  };
}

function voxelDeltas(regionKey = "r_0_0"): RegionVoxelDeltas {
  return { schemaVersion: 1, regionKey, format: "json", deltas: [] };
}

function prop(overrides: Partial<SavedPropInstance> = {}): SavedPropInstance {
  return {
    id: "p_000001_ab12",
    prefabId: "building/wall",
    position: [1, 2, 3],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    regionKey: "r_0_0",
    state: "active",
    tags: [],
    ...overrides,
  };
}

describe("saved prop integrity validation", () => {
  it("rejects saved props whose position belongs to another region", () => {
    const mismatchedProp = prop({ position: [512, 2, 3], regionKey: "r_0_0" });
    expect(() => assertRegionRecordSet(regionManifest(), voxelDeltas(), [mismatchedProp])).toThrow(/position region mismatch/i);
  });

  it("validates optional saved prop fields", () => {
    const notFinite = Math.sqrt(-1);
    const unbounded = Number.POSITIVE_INFINITY;

    expect(() => assertSavedPropInstance(prop({ seed: notFinite }))).toThrow(/seed/i);
    expect(() => assertSavedPropInstance(prop({ variationId: "bad" as unknown as number }))).toThrow(/variationId/i);
    expect(() => assertSavedPropInstance(prop({ flags: 1.5 }))).toThrow(/flags/i);
    expect(() => assertSavedPropInstance(prop({ revision: unbounded }))).toThrow(/revision/i);
    expect(() => assertSavedPropInstance(prop({ cityId: "" }))).toThrow(/cityId/i);
    expect(() => assertSavedPropInstance(prop({ seed: 1, variationId: 2, flags: 0, revision: 3, cityId: "city-1", roadId: "road-1", criticalPathId: "path-1", ownerFactionId: "faction-1" }))).not.toThrow();
  });
});
