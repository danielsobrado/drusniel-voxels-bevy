import { sunVisibilityTileKeyToString } from "./sun_visibility_tile.js";
import { createLightTileBuild, finalizeLightTile, stepLightTileBuild, type LightTileBuild, type LightTileBuildRequest } from "./light_builder.js";
import { createSunLightCacheCore } from "./light_cache_core.js";
import type { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";
import type { SunLightOptions } from "./sun_light_options.js";

export function createSunLightCacheRuntime(options: SunLightOptions) {
  const core = createSunLightCacheCore(options);
  const staleTiles = new Set<string>();
  let inProgress: { key: string; build: LightTileBuild } | null = null;

  const firstPending = (): [string, LightTileBuildRequest] | null => {
    const next = core.pending.entries().next();
    return next.done ? null : next.value;
  };

  const nearestPending = (centerTile: { tileX: number; tileZ: number }): [string, LightTileBuildRequest] | null => {
    let best: [string, LightTileBuildRequest] | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const entry of core.pending) {
      const dist = Math.max(
        Math.abs(entry[1].tile.tileX - centerTile.tileX),
        Math.abs(entry[1].tile.tileZ - centerTile.tileZ),
      );
      if (dist < bestDist) {
        bestDist = dist;
        best = entry;
      }
    }
    return best;
  };

  return {
    readWorld: core.readWorld,
    peekWorld: core.peekWorld,
    enqueueTile: core.enqueueTile,
    updateBudgeted(
      provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>,
      frameIndex: number,
      nowMs: number,
      centerTile?: { tileX: number; tileZ: number },
    ) {
      core.stats.active = options.active;
      core.stats.tilesBuiltThisFrame = 0;
      core.stats.buildMsLastFrame = 0;
      if (!options.active) {
        inProgress = null;
        return;
      }
      if (centerTile) {
        // Requests for tiles the camera left behind would otherwise sit ahead
        // of fresh ones forever (pending drains far slower than it fills).
        const keepRadius = options.build.materialTileRadius + 2;
        for (const [key, request] of core.pending) {
          const dist = Math.max(
            Math.abs(request.tile.tileX - centerTile.tileX),
            Math.abs(request.tile.tileZ - centerTile.tileZ),
          );
          if (dist > keepRadius) core.pending.delete(key);
        }
      }
      const startedAt = nowMs;
      const deadline = startedAt + options.build.maxBuildMsPerFrame;
      while (core.stats.tilesBuiltThisFrame < options.build.maxTilesPerFrame) {
        if (!inProgress) {
          const next = centerTile ? nearestPending(centerTile) : firstPending();
          if (!next) break;
          const [key, request] = next;
          core.pending.delete(key);
          inProgress = { key, build: createLightTileBuild({ ...request, frameIndex }, options) };
        }
        // A tile amortizes across frames: each frame continues where the last
        // one stopped and yields at the deadline instead of stalling the frame.
        const done = stepLightTileBuild(inProgress.build, provider, options, deadline);
        if (!done) break;
        const tile = finalizeLightTile(inProgress.build);
        core.entries.set(inProgress.key, { tile, lastUsedFrame: frameIndex });
        staleTiles.delete(sunVisibilityTileKeyToString(tile.key));
        inProgress = null;
        core.stats.tilesBuiltThisFrame += 1;
        core.stats.tilesBuiltTotal += 1;
        if (performance.now() >= deadline) break;
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
      inProgress = null;
      core.stats.refreshes += 1;
    },
    tiles() {
      return [...core.entries.values()].map((entry) => entry.tile);
    },
    stats() {
      core.stats.active = options.active;
      core.stats.entries = core.entries.size;
      core.stats.pendingTiles = core.pending.size;
      return { ...core.stats, staleTiles: staleTiles.size, currentSunBin: core.stats.currentSunBin ? { ...core.stats.currentSunBin } : null };
    },
  };
}
