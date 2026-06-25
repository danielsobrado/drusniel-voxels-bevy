import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryStats, FarSummaryTile, FarSummaryTileKey, FarSummarySample } from "./types.js";
import type { FarSummaryRingRequest } from "./clipmap-rings.js";
import { findCachedTileForSample } from "./clipmap-rings.js";
import { tileKeyToString, worldToTileCoord } from "./tile-key.js";
import { createFarSummaryStats, resetFrameStats } from "./stats.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import { buildFarSummaryTile } from "./summary-tile-builder.js";

export interface FallbackStatsWriter {
  countProceduralFallback(): void;
  countLowerRingFallback(): void;
}

export class FarSummaryCache implements FallbackStatsWriter {
  private readonly config: FarSummaryConfig;
  private readonly tiles = new Map<string, FarSummaryTile>();
  private readonly pendingBuildKeys = new Map<string, FarSummaryRingRequest>();
  private readonly stats = createFarSummaryStats();
  private frameIndex = 0;

  constructor(config: FarSummaryConfig) {
    this.config = config;
  }

  requestTiles(
    requests: FarSummaryRingRequest[],
    frameIndex: number,
    nowMs: number,
  ): void {
    this.frameIndex = frameIndex;
    resetFrameStats(this.stats);

    for (const req of requests) {
      const keyStr = tileKeyToString(req.key);
      const existing = this.tiles.get(keyStr);

      if (!existing) {
        this.tiles.set(keyStr, {
          key: req.key,
          state: 'requested',
          revision: 0,
          lastTouchedFrame: frameIndex,
          lastTouchedTimeMs: nowMs,
          cellSizeM: req.key.cellSizeM,
          tileCells: this.config.rings[req.ring]?.tileCells ?? 32,
          originX: 0,
          originZ: 0,
          samples: [],
        });
        this.pendingBuildKeys.set(keyStr, req);
        this.stats.requestedTiles++;
      } else {
        existing.lastTouchedFrame = frameIndex;
        existing.lastTouchedTimeMs = nowMs;

        if (existing.state === 'stale' || existing.state === 'cooling') {
          existing.state = 'requested';
          this.pendingBuildKeys.set(keyStr, req);
          this.stats.requestedTiles++;
        } else if (existing.state === 'evicted') {
          existing.state = 'requested';
          this.pendingBuildKeys.set(keyStr, req);
          this.stats.requestedTiles++;
        }
      }
    }
  }

  buildSomeTiles(
    terrainSampler: FarTerrainSampler,
    frameIndex: number,
    nowMs: number,
    overrideMaxBuilds?: number,
  ): void {
    this.frameIndex = frameIndex;
    const maxBuilds = overrideMaxBuilds ?? this.config.stream.maxTileBuildsPerFrame;
    const commitBudget = this.config.stream.maxTileCommitsPerFrame;

    // TODO(FAR_SUMMARY_ASYNC): Move tile building to a worker/incremental job queue.
    // Currently synchronous on the frame path — OK for Phase 4 prototype.

    let built = 0;
    const buildsToProcess: { keyStr: string; ringIndex: number; tileKey: FarSummaryTileKey }[] = [];

    for (const [keyStr, req] of this.pendingBuildKeys) {
      if (built >= maxBuilds) break;
      buildsToProcess.push({ keyStr, ringIndex: req.ring, tileKey: req.key });
      built++;
    }

    for (const build of buildsToProcess) {
      this.pendingBuildKeys.delete(build.keyStr);
      const existing = this.tiles.get(build.keyStr);
      if (!existing) continue;

      existing.state = 'building';
      const t0 = performance.now();
      try {
        const ringConfig = this.config.rings[build.ringIndex];
        if (!ringConfig) {
          console.warn(`[far-summary] missing ring config for ring ${build.ringIndex}`);
          existing.state = 'evicted';
          continue;
        }
        const builtTile = buildFarSummaryTile({
          key: build.tileKey,
          ringConfig,
          terrainSampler,
          frameIndex,
          nowMs,
        });

        if (this.stats.tilesCommittedThisFrame >= commitBudget) {
          continue;
        }

        this.tiles.set(build.keyStr, builtTile);
        this.stats.tilesCommittedThisFrame++;
      } catch (err) {
        console.error(`[far-summary] build failed for ${build.keyStr}:`, err);
        existing.state = 'missing';
      }

      const elapsed = performance.now() - t0;
      this.stats.buildTimeMs += elapsed;
      if (elapsed > this.stats.maxBuildTimeMs) {
        this.stats.maxBuildTimeMs = elapsed;
      }
      this.stats.tilesBuiltThisFrame++;
    }
  }

  getTile(key: FarSummaryTileKey): FarSummaryTile | null {
    const ks = tileKeyToString(key);
    return this.tiles.get(ks) ?? null;
  }

  /** Look up the exact tile for (x, z) in the given ring using direct key lookup — O(1). */
  sampleExactRing(x: number, z: number, ringIndex: number): FarSummarySample | null {
    const ringConfig = this.config.rings[ringIndex];
    if (!ringConfig) return null;
    const tx = worldToTileCoord(x, ringConfig.cellM, ringConfig.tileCells);
    const tz = worldToTileCoord(z, ringConfig.cellM, ringConfig.tileCells);
    const key: FarSummaryTileKey = { ring: ringIndex, x: tx, z: tz, cellSizeM: ringConfig.cellM };
    const ks = tileKeyToString(key);
    const tile = this.tiles.get(ks);
    if (!tile || tile.state === 'evicted') {
      return null;
    }
    const sample = sampleFromTile(tile, x, z);
    if (sample) {
      this.stats.cacheHits++;
    }
    return sample;
  }

  /** Fallback scan across all cached tiles (slow — for debug/safety only). */
  sampleAnyRing(x: number, z: number, preferredRing: number): FarSummarySample | null {
    const tile = findCachedTileForSample(this.tiles, x, z, preferredRing);
    if (!tile) return null;
    const sample = sampleFromTile(tile, x, z);
    return sample;
  }

  sample(
    x: number,
    z: number,
    preferredRing: number,
  ): FarSummarySample | null {
    const sample = this.sampleExactRing(x, z, preferredRing);
    if (sample) return sample;
    this.stats.cacheMisses++;
    return null;
  }

  countProceduralFallback(): void {
    this.stats.proceduralFallbacks++;
  }

  countLowerRingFallback(): void {
    this.stats.lowerRingFallbacks++;
  }

  markStale(_boundsOrPredicate: unknown): void {
    const now = this.frameIndex;
    for (const [, tile] of this.tiles) {
      if (tile.state === 'ready' && tile.lastTouchedFrame < now - 1) {
        tile.state = 'stale';
      }
    }
  }

  evictColdTiles(frameIndex: number, nowMs: number): void {
    this.frameIndex = frameIndex;
    const graceMs = this.config.stream.evictionGraceSeconds * 1000;

    for (const [_ks, tile] of this.tiles) {
      if (tile.state === 'ready' && tile.lastTouchedFrame < frameIndex - 2) {
        tile.state = 'cooling';
      }

      if (tile.state === 'cooling' && (nowMs - tile.lastTouchedTimeMs) > graceMs) {
        tile.state = 'evicted';
      }

      if (tile.state === 'cooling' && tile.lastTouchedFrame >= frameIndex - 1) {
        tile.state = 'stale';
      }

      if (tile.state === 'stale' && tile.lastTouchedFrame < frameIndex - 5) {
        tile.state = 'cooling';
      }
    }

    let evicted = 0;
    for (const [ekey, tile] of this.tiles) {
      if (tile.state === 'evicted') {
        this.tiles.delete(ekey);
        evicted++;
      }
    }
    this.stats.evictedTiles = evicted;
  }

  getStats(): FarSummaryStats {
    let requested = 0;
    let building = 0;
    let ready = 0;
    let stale = 0;
    let cooling = 0;
    let evicted = 0;

    for (const [, tile] of this.tiles) {
      switch (tile.state) {
        case 'requested': requested++; break;
        case 'building': building++; break;
        case 'ready': ready++; break;
        case 'stale': stale++; break;
        case 'cooling': cooling++; break;
        case 'evicted': evicted++; break;
      }
    }

    this.stats.requestedTiles = requested;
    this.stats.buildingTiles = building;
    this.stats.readyTiles = ready;
    this.stats.staleTiles = stale;

    return { ...this.stats, evictedTiles: evicted };
  }
}

function sampleFromTile(tile: FarSummaryTile, x: number, z: number): FarSummarySample | null {
  const { cellSizeM, tileCells, originX, originZ, samples } = tile;
  if (samples.length === 0) return null;

  const localX = (x - originX) / cellSizeM;
  const localZ = (z - originZ) / cellSizeM;

  const sx = Math.floor(localX);
  const sz = Math.floor(localZ);

  if (sx < 0 || sx >= tileCells || sz < 0 || sz >= tileCells) return null;

  const idx = sz * tileCells + sx;
  return samples[idx] ?? null;
}
