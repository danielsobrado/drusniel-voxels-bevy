import { sunVisibilityTileKeyToString, type SunVisibilityTileKey } from "./sun_visibility_tile.js";
import { createLightTileBuild, finalizeLightTile, stepLightTileBuild, type LightTileBuild } from "./light_builder.js";
import { createSunLightCacheCore } from "./light_cache_core.js";
import { sunBinKey } from "./sun_bins.js";
import type { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";
import type { SunLightOptions } from "./sun_light_options.js";

/** Pending tiles farther than materialTileRadius + this margin from the camera
 *  tile are dropped; they re-enqueue if the camera comes back. */
const PENDING_PRUNE_MARGIN_TILES = 2;

export function createSunLightCacheRuntime(options: SunLightOptions) {
  const core = createSunLightCacheCore(options);
  const staleTiles = new Set<string>();
  let inProgress: { key: string; build: LightTileBuild } | null = null;

  const prunePending = (centerTile: SunVisibilityTileKey | undefined): void => {
    const maxDistance = options.build.materialTileRadius + PENDING_PRUNE_MARGIN_TILES;
    const currentBin = core.stats.currentSunBin;
    for (const [key, request] of core.pending) {
      if (currentBin && sunBinKey(request.sunBin) !== sunBinKey(currentBin)) {
        core.pending.delete(key);
        continue;
      }
      if (!centerTile) continue;
      const distance = Math.max(
        Math.abs(request.tile.tileX - centerTile.tileX),
        Math.abs(request.tile.tileZ - centerTile.tileZ),
      );
      if (distance > maxDistance) core.pending.delete(key);
    }
  };

  const nearestPending = (centerTile: SunVisibilityTileKey | undefined): string | null => {
    let bestKey: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [key, request] of core.pending) {
      const distance = centerTile
        ? Math.max(
          Math.abs(request.tile.tileX - centerTile.tileX),
          Math.abs(request.tile.tileZ - centerTile.tileZ),
        )
        : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestKey = key;
        if (distance === 0) break;
      }
    }
    return bestKey;
  };

  return {
    readWorld: core.readWorld,
    peekWorld: core.peekWorld,
    enqueueTile: core.enqueueTile,
    updateBudgeted(
      provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>,
      frameIndex: number,
      nowMs: number,
      centerTile?: SunVisibilityTileKey,
    ) {
      core.stats.active = options.active;
      core.stats.tilesBuiltThisFrame = 0;
      core.stats.buildMsLastFrame = 0;
      if (!options.active) return;
      const startedAt = performance.now();
      const deadlineMs = nowMs + options.build.maxBuildMsPerFrame;
      prunePending(centerTile);

      while (core.stats.tilesBuiltThisFrame < options.build.maxTilesPerFrame) {
        if (!inProgress) {
          // A tile being built across frames gets re-enqueued each frame until
          // its entry lands; drop those duplicates instead of rebuilding.
          let key = nearestPending(centerTile);
          while (key !== null && core.entries.has(key)) {
            core.pending.delete(key);
            key = nearestPending(centerTile);
          }
          if (key === null) break;
          const request = core.pending.get(key)!;
          core.pending.delete(key);
          inProgress = { key, build: createLightTileBuild({ ...request, frameIndex }, options) };
        }
        if (!stepLightTileBuild(inProgress.build, provider, options, deadlineMs)) break;
        const tile = finalizeLightTile(inProgress.build);
        core.entries.set(inProgress.key, { tile, lastUsedFrame: frameIndex });
        staleTiles.delete(sunVisibilityTileKeyToString(tile.key));
        core.stats.tilesBuiltThisFrame += 1;
        core.stats.tilesBuiltTotal += 1;
        inProgress = null;
        if (performance.now() >= deadlineMs) break;
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
      core.stats.pendingTiles = core.pending.size + (inProgress ? 1 : 0);
      return { ...core.stats, staleTiles: staleTiles.size, currentSunBin: core.stats.currentSunBin ? { ...core.stats.currentSunBin } : null };
    },
  };
}
