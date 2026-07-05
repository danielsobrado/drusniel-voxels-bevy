import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { SaveRegionRecords } from "../region_store.js";
import {
  openSaveDb,
  readRegionRecords,
  readSaveManifest,
  readWorldMetadata,
  writeRegionRecords,
  writeSaveManifestAndMetadata,
} from "../save_db.js";
import type { SaveWorldManifest, WorldMetadataRecord } from "../save_schema.js";

function dbName(): string {
  return `drusniel-save-test-${Date.now()}-${Math.random()}`;
}

function worldManifest(regionKeys = ["r_0_0"]): SaveWorldManifest {
  return {
    schemaVersion: 1,
    saveId: "qa-save",
    worldId: "world-1",
    seed: 1,
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

function records(revision: number, density: number): SaveRegionRecords {
  return {
    manifest: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      rx: 0,
      rz: 0,
      revision,
      authorityRevision: revision,
      voxelDeltaCount: 1,
      propCount: 1,
      updatedAt: "2026-07-05T00:00:01.000Z",
    },
    voxelDeltas: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      format: "json",
      deltas: [{ x: 1, y: 2, z: 3, density, revision }],
    },
    props: [{
      id: "p_000001_ab12",
      prefabId: "building/wall",
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      regionKey: "r_0_0",
      state: "active",
      tags: [],
    }],
  };
}

describe("save IndexedDB", () => {
  it("writes a region atomically and survives reopen", async () => {
    const name = dbName();
    let db = await openSaveDb(indexedDB, name);
    await writeRegionRecords(db, "qa-save", records(1, 0.25));
    db.close();

    db = await openSaveDb(indexedDB, name);
    const loaded = await readRegionRecords(db, "qa-save", "r_0_0");
    db.close();

    expect(loaded?.manifest.revision).toBe(1);
    expect(loaded?.voxelDeltas.deltas[0]?.density).toBe(0.25);
    expect(loaded?.props[0]?.id).toBe("p_000001_ab12");
  });

  it("interrupted write leaves the previous revision intact", async () => {
    const name = dbName();
    const db = await openSaveDb(indexedDB, name);
    await writeRegionRecords(db, "qa-save", records(1, 0.25));

    await expect(writeRegionRecords(db, "qa-save", records(2, 0.75), { abortBeforeCommit: true })).rejects.toThrow();
    const loaded = await readRegionRecords(db, "qa-save", "r_0_0");
    db.close();

    expect(loaded?.manifest.revision).toBe(1);
    expect(loaded?.voxelDeltas.deltas[0]?.density).toBe(0.25);
  });

  it("writes manifest and metadata together", async () => {
    const name = dbName();
    const db = await openSaveDb(indexedDB, name);
    await writeSaveManifestAndMetadata(db, worldManifest(), metadata());

    const loadedManifest = await readSaveManifest(db, "qa-save");
    const loadedMetadata = await readWorldMetadata(db, "qa-save");
    db.close();

    expect(loadedManifest?.regionKeys).toEqual(["r_0_0"]);
    expect(loadedMetadata?.revision).toBe(1);
  });
});
