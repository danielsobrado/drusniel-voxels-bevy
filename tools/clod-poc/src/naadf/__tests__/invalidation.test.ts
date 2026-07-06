import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFarSummaryTile, createFarSummaryTileBuild, farTileKeyString } from "../farClipmap.js";
import {
  invalidateNaadfBounds,
  registerNaadfSaveInvalidationTarget,
} from "../invalidation.js";
import { chunkKeyToString } from "../keys.js";
import { NaadfMetricsCollector } from "../metrics.js";
import { lookupValidatedChunkIndex, syncResidentLookupTables } from "../residentLookup.js";
import { createNaadfWorldState, type NaadfWorldState } from "../summaryStreamer.js";
import { createTerrainSource } from "../terrainSource.js";
import type { ChunkBrick, ChunkKey, ResidentChunkEntry, SummaryTileKey } from "../types.js";
import { createTestNaadfConfig } from "./testConfig.js";
import { clearSaveInvalidationTargets, markSaveInvalidationBounds } from "../../save/save_far_summary_bridge.js";
import { openSaveDb, writeRegionRecords, writeSaveManifestAndMetadata } from "../../save/save_db.js";
import { loadSavedWorldFromDb } from "../../save/save_service.js";
import type { SaveRegionRecords } from "../../save/region_store.js";
import type { SaveWorldManifest, WorldMetadataRecord } from "../../save/save_schema.js";

const DIRTY_BOUNDS = { minX: 4, minZ: 4, maxX: 8, maxZ: 8 };

afterEach(() => {
  clearSaveInvalidationTargets();
});

describe("naadf invalidation", () => {
  it("removes touched far tiles and leaves unrelated far tiles resident", () => {
    const state = createTestState();
    const touched = { ring: 0, x: 0, z: 0 };
    const unrelated = { ring: 0, x: 2, z: 2 };
    insertFarTile(state, touched);
    insertFarTile(state, unrelated);

    const result = invalidateNaadfBounds(state, DIRTY_BOUNDS);

    expect(result.farTilesRemoved).toBe(1);
    expect(state.farTiles.has(farTileKeyString(touched))).toBe(false);
    expect(state.farTileLastTouched.has(farTileKeyString(touched))).toBe(false);
    expect(state.farTiles.has(farTileKeyString(unrelated))).toBe(true);
  });

  it("treats non-point far dirty bounds as half-open at exact tile boundaries", () => {
    const state = createTestState();
    const tileSizeM = farTileSizeM(state, 0);
    const left = { ring: 0, x: 0, z: 0 };
    const right = { ring: 0, x: 1, z: 0 };
    insertFarTile(state, left);
    insertFarTile(state, right);

    const result = invalidateNaadfBounds(state, {
      minX: 0,
      minZ: 0,
      maxX: tileSizeM,
      maxZ: 1,
    });

    expect(result.farTilesRemoved).toBe(1);
    expect(state.farTiles.has(farTileKeyString(left))).toBe(false);
    expect(state.farTiles.has(farTileKeyString(right))).toBe(true);
  });

  it("treats negative non-point far dirty bounds as half-open at exact tile boundaries", () => {
    const state = createTestState();
    const tileSizeM = farTileSizeM(state, 0);
    const negative = { ring: 0, x: -1, z: -1 };
    const zeroX = { ring: 0, x: 0, z: -1 };
    insertFarTile(state, negative);
    insertFarTile(state, zeroX);

    const result = invalidateNaadfBounds(state, {
      minX: -tileSizeM,
      minZ: -tileSizeM,
      maxX: 0,
      maxZ: -tileSizeM + 1,
    });

    expect(result.farTilesRemoved).toBe(1);
    expect(state.farTiles.has(farTileKeyString(negative))).toBe(false);
    expect(state.farTiles.has(farTileKeyString(zeroX))).toBe(true);
  });

  it("maps exact point far dirty bounds to the actual tile", () => {
    const state = createTestState();
    const tileSizeM = farTileSizeM(state, 0);
    const left = { ring: 0, x: 0, z: 0 };
    const right = { ring: 0, x: 1, z: 0 };
    insertFarTile(state, left);
    insertFarTile(state, right);

    const result = invalidateNaadfBounds(state, {
      minX: tileSizeM,
      minZ: 0,
      maxX: tileSizeM,
      maxZ: 0,
    });

    expect(result.farTilesRemoved).toBe(1);
    expect(state.farTiles.has(farTileKeyString(left))).toBe(true);
    expect(state.farTiles.has(farTileKeyString(right))).toBe(false);
  });

  it("cancels active far tile builds touched by dirty bounds", () => {
    const state = createTestState();
    const touched = { ring: 0, x: 0, z: 0 };
    state.activeFarTileBuild = {
      tileKey: farTileKeyString(touched),
      build: createFarSummaryTileBuild(touched, touched.ring, state.config, state.source, 1),
    };

    const result = invalidateNaadfBounds(state, DIRTY_BOUNDS);

    expect(result.activeBuildsCancelled).toBe(1);
    expect(state.activeFarTileBuild).toBeNull();
  });

  it("marks overlapping resident chunks for rebuild without dropping ready bricks", () => {
    const state = createTestState();
    const overlapping = addResident(state, readyResident(state, { x: 0, z: 0 }));
    const outside = addResident(state, readyResident(state, { x: 4, z: 4 }));
    overlapping.pendingBrick = fakeBrick(state, overlapping.key, 99);
    overlapping.pendingMipChain = null;

    const result = invalidateNaadfBounds(state, DIRTY_BOUNDS);

    expect(result.residentsMarked).toBe(1);
    expect(overlapping.state).toBe("building");
    expect(overlapping.brick).not.toBeNull();
    expect(overlapping.pendingBrick).toBeNull();
    expect(outside.state).toBe("ready");
    const lookup = lookupValidatedChunkIndex(state.nearTable, state.hashFallback, state.residents, overlapping.key);
    expect(lookup.index).toBeGreaterThanOrEqual(0);
    expect(state.residents[lookup.index]).toBe(overlapping);
  });

  it("treats non-point resident dirty bounds as half-open at chunk boundaries", () => {
    const state = createTestState();
    const chunkSize = state.config.world.chunkSizeCells;
    const left = addResident(state, readyResident(state, { x: 0, z: 0 }));
    const right = addResident(state, readyResident(state, { x: 1, z: 0 }));

    const result = invalidateNaadfBounds(state, {
      minX: 0,
      minZ: 0,
      maxX: chunkSize,
      maxZ: 1,
    });

    expect(result.residentsMarked).toBe(1);
    expect(left.state).toBe("building");
    expect(right.state).toBe("ready");
  });

  it("treats negative non-point resident dirty bounds as half-open at chunk boundaries", () => {
    const state = createTestState();
    const chunkSize = state.config.world.chunkSizeCells;
    const negative = addResident(state, readyResident(state, { x: -1, z: -1 }));
    const zeroX = addResident(state, readyResident(state, { x: 0, z: -1 }));

    const result = invalidateNaadfBounds(state, {
      minX: -chunkSize,
      minZ: -chunkSize,
      maxX: 0,
      maxZ: -chunkSize + 1,
    });

    expect(result.residentsMarked).toBe(1);
    expect(negative.state).toBe("building");
    expect(zeroX.state).toBe("ready");
  });

  it("maps exact point resident dirty bounds to the actual chunk", () => {
    const state = createTestState();
    const chunkSize = state.config.world.chunkSizeCells;
    const left = addResident(state, readyResident(state, { x: 0, z: 0 }));
    const right = addResident(state, readyResident(state, { x: 1, z: 0 }));

    const result = invalidateNaadfBounds(state, {
      minX: chunkSize,
      minZ: 0,
      maxX: chunkSize,
      maxZ: 0,
    });

    expect(result.residentsMarked).toBe(1);
    expect(left.state).toBe("ready");
    expect(right.state).toBe("building");
  });

  it("receives save invalidation bridge publications through the NAADF target", () => {
    const state = createTestState();
    const touched = { ring: 0, x: 0, z: 0 };
    const resident = addResident(state, readyResident(state, { x: 0, z: 0 }));
    insertFarTile(state, touched);
    const unregister = registerNaadfSaveInvalidationTarget(state);

    markSaveInvalidationBounds(DIRTY_BOUNDS);
    unregister();

    expect(state.farTiles.has(farTileKeyString(touched))).toBe(false);
    expect(resident.state).toBe("building");
  });

  it("invalidates NAADF derived caches from save-load region publication", async () => {
    const state = createTestState();
    const touched = { ring: 0, x: 0, z: 0 };
    const resident = addResident(state, readyResident(state, { x: 0, z: 0 }));
    insertFarTile(state, touched);
    const unregister = registerNaadfSaveInvalidationTarget(state);

    const db = await openSaveDb(indexedDB, dbName());
    await writeRegionRecords(db, "qa-save", records("r_0_0"));
    await writeSaveManifestAndMetadata(db, manifest(["r_0_0"]), metadata());

    await loadSavedWorldFromDb(db, "qa-save", {
      expectedSeed: 7,
      replaceVoxelSnapshot: vi.fn(),
      nowMs: () => 10,
      publishLoadedRegionInvalidations: true,
    });
    db.close();
    unregister();

    expect(state.farTiles.has(farTileKeyString(touched))).toBe(false);
    expect(resident.state).toBe("building");
  });
});

function createTestState(): NaadfWorldState {
  const config = createTestNaadfConfig();
  const source = createTerrainSource("default", config.world.seed);
  return createNaadfWorldState(config, source, new NaadfMetricsCollector());
}

function farTileSizeM(state: NaadfWorldState, ringIndex: number): number {
  return state.config.farClipmap.rings[ringIndex]!.cellM * state.config.farClipmap.tileCells;
}

function insertFarTile(state: NaadfWorldState, key: SummaryTileKey): void {
  const tileKey = farTileKeyString(key);
  state.farTiles.set(tileKey, buildFarSummaryTile(key, key.ring, state.config, state.source, 1));
  state.farTileLastTouched.set(tileKey, 1);
}

function addResident(state: NaadfWorldState, entry: ResidentChunkEntry): ResidentChunkEntry {
  const index = state.residents.length;
  state.residents.push(entry);
  state.residentIndexByKey.set(chunkKeyToString(entry.key), index);
  syncResidentLookupTables(state.nearTable, state.hashFallback, state.residents, state.metrics);
  return entry;
}

function readyResident(state: NaadfWorldState, key: ChunkKey): ResidentChunkEntry {
  const brick = fakeBrick(state, key, 1);
  return {
    key,
    state: "ready",
    brick,
    mipChain: null,
    pendingBrick: null,
    pendingMipChain: null,
    revision: brick.revision,
    requestedFrame: 0,
    builtFrame: 0,
    lastTouchedFrame: 0,
    coolingSinceMs: 0,
  };
}

function fakeBrick(state: NaadfWorldState, key: ChunkKey, revision: number): ChunkBrick {
  const sizeCells = state.config.world.chunkSizeCells;
  const cells = sizeCells * sizeCells;
  return {
    key,
    originX: key.x * sizeCells,
    originZ: key.z * sizeCells,
    sizeCells,
    heights: new Float32Array(cells),
    materials: new Uint16Array(cells),
    canopyCoverage: new Float32Array(cells),
    waterCoverage: new Float32Array(cells),
    revision,
  };
}

function dbName(): string {
  return `drusniel-naadf-invalidation-test-${Date.now()}-${Math.random()}`;
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

function records(regionKey = "r_0_0"): SaveRegionRecords {
  const [rx, rz] = regionKey.slice(2).split("_").map(Number);
  return {
    manifest: {
      schemaVersion: 1,
      regionKey,
      rx: rx ?? 0,
      rz: rz ?? 0,
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
      deltas: [{ x: 1, y: 2, z: 3, density: 0.5, revision: 9 }],
    },
    props: [],
  };
}
