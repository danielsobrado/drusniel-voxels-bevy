import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { deriveEnvironmentalPropId } from "../../world/prop_identity.js";
import { clearSaveRuntime, getSaveRuntimePropExclusions, initSaveRuntime, type SaveRuntimeCounters } from "../save_runtime.js";
import { loadSavedWorldFromDb } from "../save_service.js";
import { openSaveDb, writeRegionRecords, writeSaveManifestAndMetadata } from "../save_db.js";
import type { SavedPropInstance } from "../save_schema.js";

afterEach(clearSaveRuntime);

describe("environmental prop delta round trip", () => {
  it("keeps a destroyed tree absent after reload and publishes exclusion counters", async () => {
    const db = await openSaveDb(indexedDB, `env-prop-${Date.now()}-${Math.random()}`);
    const address = { tileKey: { x: 0, z: 0 }, layer: "tree" as const, candidateIndex: 9 };
    const prop: SavedPropInstance = {
      id: deriveEnvironmentalPropId("roundtrip-world", address), prefabId: "environment/tree",
      position: [12, 0, 12], rotation: [0, 0, 0, 1], scale: [1, 1, 1], regionKey: "r_0_0",
      state: "destroyed", tags: ["environmental"], environmental: address,
    };
    await writeRegionRecords(db, "env-roundtrip", {
      manifest: { schemaVersion: 1, regionKey: "r_0_0", rx: 0, rz: 0, revision: 1, authorityRevision: 0, voxelDeltaCount: 0, propCount: 1, updatedAt: "2026-07-14T00:00:00.000Z" },
      voxelDeltas: { schemaVersion: 1, regionKey: "r_0_0", format: "json", deltas: [] }, props: [prop],
    });
    await writeSaveManifestAndMetadata(db, {
      schemaVersion: 1, saveId: "env-roundtrip", worldId: "roundtrip-world", seed: 7,
      proceduralProfile: "infinite-islands-v1", regionSizeM: 512, chunkSizeM: 16, regionKeys: ["r_0_0"],
      createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z",
    }, { schemaVersion: 1, cities: [], districts: [], roads: [], caveEntrances: [], caveSystems: [], criticalPaths: [], revision: 1 });

    const loaded = await loadSavedWorldFromDb(db, "env-roundtrip", { replaceVoxelSnapshot: () => {} });
    const counters: Partial<SaveRuntimeCounters> = {};
    initSaveRuntime(loaded, counters);
    db.close();

    expect(loaded.regions[0]?.props[0]?.state).toBe("destroyed");
    expect(getSaveRuntimePropExclusions().isExcluded(address)).toBe(true);
    expect(counters.prop_delta_count).toBe(1);
    expect(counters.prop_exclusion_tiles).toBe(1);
  });
});
