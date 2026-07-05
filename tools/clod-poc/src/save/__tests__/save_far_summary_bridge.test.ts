import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FAR_SUMMARY_CONFIG, type FarSummaryConfig } from "../../far-summary/config.js";
import { computeRequiredFarSummaryTiles } from "../../far-summary/clipmap-rings.js";
import { FarSummaryCache } from "../../far-summary/summary-cache.js";
import type { FarTerrainSampler } from "../../far-summary/summary-tile-builder.js";
import type { StreamCenter } from "../../far-summary/stream-center.js";
import {
  attachSaveFarInvalidationCounters,
  clearSaveInvalidationTargets,
  markSaveInvalidationBounds,
  registerSaveInvalidationTarget,
} from "../save_far_summary_bridge.js";
import {
  attachSaveRuntimeCounters,
  clearSaveRuntime,
  initSaveRuntime,
  markSaveRegionsDirtyForBounds,
  updateSaveRuntimeMetadata,
  upsertSaveRuntimeProp,
} from "../save_runtime.js";
import type { LoadedSavedWorld } from "../save_service.js";

const bounds = { minX: 2048, minZ: 2048, maxX: 3072, maxZ: 3072 };

const center: StreamCenter = {
  worldX: 0,
  worldZ: 0,
  predictedX: 0,
  predictedZ: 0,
  velocityX: 0,
  velocityZ: 0,
};

const flatSampler: FarTerrainSampler = {
  sampleHeight: () => 50,
  sampleMaterial: () => 1,
};

function farSummaryConfig(): FarSummaryConfig {
  return {
    ...DEFAULT_FAR_SUMMARY_CONFIG,
    stream: {
      ...DEFAULT_FAR_SUMMARY_CONFIG.stream,
      maxTileBuildsPerFrame: 500,
      maxTileCommitsPerFrame: 500,
    },
    rings: DEFAULT_FAR_SUMMARY_CONFIG.rings.map((ring) => ({ ...ring })),
    sampling: { ...DEFAULT_FAR_SUMMARY_CONFIG.sampling },
    debug: { ...DEFAULT_FAR_SUMMARY_CONFIG.debug },
  };
}

function loadedWorld(): LoadedSavedWorld {
  return {
    saveId: "qa-save",
    manifest: {
      schemaVersion: 1,
      saveId: "qa-save",
      worldId: "world-1",
      seed: 7,
      proceduralProfile: "infinite-islands-v1",
      regionSizeM: 512,
      chunkSizeM: 16,
      regionKeys: [],
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
    },
    metadata: {
      schemaVersion: 1,
      cities: [],
      districts: [],
      roads: [],
      caveEntrances: [],
      caveSystems: [],
      criticalPaths: [],
      revision: 0,
    },
    regions: [],
    voxelSnapshot: { revision: 0, deltas: [] },
    voxelDeltaCount: 0,
    propInstanceCount: 0,
    criticalPathValidation: { errors: [], warnings: [], touchedCriticalPathIds: [], durationMs: 0 },
    loadMs: 0,
  };
}

describe("save far-summary invalidation bridge", () => {
  afterEach(() => {
    clearSaveInvalidationTargets();
    attachSaveFarInvalidationCounters(null);
    attachSaveRuntimeCounters(null);
    clearSaveRuntime();
    vi.restoreAllMocks();
  });

  it("does nothing when no targets are registered", () => {
    expect(() => markSaveInvalidationBounds(bounds)).not.toThrow();
  });

  it("fans out exact bounds to one target", () => {
    const target = { markSaveInvalidationBounds: vi.fn() };

    registerSaveInvalidationTarget(target);
    markSaveInvalidationBounds(bounds);

    expect(target.markSaveInvalidationBounds).toHaveBeenCalledWith(bounds);
  });

  it("fans out exact bounds to multiple targets", () => {
    const first = { markSaveInvalidationBounds: vi.fn() };
    const second = { markSaveInvalidationBounds: vi.fn() };

    registerSaveInvalidationTarget(first);
    registerSaveInvalidationTarget(second);
    markSaveInvalidationBounds(bounds);

    expect(first.markSaveInvalidationBounds).toHaveBeenCalledWith(bounds);
    expect(second.markSaveInvalidationBounds).toHaveBeenCalledWith(bounds);
  });

  it("continues fan-out when one target throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const counters = {};
    const throwing = {
      markSaveInvalidationBounds: vi.fn(() => {
        throw new Error("target failed");
      }),
    };
    const receiving = { markSaveInvalidationBounds: vi.fn() };

    attachSaveFarInvalidationCounters(counters);
    registerSaveInvalidationTarget(throwing);
    registerSaveInvalidationTarget(receiving);
    markSaveInvalidationBounds(bounds);

    expect(receiving.markSaveInvalidationBounds).toHaveBeenCalledWith(bounds);
    expect(counters).toMatchObject({
      save_far_invalidation_count: 1,
      save_far_invalidation_last_min_x: bounds.minX,
      save_far_invalidation_last_min_z: bounds.minZ,
      save_far_invalidation_last_max_x: bounds.maxX,
      save_far_invalidation_last_max_z: bounds.maxZ,
      save_far_invalidation_errors: 1,
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("marks intersecting far-summary tiles stale through a registered target", () => {
    const config = farSummaryConfig();
    const cache = new FarSummaryCache(config);
    const requests = computeRequiredFarSummaryTiles(center, config);
    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(flatSampler, 0, 0);
    expect(cache.sample(2500, 2500, 0)).not.toBeNull();

    registerSaveInvalidationTarget({
      markSaveInvalidationBounds: (dirtyBounds) => cache.markStale(dirtyBounds),
    });
    markSaveInvalidationBounds(bounds);

    expect(cache.getStats().staleTiles).toBeGreaterThan(0);
    expect(cache.sample(2500, 2500, 0)).not.toBeNull();
  });

  it("publishes dirty save bounds through markSaveRegionsDirtyForBounds", () => {
    const target = { markSaveInvalidationBounds: vi.fn() };
    const counters = {};
    initSaveRuntime(loadedWorld());
    attachSaveRuntimeCounters(counters);
    registerSaveInvalidationTarget(target);

    const dirtyKeys = markSaveRegionsDirtyForBounds(bounds);

    expect(dirtyKeys.length).toBeGreaterThan(0);
    expect(target.markSaveInvalidationBounds).toHaveBeenCalledWith(bounds);
    expect(counters).toMatchObject({
      save_loaded: 1,
      save_dirty_region_count: dirtyKeys.length,
      save_dirty_revision: 1,
      save_metadata_revision: 0,
      save_prop_count: 0,
      save_voxel_delta_count: 0,
      save_far_invalidation_count: 1,
    });
  });

  it("stops mutating an attached counter object after counters detach", () => {
    const counters = {};
    initSaveRuntime(loadedWorld());
    attachSaveRuntimeCounters(counters);
    attachSaveRuntimeCounters(null);

    markSaveRegionsDirtyForBounds(bounds);

    expect(counters).toMatchObject({ save_loaded: 1, save_dirty_region_count: 0 });
  });

  it("publishes metadata dirty bounds through the save invalidation bridge", () => {
    const target = { markSaveInvalidationBounds: vi.fn() };
    const loaded = loadedWorld();
    const metadata = {
      ...loaded.metadata,
      revision: 2,
    };
    initSaveRuntime(loaded);
    registerSaveInvalidationTarget(target);

    const dirtyKeys = updateSaveRuntimeMetadata(metadata, bounds);

    expect(dirtyKeys.length).toBeGreaterThan(0);
    expect(target.markSaveInvalidationBounds).toHaveBeenCalledWith(bounds);
  });

  it("publishes saved prop dirty bounds through the save invalidation bridge", () => {
    const target = { markSaveInvalidationBounds: vi.fn() };
    initSaveRuntime(loadedWorld());
    registerSaveInvalidationTarget(target);

    const dirtyKeys = upsertSaveRuntimeProp({
      id: "p_000001_ab12",
      prefabId: "building/wall",
      position: [4, 5, 6],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      regionKey: "r_0_0",
      state: "active",
      tags: [],
    });

    expect(dirtyKeys).toEqual(["r_0_0"]);
    expect(target.markSaveInvalidationBounds).toHaveBeenCalledWith({ minX: 4, minZ: 6, maxX: 4, maxZ: 6 });
  });
});
