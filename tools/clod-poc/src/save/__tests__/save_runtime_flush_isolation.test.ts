import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveRegionRecords } from "../region_store.js";
import type { LoadedSavedWorld } from "../save_service.js";
import type { SavedPropInstance, SaveWorldManifest, WorldMetadataRecord } from "../save_schema.js";

const mocks = vi.hoisted(() => ({
  openSaveDb: vi.fn(),
  flushDirtyRegionBatch: vi.fn(),
  finalizeSaveManifestAndMetadata: vi.fn(),
  getVoxelEditSnapshotForBounds: vi.fn(),
  voxelEditCount: vi.fn(),
}));

vi.mock("../save_db.js", () => ({
  openSaveDb: mocks.openSaveDb,
}));

vi.mock("../save_service.js", () => ({
  flushDirtyRegionBatch: mocks.flushDirtyRegionBatch,
  finalizeSaveManifestAndMetadata: mocks.finalizeSaveManifestAndMetadata,
}));

vi.mock("../../terrain/terrain.js", () => ({
  getVoxelEditSnapshotForBounds: mocks.getVoxelEditSnapshotForBounds,
  voxelEditCount: mocks.voxelEditCount,
}));

import { savedPropStore } from "../prop_store.js";
import {
  attachSaveRuntimeCounters,
  clearSaveRuntime,
  flushSaveRuntimeOnce,
  initSaveRuntime,
  isSaveRuntimeConverged,
  markSaveRegionsDirtyForBounds,
  type SaveRuntimeCounters,
} from "../save_runtime.js";

function prop(id: string): SavedPropInstance {
  return {
    id,
    prefabId: "test/crate",
    position: [1, 2, 3],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    anchor: "terrain",
    regionKey: "r_0_0",
    state: "active",
    tags: ["test"],
    revision: 1,
  };
}

function manifest(saveId: string): SaveWorldManifest {
  return {
    schemaVersion: 1,
    saveId,
    worldId: `world:${saveId}`,
    seed: 1,
    proceduralProfile: "continent-v1",
    regionSizeM: 512,
    chunkSizeM: 16,
    regionKeys: ["r_0_0"],
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
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
    revision: 0,
  };
}

function region(savedProp: SavedPropInstance): SaveRegionRecords {
  return {
    manifest: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      rx: 0,
      rz: 0,
      revision: 1,
      authorityRevision: 0,
      voxelDeltaCount: 0,
      propCount: 1,
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
    voxelDeltas: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      format: "json",
      deltas: [],
    },
    props: [savedProp],
  };
}

function loaded(saveId: string, savedProp: SavedPropInstance): LoadedSavedWorld {
  return {
    saveId,
    manifest: manifest(saveId),
    metadata: metadata(),
    regions: [region(savedProp)],
    voxelSnapshot: { revision: 0, deltas: [] },
    voxelDeltaCount: 0,
    propInstanceCount: 1,
    criticalPathValidation: { errors: [], warnings: [], touchedCriticalPathIds: [], durationMs: 0 },
    loadMs: 0,
  };
}

describe("save runtime flush isolation", () => {
  let resolveDb: (db: IDBDatabase) => void = () => {
    throw new Error("database resolver is not initialized");
  };
  let closeDb = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    closeDb = vi.fn();
    mocks.openSaveDb.mockImplementation(() => new Promise<IDBDatabase>((resolve) => {
      resolveDb = resolve;
    }));
    mocks.flushDirtyRegionBatch.mockImplementation(async (input: { dirtyRegionKeys: readonly string[] }) => ({
      written: [...input.dirtyRegionKeys],
      pending: [],
    }));
    mocks.finalizeSaveManifestAndMetadata.mockImplementation(async (
      _db: IDBDatabase,
      value: SaveWorldManifest,
      _metadata: WorldMetadataRecord,
      regionKeys: readonly string[],
    ) => ({ ...value, regionKeys: [...regionKeys] }));
  });

  afterEach(() => {
    attachSaveRuntimeCounters(null);
    clearSaveRuntime();
  });

  it("keeps outgoing data and diagnostics isolated when IndexedDB opens after a runtime replacement", async () => {
    const oldVoxelSnapshot = {
      revision: 1,
      deltas: [{ x: 1, y: 2, z: 3, density: 0.5, revision: 1 }],
    };
    const newVoxelSnapshot = {
      revision: 2,
      deltas: [{ x: 9, y: 8, z: 7, density: 0.75, revision: 2 }],
    };
    const counters: Partial<SaveRuntimeCounters> = {};
    attachSaveRuntimeCounters(counters);
    mocks.voxelEditCount.mockReturnValue(1);
    mocks.getVoxelEditSnapshotForBounds.mockReturnValue(oldVoxelSnapshot);

    initSaveRuntime(loaded("old-save", prop("old-prop")));
    markSaveRegionsDirtyForBounds({ minX: 0, minZ: 0, maxX: 1, maxZ: 1 });
    const flush = flushSaveRuntimeOnce(Number.MAX_SAFE_INTEGER);

    expect(mocks.openSaveDb).toHaveBeenCalledOnce();
    mocks.voxelEditCount.mockReturnValue(2);
    mocks.getVoxelEditSnapshotForBounds.mockReturnValue(newVoxelSnapshot);
    initSaveRuntime(loaded("new-save", prop("new-prop")));

    resolveDb({ close: closeDb } as unknown as IDBDatabase);
    await flush;

    const input = mocks.flushDirtyRegionBatch.mock.calls[0]?.[0] as {
      saveId: string;
      propsByRegion: ReadonlyMap<string, readonly SavedPropInstance[]>;
      snapshotForRegion: (regionKey: string) => typeof oldVoxelSnapshot;
    };
    expect(input.saveId).toBe("old-save");
    expect(input.propsByRegion.get("r_0_0")?.map((value) => value.id)).toEqual(["old-prop"]);
    expect(input.snapshotForRegion("r_0_0")).toEqual(oldVoxelSnapshot);
    expect(savedPropStore.snapshot().map((value) => value.id)).toEqual(["new-prop"]);
    expect(counters.save_last_flush_written_regions).toBe(0);
    expect(counters.save_last_flush_pending_regions).toBe(0);
    expect(counters.save_last_error).toBe(0);
    expect(isSaveRuntimeConverged()).toBe(true);
    expect(closeDb).toHaveBeenCalledOnce();
  });
});
