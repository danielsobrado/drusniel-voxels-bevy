import { indexedDB } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import type { SaveRegionRecords } from "../region_store.js";
import { openSaveDb, writeRegionRecords, writeSaveManifestAndMetadata } from "../save_db.js";
import { loadSavedWorldFromDb } from "../save_service.js";
import type { SavedPropInstance, SaveWorldManifest, WorldMetadataRecord } from "../save_schema.js";

const SAVE_ID = "qa-save";

function saveManifest(): SaveWorldManifest {
  return {
    schemaVersion: 1,
    saveId: SAVE_ID,
    worldId: "world-1",
    seed: 42,
    proceduralProfile: "infinite-islands-v1",
    regionSizeM: 512,
    chunkSizeM: 16,
    regionKeys: ["r_0_0", "r_1_0"],
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:01.000Z",
  };
}

function emptyMetadata(): WorldMetadataRecord {
  return { schemaVersion: 1, cities: [], districts: [], roads: [], caveEntrances: [], caveSystems: [], criticalPaths: [], revision: 1 };
}

function savedProp(regionKey: string, position: [number, number, number]): SavedPropInstance {
  return {
    id: "p_000001_ab12",
    prefabId: "building/wall",
    position,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    regionKey,
    state: "active",
    tags: [],
  };
}

function records(regionKey: "r_0_0" | "r_1_0", position: [number, number, number]): SaveRegionRecords {
  return {
    manifest: {
      schemaVersion: 1,
      regionKey,
      rx: regionKey === "r_0_0" ? 0 : 1,
      rz: 0,
      revision: 1,
      authorityRevision: 0,
      voxelDeltaCount: 0,
      propCount: 1,
      updatedAt: "2026-07-05T00:00:01.000Z",
    },
    voxelDeltas: { schemaVersion: 1, regionKey, format: "json", deltas: [] },
    props: [savedProp(regionKey, position)],
  };
}

describe("load duplicate saved props", () => {
  it("rejects cross-region duplicate ids before applying voxels", async () => {
    const db = await openSaveDb(indexedDB, `drusniel-load-dup-${Date.now()}-${Math.random()}`);
    await writeRegionRecords(db, SAVE_ID, records("r_0_0", [1, 2, 3]));
    await writeRegionRecords(db, SAVE_ID, records("r_1_0", [512, 2, 3]));
    await writeSaveManifestAndMetadata(db, saveManifest(), emptyMetadata());
    const replaceVoxelSnapshot = vi.fn();

    await expect(loadSavedWorldFromDb(db, SAVE_ID, { replaceVoxelSnapshot })).rejects.toThrow(/duplicate saved prop id/i);
    db.close();
    expect(replaceVoxelSnapshot).not.toHaveBeenCalled();
  });
});
