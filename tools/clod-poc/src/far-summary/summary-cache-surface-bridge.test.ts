import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import { computeRequiredFarSummaryTiles } from "./clipmap-rings.js";
import { FarSummaryCache } from "./summary-cache.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import {
  connectSurfaceCommitBridge,
  emitSurfaceCommit,
  resetSurfaceCacheRevisionsForTests,
  surfaceRevisionAt,
} from "../stream/surface_cache_revisions.js";

const oldSampler: FarTerrainSampler = { sampleHeight: () => 10, sampleMaterial: () => 1 };
const newSampler: FarTerrainSampler = { sampleHeight: () => 80, sampleMaterial: () => 2 };

beforeEach(resetSurfaceCacheRevisionsForTests);

describe("far summary surface commit bridge", () => {
  it("catches up a lower-revision source recommit and rebuilds fallback-baked samples", async () => {
    emitSurfaceCommit({ minX: 2048, minZ: 2048, maxX: 2304, maxZ: 2304 });
    emitSurfaceCommit({ minX: 2304, minZ: 2048, maxX: 2560, maxZ: 2304 });
    const config = structuredClone(DEFAULT_FAR_SUMMARY_CONFIG);
    config.stream.maxTileBuildsPerFrame = 500;
    config.stream.maxTileCommitsPerFrame = 500;
    const cache = new FarSummaryCache(config, surfaceRevisionAt);
    const requests = computeRequiredFarSummaryTiles({
      worldX: 0, worldZ: 0, predictedX: 0, predictedZ: 0, velocityX: 0, velocityZ: 0,
    }, config);
    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(oldSampler, 0, 0);
    const bakedRevision = cache.getTile({ ring: 0, x: 2, z: 2, cellSizeM: 32 })?.builtAtGlobalRevision;
    expect(bakedRevision).toBe(2);
    expect(cache.sample(2500, 2500, 0)?.heightAvg).toBe(10);

    // Recommit the first source after the summary has baked. Its local revision could still
    // be lower than the second source's; the shared global revision is what makes this visible.
    emitSurfaceCommit({ minX: 2048, minZ: 2048, maxX: 2304, maxZ: 2304 });
    const disconnect = connectSurfaceCommitBridge(cache, { sinceRevision: bakedRevision });
    await Promise.resolve();
    expect(cache.getTile({ ring: 0, x: 2, z: 2, cellSizeM: 32 })?.state).toBe("stale");

    cache.requestTiles(requests, 1, 16);
    cache.buildSomeTiles(newSampler, 1, 16);
    expect(cache.sample(2500, 2500, 0)?.heightAvg).toBe(80);
    disconnect();
  });
});
