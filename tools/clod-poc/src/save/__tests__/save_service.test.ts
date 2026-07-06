import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveRegionRecords } from "../region_store.js";
import { openSaveDb, writeRegionRecords, writeSaveManifestAndMetadata } from "../save_db.js";
import {
  loadSavedWorldFromDb,
  markRegionDirtyFromDirtyChunks,
  saveDirtyRegions,
  seedOverrideFromQuery,
  selectDirtyRegionWriteBatch,
} from "../save_service.js";
import { clearSaveInvalidationTargets, registerSaveInvalidationTarget } from "../save_far_summary_bridge.js";
import type { SaveWorldManifest, WorldMetadataRecord } from "../save_schema.js";
import { boundsForRegion } from "../world_metadata/metadata_store.js";

function dbName(): string {
  return `drusniel-save-service-test-${Date.now()}-${Math.random()}`;
}

function manifest(regionKeys = ["r_0_0"]): SaveWorldManifest {
  return {
    schemaVersion: 1,
    saveId: "qa-save",
    worldId: "world-1",
    seed: 7,
    proceduralProfile: "infinite-islands-v1",
    regionSizeM: 512,
    chunkSizeM: 16,
    regionKeys,
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:01.000Z",
  };
}

function metadata(): WorldMetadataRecord {
  return {
    schemaVersion: 1,
    cities: [],
    districts: [],
    roads: [],
    caveEntrances: [],
    caveSystems: [],
    criticalPaths: [],
    revision: 1,
  };
}

function records(regionKey = "r_0_0", x = 1): SaveRegionRecords {
  const [rx, rz] = regionKey.slice(2).split("_").map(Number);
  return {
    manifest: {
      schemaVersion: 1,
      regionKey,
      rx,
      rz,
      revision: 1,
      authorityRevision: 9,
      voxelDeltaCount: 1,
      propCount: 0,
      updatedAt: "2026-07-05T00:00:01.000Z",
    },
    voxelDeltas: {
      schemaVersion: 1,
      regionKey,
      format: "json",
      deltas: [{ x, y: 2, z: 3, density: 0.5, revision: 9 }],
    },
    props: [],
  };
}

afterEach(() => {
  clearSaveInvalidationTargets();
});

describe("save service", () => {
  it("loads by replacing voxel edits exactly once", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    await writeRegionRecords(db, "qa-save", records());
    await writeSaveManifestAndMetadata(db, manifest(), metadata());
    const replaceVoxelSnapshot = vi.fn();

    const loaded = await loadSavedWorldFromDb(db, "qa-save", { expectedSeed: 7, replaceVoxelSnapshot, nowMs: () => 10 });
    db.close();

    expect(replaceVoxelSnapshot).toHaveBeenCalledTimes(1);
    expect(replaceVoxelSnapshot.mock.calls[0]?.[0]).toEqual(loaded.voxelSnapshot);
    expect(loaded.voxelDeltaCount).toBe(1);
  });

  it("fails loud on seed mismatch before replacing voxel edits", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    await writeRegionRecords(db, "qa-save", records());
    await writeSaveManifestAndMetadata(db, manifest(), metadata());
    const replaceVoxelSnapshot = vi.fn();

    await expect(loadSavedWorldFromDb(db, "qa-save", { expectedSeed: 8, replaceVoxelSnapshot })).rejects.toThrow(/seed/i);
    db.close();

    expect(replaceVoxelSnapshot).not.toHaveBeenCalled();
  });

  it("uses explicit query seed only for save-load validation", () => {
    expect(seedOverrideFromQuery(new URLSearchParams("save=qa-save"))).toBeUndefined();
    expect(seedOverrideFromQuery(new URLSearchParams("save=qa-save&seed=7"))).toBe(7);
    expect(seedOverrideFromQuery(new URLSearchParams("save=qa-save&seed=bad"))).toBeUndefined();
  });

  it("tracks dirty regions from dirty chunk keys", () => {
    expect(markRegionDirtyFromDirtyChunks([
      { x: 0, y: 0, z: 0 },
      { x: 31, y: 0, z: 31 },
      { x: 32, y: 0, z: 0 },
      { x: -1, y: 0, z: -33 },
    ])).toEqual(["r_-1_-2", "r_0_0", "r_1_0"]);
  });

  it("autosave batch selection writes at most one region by default", () => {
    expect(selectDirtyRegionWriteBatch(["r_1_0", "r_0_0", "r_2_0"])).toEqual(["r_0_0"]);
  });

  it("saveDirtyRegions writes only the selected dirty batch", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    const result = await saveDirtyRegions({
      db,
      saveId: "qa-save",
      manifest: manifest([]),
      metadata: metadata(),
      dirtyRegionKeys: ["r_0_0", "r_1_0"],
      snapshot: {
        revision: 2,
        deltas: [
          { x: 1, y: 2, z: 3, density: 0.5, revision: 2 },
          { x: 512, y: 2, z: 3, density: 0.75, revision: 2 },
        ],
      },
    });
    db.close();

    expect(result).toEqual({ written: ["r_0_0"], pending: ["r_1_0"], finalized: false });
  });

  it("publishes invalidation bounds for written dirty regions only", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    const published: ReturnType<typeof boundsForRegion>[] = [];
    registerSaveInvalidationTarget({
      markSaveInvalidationBounds: (bounds) => published.push(bounds),
    });

    const result = await saveDirtyRegions({
      db,
      saveId: "qa-save",
      manifest: manifest([]),
      metadata: metadata(),
      dirtyRegionKeys: ["r_0_0", "r_1_0"],
      snapshot: {
        revision: 3,
        deltas: [
          { x: 1, y: 2, z: 3, density: 0.5, revision: 3 },
          { x: 512, y: 2, z: 3, density: 0.75, revision: 3 },
        ],
      },
    });
    db.close();

    expect(result.written).toEqual(["r_0_0"]);
    expect(result.pending).toEqual(["r_1_0"]);
    expect(published).toEqual([boundsForRegion("r_0_0")]);
  });

  it("publishes invalidation for committed dirty regions before a later batch failure", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    const published: ReturnType<typeof boundsForRegion>[] = [];
    registerSaveInvalidationTarget({
      markSaveInvalidationBounds: (bounds) => published.push(bounds),
    });

    await expect(saveDirtyRegions({
      db,
      saveId: "qa-save",
      manifest: manifest([]),
      metadata: metadata(),
      dirtyRegionKeys: ["r_0_0", "x_bad"],
      maxRegionWrites: 2,
      snapshot: {
        revision: 4,
        deltas: [{ x: 1, y: 2, z: 3, density: 0.5, revision: 4 }],
      },
    })).rejects.toThrow(/invalid region key/i);
    db.close();

    expect(published).toEqual([boundsForRegion("r_0_0")]);
  });
});
