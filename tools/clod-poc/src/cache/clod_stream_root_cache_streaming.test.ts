import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClodPageNode } from "../types.js";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../stream/terrain_streaming_control.js";
import type { ClodCacheContext } from "./clodCacheContext.js";
import {
  beginStreamRootCacheOperation,
  createEmptyStreamRootCacheStats,
  storeStreamRootNode,
  streamRootCacheOperationGeneration,
  streamRootCacheOperationIsCurrent,
} from "./clodStreamRootCache.js";

beforeEach(() => resetTerrainStreamingControlForTests());

describe("stream-root cache streaming token", () => {
  it("rejects cache work captured before a pause generation change", () => {
    const stats = createEmptyStreamRootCacheStats();
    expect(streamRootCacheOperationIsCurrent(stats)).toBe(true);
    expect(streamRootCacheOperationGeneration(stats)).toBe(0);

    setTerrainStreamingEnabled(false);
    setTerrainStreamingEnabled(true);

    expect(streamRootCacheOperationIsCurrent(stats)).toBe(false);
    expect(streamRootCacheOperationGeneration(stats)).toBe(0);
    const currentStats = createEmptyStreamRootCacheStats();
    expect(streamRootCacheOperationGeneration(currentStats)).toBe(2);
    expect(streamRootCacheOperationIsCurrent(currentStats)).toBe(true);
  });

  it("conservatively blocks cache writes while a stale root request is still active", () => {
    const finish = beginStreamRootCacheOperation();
    setTerrainStreamingEnabled(false);
    setTerrainStreamingEnabled(true);

    expect(streamRootCacheOperationIsCurrent(createEmptyStreamRootCacheStats())).toBe(false);

    finish();
    expect(streamRootCacheOperationIsCurrent(createEmptyStreamRootCacheStats())).toBe(true);
  });

  it("conditionally removes a cache entry committed across a pause generation change", async () => {
    const deleteEntry = vi.fn(async () => true);
    const context = {
      effective: true,
      config: {
        namespace: "test",
        schema_version: 1,
        builder_version: "test",
      },
      worldSeed: "test",
      generatorVersion: "test",
      terrainSourceHash: "test-source",
      configHash: "test-config",
      service: {
        put: vi.fn(async () => {
          setTerrainStreamingEnabled(false);
          setTerrainStreamingEnabled(true);
          return { key: "stream-root", bytesWritten: 1, encodeMs: 0, compression: "none" };
        }),
        deleteIfMatches: deleteEntry,
      },
    } as unknown as ClodCacheContext;
    const stats = createEmptyStreamRootCacheStats();

    await storeStreamRootNode(context, "gpu", testNode(), 2, stats);

    expect(deleteEntry).toHaveBeenCalledOnce();
    expect(deleteEntry).toHaveBeenCalledWith(expect.any(Object), {
      terrainStreamingGeneration: 0,
      terrainStreamingWriteId: expect.any(String),
    });
    expect(stats.nodesBuilt).toBe(0);
  });

  it("does not count a broker-rejected write as a built cache node", async () => {
    const deleteEntry = vi.fn(async () => true);
    const context = {
      effective: true,
      config: {
        namespace: "test",
        schema_version: 1,
        builder_version: "test",
      },
      worldSeed: "test",
      generatorVersion: "test",
      terrainSourceHash: "test-source",
      configHash: "test-config",
      service: {
        put: vi.fn(async () => ({
          key: "stream-root",
          bytesWritten: 0,
          encodeMs: 0,
          compression: "none",
        })),
        deleteIfMatches: deleteEntry,
      },
    } as unknown as ClodCacheContext;
    const stats = createEmptyStreamRootCacheStats();

    await storeStreamRootNode(context, "cpu", testNode(), 3, stats);

    expect(deleteEntry).not.toHaveBeenCalled();
    expect(stats.nodesBuilt).toBe(0);
    expect(stats.coldBuildMs).toBe(0);
  });
});

function testNode(): ClodPageNode {
  return {
    id: "L0:0,0",
    level: 0,
    children: [],
    mesh: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      paintSlots: new Float32Array(3),
      materialWeights: new Float32Array(12),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 1, 2]),
    },
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 0 },
    errorWorld: 0,
    lowBenefit: false,
  };
}
