import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveRegionRecords } from "../region_store.js";
import { openSaveDb, readRegionRecords, readSaveManifest, writeRegionRecords, writeSaveManifestAndMetadata } from "../save_db.js";
import {
  finalizeSaveManifestAndMetadata,
  flushDirtyRegionBatch,
  loadSavedWorldFromDb,
} from "../save_service.js";
import { regionVoxelDeltasToDeltas, type SavedPropInstance, type SaveWorldManifest, type WorldMetadataRecord } from "../save_schema.js";
import { clearSaveInvalidationTargets, registerSaveInvalidationTarget } from "../save_far_summary_bridge.js";
import { partitionSavedPropsByRegion } from "../prop_partition.js";
import { savedPropStore } from "../prop_store.js";
import { clearSaveRuntime, initSaveRuntime, upsertSaveRuntimeProp } from "../save_runtime.js";

function dbName(): string {
  return `drusniel-two-session-test-${Date.now()}-${Math.random()}`;
}

function manifest(regionKeys: string[] = ["r_0_0"]): SaveWorldManifest {
  return {
    schemaVersion: 1,
    saveId: "qa-save",
    worldId: "world-1",
    seed: 42,
    proceduralProfile: "infinite-islands-v1",
    regionSizeM: 512,
    chunkSizeM: 16,
    regionKeys,
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:01.000Z",
  };
}

function prop(): SavedPropInstance {
  return {
    id: "p_000001_ab12",
    prefabId: "building/wall",
    position: [1, 2, 3],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    regionKey: "r_0_0",
    state: "hidden",
    tags: ["gate"],
  };
}

function metadata(): WorldMetadataRecord {
  return {
    schemaVersion: 1,
    cities: [],
    districts: [],
    roads: [{
      id: "road-1",
      points: [[0, 0, 0], [8, 0, 8]],
      widthM: 4,
      materialId: 1,
      roadType: "dirt",
      connectedCityIds: [],
      criticalPathId: "path-1",
      revision: 1,
    }],
    caveEntrances: [],
    caveSystems: [],
    criticalPaths: [{
      id: "path-1",
      name: "Main path",
      purpose: "mainQuest",
      points: [[0, 0, 0], [8, 0, 8]],
      linkedRoadIds: ["road-1"],
      linkedPropIds: ["p_000001_ab12"],
      mustRemainPassable: true,
      status: "valid",
      revision: 1,
    }],
    revision: 7,
  };
}

function regionRecords(): SaveRegionRecords {
  return {
    manifest: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      rx: 0,
      rz: 0,
      revision: 1,
      authorityRevision: 3,
      voxelDeltaCount: 1,
      propCount: 1,
      updatedAt: "2026-07-05T00:00:01.000Z",
    },
    voxelDeltas: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      format: "json",
      deltas: [{ x: 1, y: 2, z: 3, density: 0.75, materialSlot: 2, revision: 3 }],
    },
    props: [prop()],
  };
}

describe("two-session saved world workflow", () => {
  afterEach(() => {
    clearSaveInvalidationTargets();
    clearSaveRuntime();
    vi.restoreAllMocks();
  });

  it("restores voxel deltas, props, metadata, and far invalidation in session B", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    await writeRegionRecords(db, "qa-save", regionRecords());
    await writeSaveManifestAndMetadata(db, manifest(), metadata());
    const replaceVoxelSnapshot = vi.fn();
    const invalidationTarget = { markSaveInvalidationBounds: vi.fn() };
    registerSaveInvalidationTarget(invalidationTarget);

    const loaded = await loadSavedWorldFromDb(db, "qa-save", {
      expectedSeed: 42,
      replaceVoxelSnapshot,
      publishLoadedRegionInvalidations: true,
      nowMs: () => 10,
    });
    db.close();

    expect(replaceVoxelSnapshot).toHaveBeenCalledWith(loaded.voxelSnapshot);
    expect(loaded.voxelSnapshot.deltas).toEqual(regionVoxelDeltasToDeltas(regionRecords().voxelDeltas));
    expect(loaded.regions[0]?.props[0]).toEqual(prop());
    expect(loaded.metadata.revision).toBe(7);
    expect(loaded.criticalPathValidation.errors).toEqual([]);
    expect(invalidationTarget.markSaveInvalidationBounds).toHaveBeenCalledWith({ minX: 0, minZ: 0, maxX: 512, maxZ: 512 });
  });

  it("rejects explicit seed mismatch before voxel replacement", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    await writeRegionRecords(db, "qa-save", regionRecords());
    await writeSaveManifestAndMetadata(db, manifest(), metadata());
    const replaceVoxelSnapshot = vi.fn();

    await expect(loadSavedWorldFromDb(db, "qa-save", { expectedSeed: 43, replaceVoxelSnapshot })).rejects.toThrow(/seed/i);
    db.close();

    expect(replaceVoxelSnapshot).not.toHaveBeenCalled();
  });

  it("keeps manifest region keys unchanged until all dirty batches are finalized", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    await writeSaveManifestAndMetadata(db, manifest([]), { ...metadata(), criticalPaths: [], roads: [] });
    const snapshot = {
      revision: 2,
      deltas: [
        { x: 1, y: 2, z: 3, density: 0.5, revision: 1 },
        { x: 512, y: 2, z: 3, density: 0.75, revision: 2 },
      ],
    };

    const first = await flushDirtyRegionBatch({
      db,
      saveId: "qa-save",
      manifest: manifest([]),
      metadata: { ...metadata(), criticalPaths: [], roads: [] },
      dirtyRegionKeys: ["r_0_0", "r_1_0"],
      snapshot,
      maxRegionWrites: 1,
    });
    expect(first).toEqual({ written: ["r_0_0"], pending: ["r_1_0"] });
    expect((await readSaveManifest(db, "qa-save"))?.regionKeys).toEqual([]);

    const second = await flushDirtyRegionBatch({
      db,
      saveId: "qa-save",
      manifest: manifest([]),
      metadata: { ...metadata(), criticalPaths: [], roads: [] },
      dirtyRegionKeys: first.pending,
      snapshot,
      maxRegionWrites: 1,
    });
    await finalizeSaveManifestAndMetadata(db, manifest([]), { ...metadata(), criticalPaths: [], roads: [] }, [...first.written, ...second.written]);

    expect((await readSaveManifest(db, "qa-save"))?.regionKeys).toEqual(["r_0_0", "r_1_0"]);
    db.close();
  });

  it("fails clearly when a manifest points at a missing region", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    await writeSaveManifestAndMetadata(db, manifest(["r_0_0", "r_1_0"]), metadata());

    await expect(loadSavedWorldFromDb(db, "qa-save", { expectedSeed: 42 })).rejects.toThrow(/save region not found: r_0_0/);
    db.close();
  });

  it("moving a saved prop across regions clears the old region record before reload", async () => {
    const db = await openSaveDb(indexedDB, dbName());
    await writeRegionRecords(db, "qa-save", regionRecords());
    await writeSaveManifestAndMetadata(db, manifest(), { ...metadata(), roads: [], criticalPaths: [] });
    const loaded = await loadSavedWorldFromDb(db, "qa-save", { expectedSeed: 42, replaceVoxelSnapshot: vi.fn() });
    initSaveRuntime(loaded);

    const movedProp = { ...prop(), position: [512, 2, 3] as [number, number, number], regionKey: "r_1_0" };
    const dirtyKeys = upsertSaveRuntimeProp(movedProp);
    expect(dirtyKeys).toEqual(["r_0_0", "r_1_0"]);

    const propsByRegion = partitionSavedPropsByRegion(savedPropStore.snapshot());
    const snapshot = { revision: 0, deltas: [] };
    const first = await flushDirtyRegionBatch({
      db,
      saveId: "qa-save",
      manifest: manifest(),
      metadata: { ...metadata(), roads: [], criticalPaths: [] },
      dirtyRegionKeys: dirtyKeys,
      propsByRegion,
      snapshot,
      maxRegionWrites: 1,
    });
    const second = await flushDirtyRegionBatch({
      db,
      saveId: "qa-save",
      manifest: manifest(),
      metadata: { ...metadata(), roads: [], criticalPaths: [] },
      dirtyRegionKeys: first.pending,
      propsByRegion,
      snapshot,
      maxRegionWrites: 1,
    });
    await finalizeSaveManifestAndMetadata(db, manifest(), { ...metadata(), roads: [], criticalPaths: [] }, [...manifest().regionKeys, ...first.written, ...second.written]);

    const oldRegion = await readRegionRecords(db, "qa-save", "r_0_0");
    const newRegion = await readRegionRecords(db, "qa-save", "r_1_0");
    const reloaded = await loadSavedWorldFromDb(db, "qa-save", { expectedSeed: 42, replaceVoxelSnapshot: vi.fn() });
    db.close();

    expect(oldRegion?.props).toEqual([]);
    expect(newRegion?.props).toEqual([movedProp]);
    expect(reloaded.regions.flatMap((region) => region.props).map((savedProp) => savedProp.id)).toEqual(["p_000001_ab12"]);
    expect(reloaded.regions.flatMap((region) => region.props)[0]).toEqual(movedProp);
  });
});
