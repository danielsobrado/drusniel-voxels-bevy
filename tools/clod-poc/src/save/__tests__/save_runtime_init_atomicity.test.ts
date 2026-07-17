import { afterEach, describe, expect, it } from "vitest";
import { projectPropEditStore } from "../../project/prop_edit_store.js";
import type { SaveRegionRecords } from "../region_store.js";
import type { LoadedSavedWorld } from "../save_service.js";
import type { SavedPropInstance, SaveWorldManifest, WorldMetadataRecord } from "../save_schema.js";
import { savedPropStore } from "../prop_store.js";
import {
  attachSaveRuntimeCounters,
  clearSaveRuntime,
  hasActiveSaveRuntime,
  initSaveRuntime,
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

function manifest(saveId: string, worldId: string): SaveWorldManifest {
  return {
    schemaVersion: 1,
    saveId,
    worldId,
    seed: 1,
    proceduralProfile: "infinite-islands-v1",
    regionSizeM: 512,
    chunkSizeM: 16,
    regionKeys: ["r_0_0"],
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}

function metadata(revision: number): WorldMetadataRecord {
  return {
    schemaVersion: 1,
    cities: [],
    districts: [],
    roads: [],
    caveEntrances: [],
    caveSystems: [],
    criticalPaths: [],
    revision,
  };
}

function region(props: SavedPropInstance[]): SaveRegionRecords {
  return {
    manifest: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      rx: 0,
      rz: 0,
      revision: 1,
      authorityRevision: 1,
      voxelDeltaCount: 0,
      propCount: props.length,
      updatedAt: "2026-07-17T00:00:00.000Z",
    },
    voxelDeltas: {
      schemaVersion: 1,
      regionKey: "r_0_0",
      format: "json",
      deltas: [],
    },
    props,
  };
}

function loaded(saveId: string, worldId: string, props: SavedPropInstance[], metadataRevision: number): LoadedSavedWorld {
  return {
    saveId,
    manifest: manifest(saveId, worldId),
    metadata: metadata(metadataRevision),
    regions: [region(props)],
    voxelSnapshot: { revision: 0, deltas: [] },
    voxelDeltaCount: 0,
    propInstanceCount: props.length,
    criticalPathValidation: { errors: [], warnings: [], touchedCriticalPathIds: [], durationMs: 0 },
    loadMs: 0,
  };
}

afterEach(() => {
  attachSaveRuntimeCounters(null);
  clearSaveRuntime();
});

describe("initSaveRuntime", () => {
  it("preserves the live runtime when the replacement payload fails validation", () => {
    const counters: Partial<SaveRuntimeCounters> = {};
    attachSaveRuntimeCounters(counters);
    initSaveRuntime(loaded("good-save", "good-world", [prop("existing")], 3));
    const beforeSaved = savedPropStore.snapshot();
    const beforeProject = projectPropEditStore.snapshot();
    const beforeHash = counters.save_id_hash;

    expect(() => initSaveRuntime(loaded(
      "bad-save",
      "bad-world",
      [prop("duplicate"), prop("duplicate")],
      99,
    ))).toThrow(/duplicate saved prop id/i);

    expect(hasActiveSaveRuntime()).toBe(true);
    expect(savedPropStore.snapshot()).toEqual(beforeSaved);
    expect(projectPropEditStore.snapshot()).toEqual(beforeProject);
    expect(counters.save_id_hash).toBe(beforeHash);
    expect(counters.save_metadata_revision).toBe(3);
  });
});
