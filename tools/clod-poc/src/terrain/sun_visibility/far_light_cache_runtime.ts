import { sunVisibilityTileKeyToString } from "./sun_visibility_tile.js";
import { buildLightTile } from "./light_builder.js";
import { createSunLightCacheCore } from "./light_cache_core.js";
import type { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";

export function createSunLightCacheRuntime(options: any) {
  const core = createSunLightCacheCore(options);
  const staleTiles = new Set<string>();

  return {
    readWorld: core.readWorld,
    enqueueTile: core.enqueueTile,
    updateBudgeted(provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>, frameIndex: number, nowMs: number) {
      core.stats.tilesBuiltThisFrame = 0;
      core.stats.buildMsLastFrame = 0;
      if (!options.active) return;
      const startedAt = nowMs;
      for (const [key, request] of [...core.pending.entries()]) {
        if (core.stats.tilesBuiltThisFrame >= options.build.maxTilesPerFrame) break;
        if (performance.now() - startedAt >= options.build.maxBuildMsPerFrame) break;
        core.pending.delete(key);
        const tile = buildLightTile({ ...request, frameIndex }, provider, options);
        core.entries.set(key, { tile, lastUsedFrame: frameIndex });
        staleTiles.delete(sunVisibilityTileKeyToString(request.tile));
        core.stats.tilesBuiltThisFrame += 1;
        core.stats.tilesBuiltTotal += 1;
      }
      core.stats.buildMsLastFrame = performance.now() - startedAt;
      core.stats.buildMsAvg = core.stats.tilesBuiltTotal > 0
        ? core.stats.buildMsAvg * 0.9 + core.stats.buildMsLastFrame * 0.1
        : core.stats.buildMsLastFrame;
      core.evictIfNeeded();
    },
    markAllStale() {
      core.entries.clear();
      core.pending.clear();
      staleTiles.clear();
      core.stats.refreshes += 1;
    },
    stats() {
      core.stats.entries = core.entries.size;
      core.stats.pendingTiles = core.pending.size;
      return { ...core.stats, staleTiles: staleTiles.size, currentSunBin: core.stats.currentSunBin ? { ...core.stats.currentSunBin } : null };
    },
  };
}
