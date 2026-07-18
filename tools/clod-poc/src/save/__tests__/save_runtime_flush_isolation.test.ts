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

vi.mock("../save_db.js", () => ({ openSaveDb: mocks.openSaveDb }));
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

function prop(id: string, x = 1): SavedPropInstance {
  return {
    id,
    prefabId: "test/crate",
    position: [x, 2, 3],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    anchor: "terrain",
    regionKey: x >= 512 ? "r_1_0" : "r_0_0",
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

function region(savedProps: readonly SavedPropInstance[]): SaveRegionRecords {
  return {
    manifest: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      rx: 0,
      rz: 0,
      revision: 1,
      authorityRevision: 0,
      voxelDeltaCount: 0,
      propCount: savedProps.length,
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
    voxelDeltas: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      format: "json",
      deltas: [],
    },
    props: [...savedProps],
  };
}

function loaded(saveId: string, savedProps: readonly SavedPropInstance[]): LoadedSavedWorld {
  return {
    saveId,
    manifest: manifest(saveId),
    metadata: metadata(),
    regions: [region(savedProps)],
    voxelSnapshot: { revision: 0, deltas: [] },
    voxelDeltaCount: 0,
    propInstanceCount: savedProps.length,
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
    mocks.flushDirtyRegionBatch.mockImplementation(async (input: {
      dirtyRegionKeys: readonly string[];
      maxRegionWrites?: number;
    }) => {
      const limit = Math.max(0, Math.floor(input.maxRegionWrites ?? 1));
      return {
        written: input.dirtyRegionKeys.slice(0, limit),
        pending: input.dirtyRegionKeys.slice(limit),
      };
    });
    mocks.finalizeSaveManifestAndMetadata.mockImplementation(async (
      _db: IDBDatabase,
      value: SaveWorldManifest,
      _metadata: WorldMetadataRecord,
      regionKeys: readonly string[],
    ) => ({ ...value, regionKeys: [...new Set(regionKeys)].sort() }));
  });

  afterEach(() => {
    attachSaveRuntimeCounters(null);
    clearSaveRuntime();
  });

  it("drains every captured outgoing region after a runtime replacement", async () => {
    const oldSnapshots = new Map([
      ["r_0_0", { revision: 1, deltas: [{ x: 1, y: 2, z: 3, density: 0.5, revision: 1 }] }],
      ["r_1_0", { revision: 1, deltas: [{ x: 513, y: 2, z: 3, density: 0.75, revision: 1 }] }],
    ]);
    const counters: Partial<SaveRuntimeCounters> = {};
    attachSaveRuntimeCounters(counters);
    mocks.voxelEditCount.mockReturnValue(2);
    mocks.getVoxelEditSnapshotForBounds.mockImplementation((minX: number) => oldSnapshots.get(minX >= 512 ? "r_1_0" : "r_0_0"));

    initSaveRuntime(loaded("old-save", [prop("old-prop")]));
    expect(markSaveRegionsDirtyForBounds({ minX: 0, minZ: 0, maxX: 513, maxZ: 1 }))
      .toEqual(["r_0_0", "r_1_0"]);
    const flush = flushSaveRuntimeOnce(1);

    expect(mocks.openSaveDb).toHaveBeenCalledOnce();
    mocks.voxelEditCount.mockReturnValue(0);
    mocks.getVoxelEditSnapshotForBounds.mockReturnValue({ revision: 0, deltas: [] });
    initSaveRuntime(loaded("new-save", [prop("new-prop")]));

    resolveDb({ close: closeDb } as unknown as IDBDatabase);
    await flush;

    expect(mocks.flushDirtyRegionBatch).toHaveBeenCalledTimes(2);
    const calls = mocks.flushDirtyRegionBatch.mock.calls.map(([input]) => input as {
      saveId: string;
      dirtyRegionKeys: readonly string[];
      propsByRegion: ReadonlyMap<string, readonly SavedPropInstance[]>;
      snapshotForRegion: (regionKey: string) => { revision: number; deltas: readonly unknown[] };
    });
    expect(calls.map((input) => input.saveId)).toEqual(["old-save", "old-save"]);
    expect(calls.map((input) => input.dirtyRegionKeys)).toEqual([["r_0_0", "r_1_0"], ["r_1_0"]]);
    expect(calls[0]?.propsByRegion.get("r_0_0")?.map((value) => value.id)).toEqual(["old-prop"]);
    expect(calls[0]?.snapshotForRegion("r_0_0")).toEqual(oldSnapshots.get("r_0_0"));
    expect(calls[1]?.snapshotForRegion("r_1_0")).toEqual(oldSnapshots.get("r_1_0"));
    expect(mocks.finalizeSaveManifestAndMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ saveId: "old-save" }),
      expect.anything(),
      expect.arrayContaining(["r_0_0", "r_1_0"]),
    );
    expect(savedPropStore.snapshot().map((value) => value.id)).toEqual(["new-prop"]);
    expect(counters.save_last_flush_written_regions).toBe(0);
    expect(counters.save_last_flush_pending_regions).toBe(0);
    expect(counters.save_last_error).toBe(0);
    expect(isSaveRuntimeConverged()).toBe(true);
    expect(closeDb).toHaveBeenCalledOnce();
  });

  it("keeps the configured one-batch budget while the same runtime remains active", async () => {
    mocks.voxelEditCount.mockReturnValue(2);
    mocks.getVoxelEditSnapshotForBounds.mockReturnValue({ revision: 1, deltas: [] });
    initSaveRuntime(loaded("active-save", []));
    markSaveRegionsDirtyForBounds({ minX: 0, minZ: 0, maxX: 513, maxZ: 1 });
    const flush = flushSaveRuntimeOnce(1);
    resolveDb({ close: closeDb } as unknown as IDBDatabase);

    await flush;

    expect(mocks.flushDirtyRegionBatch).toHaveBeenCalledOnce();
    expect(isSaveRuntimeConverged()).toBe(false);
  });
});
