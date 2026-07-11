import { sunVisibilityTileBounds, sunVisibilityTileKeyToString, type SunVisibilityTileKey } from "./sun_visibility_tile.js";
import { createLightTileBuild, finalizeLightTile, stepLightTileBuild, type LightTileBuild, type LightTileBuildRequest } from "./light_builder.js";
import { createSunLightCacheCore } from "./light_cache_core.js";
import { sunBinKey } from "./sun_bins.js";
import type { createTerrainSummaryLightHeightProvider, TerrainChangedRegion } from "./far_light_height.js";
import type { SunLightOptions } from "./sun_light_options.js";
import type { SunLightRemoteTileSource } from "./sun_light_worker_client.js";
import type { SunLightWorkerBuiltTile, SunLightWorkerTileRequest } from "./sun_light_worker_protocol.js";

/** Pending tiles farther than materialTileRadius + this margin from the camera
 *  tile are dropped; they re-enqueue if the camera comes back. */
const PENDING_PRUNE_MARGIN_TILES = 2;
/** Worker-path pacing: batches keep round-trips coarse, the inflight cap bounds
 *  wasted work after an invalidation, and the adoption cap bounds per-frame cost. */
const REMOTE_BATCH_TILES = 4;
const REMOTE_MAX_INFLIGHT_TILES = 16;
const REMOTE_MAX_ADOPTIONS_PER_FRAME = 24;

export function createSunLightCacheRuntime(options: SunLightOptions, remote?: SunLightRemoteTileSource | null) {
  const core = createSunLightCacheCore(options);
  const staleTiles = new Set<string>();
  let inProgress: { key: string; build: LightTileBuild } | null = null;
  // Tiles dispatched to the build worker and not yet adopted. Requests are retained so
  // invalidation can intersect their bounds and failures can re-queue them.
  const remoteInflight = new Map<string, LightTileBuildRequest>();
  let remoteCompleted: SunLightWorkerBuiltTile[] = [];
  /** Bumped whenever the set of built entries changes (build, eviction,
   *  invalidation), so consumers like the GPU atlas can skip repacking when
   *  nothing they read has changed. */
  let contentRevision = 0;

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

  const adoptRemoteTiles = (frameIndex: number): void => {
    let adopted = 0;
    while (remoteCompleted.length > 0 && adopted < REMOTE_MAX_ADOPTIONS_PER_FRAME) {
      const built = remoteCompleted.shift()!;
      const request = remoteInflight.get(built.key);
      remoteInflight.delete(built.key);
      // Dropped from inflight by invalidation / bin change while at the worker: discard.
      if (!request) continue;
      const currentBin = core.stats.currentSunBin;
      if (currentBin && sunBinKey(request.sunBin) !== sunBinKey(currentBin)) continue;
      core.entries.set(built.key, {
        tile: {
          key: request.tile,
          sunBin: request.sunBin,
          terrainRevision: request.terrainRevision,
          resolution: built.resolution,
          values: built.values,
          builtAtFrame: frameIndex,
        },
        lastUsedFrame: frameIndex,
      });
      staleTiles.delete(sunVisibilityTileKeyToString(request.tile));
      contentRevision += 1;
      core.stats.tilesBuiltThisFrame += 1;
      core.stats.tilesBuiltTotal += 1;
      adopted++;
    }
  };

  const dispatchRemoteBuilds = (centerTile: SunVisibilityTileKey | undefined): void => {
    if (!remote) return;
    while (remoteInflight.size < REMOTE_MAX_INFLIGHT_TILES && core.pending.size > 0) {
      const batch: SunLightWorkerTileRequest[] = [];
      const batchRequests: LightTileBuildRequest[] = [];
      while (batch.length < REMOTE_BATCH_TILES && remoteInflight.size < REMOTE_MAX_INFLIGHT_TILES) {
        // Skip tiles already built or already at the worker (enqueueTile re-adds
        // inflight tiles to pending each frame since it cannot see the worker queue).
        let key = nearestPending(centerTile);
        while (key !== null && (core.entries.has(key) || remoteInflight.has(key))) {
          core.pending.delete(key);
          key = nearestPending(centerTile);
        }
        if (key === null) break;
        const request = core.pending.get(key)!;
        core.pending.delete(key);
        remoteInflight.set(key, request);
        batchRequests.push(request);
        batch.push({
          key,
          tileX: request.tile.tileX,
          tileZ: request.tile.tileZ,
          lod: request.tile.lod,
          sunVec: [request.sunVec.x, request.sunVec.y, request.sunVec.z],
          sunBin: request.sunBin,
          terrainRevision: request.terrainRevision,
          frameIndex: request.frameIndex,
        });
      }
      if (batch.length === 0) return;
      remote.build(batch).then((built) => {
        remoteCompleted.push(...built);
        // Batches answered as [] raced a reconfigure; release their slots so they re-queue.
        if (built.length < batch.length) {
          const builtKeys = new Set(built.map((tile) => tile.key));
          for (const tile of batch) {
            if (builtKeys.has(tile.key)) continue;
            const request = remoteInflight.get(tile.key);
            remoteInflight.delete(tile.key);
            if (request && !core.entries.has(tile.key) && !core.pending.has(tile.key)) {
              core.pending.set(tile.key, request);
            }
          }
        }
      }).catch(() => {
        // Worker failed; release the slots so the main-thread build path picks them back up.
        for (let i = 0; i < batch.length; i++) {
          const tile = batch[i]!;
          const request = remoteInflight.get(tile.key);
          remoteInflight.delete(tile.key);
          if (request && !core.entries.has(tile.key) && !core.pending.has(tile.key)) {
            core.pending.set(tile.key, request);
          }
        }
      });
    }
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
      // A build for a superseded sun bin would burn the budget on a tile no
      // current lookup can read; drop it and let the tile re-enqueue under the
      // active bin.
      const currentBin = core.stats.currentSunBin;
      if (inProgress && currentBin && sunBinKey(inProgress.build.request.sunBin) !== sunBinKey(currentBin)) {
        inProgress = null;
      }
      if (currentBin) {
        for (const [key, request] of remoteInflight) {
          if (sunBinKey(request.sunBin) !== sunBinKey(currentBin)) remoteInflight.delete(key);
        }
      }

      if (remote?.available()) {
        // Worker path: tiles build off-thread; this frame only pays for adopting completed
        // results and dispatch bookkeeping. A build already in progress on the main thread
        // is re-queued so the worker owns it (its request is no longer in pending).
        if (inProgress) {
          if (!core.entries.has(inProgress.key) && !core.pending.has(inProgress.key)) {
            core.pending.set(inProgress.key, inProgress.build.request);
          }
          inProgress = null;
        }
        adoptRemoteTiles(frameIndex);
        dispatchRemoteBuilds(centerTile);
        core.stats.buildMsLastFrame = performance.now() - startedAt;
        core.stats.buildMsAvg = core.stats.tilesBuiltTotal > 0
          ? core.stats.buildMsAvg * 0.9 + core.stats.buildMsLastFrame * 0.1
          : core.stats.buildMsLastFrame;
        const remoteEvictionsBefore = core.stats.evictions;
        core.evictIfNeeded();
        if (core.stats.evictions !== remoteEvictionsBefore) contentRevision += 1;
        return;
      }

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
        contentRevision += 1;
        core.stats.tilesBuiltThisFrame += 1;
        core.stats.tilesBuiltTotal += 1;
        inProgress = null;
        if (performance.now() >= deadlineMs) break;
      }

      core.stats.buildMsLastFrame = performance.now() - startedAt;
      core.stats.buildMsAvg = core.stats.tilesBuiltTotal > 0
        ? core.stats.buildMsAvg * 0.9 + core.stats.buildMsLastFrame * 0.1
        : core.stats.buildMsLastFrame;
      const evictionsBefore = core.stats.evictions;
      core.evictIfNeeded();
      if (core.stats.evictions !== evictionsBefore) contentRevision += 1;
    },
    /** Drops built entries whose tile could be lit differently after a terrain
     *  change in the given regions. A receiver is affected when a change lies
     *  within the shadow-ray reach of its tile, so tiles are tested with their
     *  bounds expanded by ray.maxDistanceWorld. Pending requests stay queued
     *  (they sample live heights when built) and an in-progress build is only
     *  discarded when its own tile is affected. */
    invalidateRegions(regions: readonly TerrainChangedRegion[]) {
      if (regions.length === 0) return;
      const reach = options.ray.maxDistanceWorld;
      const intersects = (tile: SunVisibilityTileKey): boolean => {
        const bounds = sunVisibilityTileBounds(tile, options.tile);
        for (const region of regions) {
          if (bounds.minX - reach <= region.maxX && bounds.maxX + reach >= region.minX
            && bounds.minZ - reach <= region.maxZ && bounds.maxZ + reach >= region.minZ) return true;
        }
        return false;
      };
      for (const [key, entry] of core.entries) {
        if (intersects(entry.tile.key)) {
          core.entries.delete(key);
          contentRevision += 1;
        }
      }
      if (inProgress && intersects(inProgress.build.request.tile)) inProgress = null;
      for (const [key, request] of remoteInflight) {
        if (intersects(request.tile)) remoteInflight.delete(key);
      }
    },
    markAllStale() {
      core.entries.clear();
      core.pending.clear();
      staleTiles.clear();
      inProgress = null;
      remoteInflight.clear();
      remoteCompleted = [];
      contentRevision += 1;
      core.stats.refreshes += 1;
    },
    contentRevision() {
      return contentRevision;
    },
    tiles() {
      return [...core.entries.values()].map((entry) => entry.tile);
    },
    stats() {
      core.stats.active = options.active;
      core.stats.entries = core.entries.size;
      core.stats.pendingTiles = core.pending.size + (inProgress ? 1 : 0) + remoteInflight.size + remoteCompleted.length;
      return { ...core.stats, staleTiles: staleTiles.size, currentSunBin: core.stats.currentSunBin ? { ...core.stats.currentSunBin } : null };
    },
  };
}
