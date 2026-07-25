import { describe, expect, it } from "vitest";
import {
  buildHydrologyTileData,
  HydrologyTileCache,
  type HydrologyTileRemoteSource,
} from "./hydrologyTileSource.js";
import { leadHydrologyPrefetchCenter } from "./hydrology_prefetch_lead.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

// Validates the predictive-prefetch fix one link past the pure lead math: that leading the
// prefetch center ahead of travel actually streams a tile the player is walking toward that a
// camera-centered prefetch has NOT reached yet — against the real HydrologyTileCache and a mock
// worker. The remaining link (the async worker keeping up under real movement) is browser-only.

const sampler: TerrainHeightSampler = {
  surfaceHeight: (x: number, z: number) => 20 + Math.sin(x * 0.002) * 4 + Math.cos(z * 0.0017) * 3,
};
const OPTIONS = { tileSizeM: 256, tileRes: 4, maxResidentTiles: 256, drySentinelDepthM: 2 };

function cacheWithWorker(): HydrologyTileCache {
  const cache = new HydrologyTileCache(sampler, OPTIONS);
  const remote: HydrologyTileRemoteSource = {
    available: () => true,
    build: async (tiles) => tiles.map(({ tileX, tileZ }) => buildHydrologyTileData(tileX, tileZ, sampler, OPTIONS)),
  };
  cache.attachRemote(remote);
  return cache;
}

async function drainPrefetch(cache: HydrologyTileCache, centerX: number, centerZ: number, radiusM: number): Promise<void> {
  for (let pass = 0; pass < 40; pass++) {
    cache.prefetchAround(centerX, centerZ, radiusM);
    await Promise.resolve();
  }
}

describe("predictive hydrology prefetch reaches tiles ahead of travel", () => {
  it("streams a tile ahead of a fast walker that a camera-centered prefetch does not reach", async () => {
    const radiusM = 2 * OPTIONS.tileSizeM; // tile radius 2
    const camX = 10 * OPTIONS.tileSizeM;   // player standing on tile 10
    // Sprinting +x: 512m of travel in one frame caps the lead at radius/2 = 256m = one tile.
    const led = leadHydrologyPrefetchCenter(camX, 0, camX - 512, 0, 1 / 60, radiusM);
    expect(led.x).toBeCloseTo(camX + OPTIONS.tileSizeM, 6); // centered one tile ahead

    const ledCache = cacheWithWorker();
    const camCache = cacheWithWorker();
    await drainPrefetch(ledCache, led.x, led.z, radiusM);
    await drainPrefetch(camCache, camX, 0, radiusM);

    // Camera-centered reaches tile 12; leading reaches tile 13 — the tile the player is about
    // to enter is resident under the fix and still "unknown" without it.
    expect(camCache.peekTile(12, 0)).not.toBeNull();
    expect(camCache.peekTile(13, 0)).toBeNull();
    expect(ledCache.peekTile(13, 0)).not.toBeNull();
    // Safety invariant: leading never starves the current cell — it stays inside the footprint.
    expect(ledCache.peekTile(10, 0)).not.toBeNull();
  });
});
