import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryStats, FarSummaryTile, FarSummaryTileKey, FarSummarySample } from "./types.js";
import type { FarSummaryRingRequest } from "./clipmap-rings.js";
import { findCachedTileForSample } from "./clipmap-rings.js";
import { tileKeyToString, worldToTileCoord } from "./tile-key.js";
import { createFarSummaryStats, resetFrameStats } from "./stats.js";
import type { FarTerrainSampler, FarSummaryTileBuildState } from "./summary-tile-builder.js";
import {
  createFarSummaryTileBuild,
  finishFarSummaryTileBuild,
  stepFarSummaryTileBuild,
} from "./summary-tile-builder.js";

export interface FallbackStatsWriter {
  countProceduralFallback(): void;
  countLowerRingFallback(): void;
  countConservativeFallback(): void;
}

interface ActiveBuild {
  keyStr: string;
  req: FarSummaryRingRequest;
  state: FarSummaryTileBuildState;
  startedAtMs: number;
}

export class FarSummaryCache implements FallbackStatsWriter {
  private readonly config: FarSummaryConfig;
  private readonly tiles = new Map<string, FarSummaryTile>();
  private readonly pendingBuildKeys = new Map<string, FarSummaryRingRequest>();
  private readonly stats = createFarSummaryStats();
  private activeBuild: ActiveBuild | null = null;
  private frameIndex = 0;
  private commitRevision = 0;
  private stateRevision = 0;

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
          state: "requested",
          revision: 0,
          lastTouchedFrame: frameIndex,
          lastTouchedTimeMs: nowMs,
          cellSizeM: req.key.cellSizeM,
          tileCells: this.config.rings[req.ring]?.tileCells ?? 32,
          originX: 0,
          originZ: 0,
          samples: [],
        });
        this.stateRevision++;
        this.pendingBuildKeys.set(keyStr, req);
        this.stats.requestedTiles++;
      } else {
        existing.lastTouchedFrame = frameIndex;
        existing.lastTouchedTimeMs = nowMs;

        if (
          existing.state === "missing" ||
          existing.state === "stale" ||
          existing.state === "cooling" ||
          existing.state === "evicted"
        ) {
          existing.state = "requested";
          this.stateRevision++;
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
    deadlineMs = Number.POSITIVE_INFINITY,
  ): void {
    this.frameIndex = frameIndex;
    const maxBuilds = Math.max(0, overrideMaxBuilds ?? this.config.stream.maxTileBuildsPerFrame);
    const commitBudget = Math.max(0, this.config.stream.maxTileCommitsPerFrame);
    let completedBuilds = 0;

    while (completedBuilds < maxBuilds) {
      if (!this.activeBuild && !this.startNextBuild(terrainSampler, nowMs)) return;
      const active = this.activeBuild;
      if (!active) return;
      active.state.input.frameIndex = frameIndex;
      active.state.input.nowMs = nowMs;

      const t0 = performance.now();
      const complete = stepFarSummaryTileBuild(active.state, deadlineMs);
      const elapsed = performance.now() - t0;
      this.stats.buildTimeMs += elapsed;
      if (!complete) return;

      this.finishActiveBuild(active, commitBudget);
      this.activeBuild = null;
      completedBuilds++;
      if (performance.now() >= deadlineMs) return;
    }
  }

  getTile(key: FarSummaryTileKey): FarSummaryTile | null {
    const ks = tileKeyToString(key);
    return this.tiles.get(ks) ?? null;
  }

  sampleExactRing(x: number, z: number, ringIndex: number): FarSummarySample | null {
    const ringConfig = this.config.rings[ringIndex];
    if (!ringConfig) {
      this.stats.cacheMisses++;
      return null;
    }
    const tx = worldToTileCoord(x, ringConfig.cellM, ringConfig.tileCells);
    const tz = worldToTileCoord(z, ringConfig.cellM, ringConfig.tileCells);
    const key: FarSummaryTileKey = { ring: ringIndex, x: tx, z: tz, cellSizeM: ringConfig.cellM };
    const ks = tileKeyToString(key);
    const tile = this.tiles.get(ks);
    if (!tile || tile.state === "evicted") {
      this.stats.cacheMisses++;
      return null;
    }
    const sample = sampleFromTile(tile, x, z);
    if (sample) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
    }
    return sample;
  }

  /** Fallback scan across all cached tiles (slow — for debug/safety only). */
  sampleAnyRing(x: number, z: number, preferredRing: number): FarSummarySample | null {
    const tile = findCachedTileForSample(this.tiles, x, z, preferredRing);
    if (!tile) return null;
    return sampleFromTile(tile, x, z);
  }

  sample(x: number, z: number, preferredRing: number): FarSummarySample | null {
    return this.sampleExactRing(x, z, preferredRing);
  }

  countProceduralFallback(): void { this.stats.proceduralFallbacks++; }
  countLowerRingFallback(): void { this.stats.lowerRingFallbacks++; }
  countConservativeFallback(): void { this.stats.conservativeFallbacks++; }

  markStale(_boundsOrPredicate: unknown): void {
    const now = this.frameIndex;
    for (const [, tile] of this.tiles) {
      if (tile.state === "ready" && tile.lastTouchedFrame < now - 1) {
        tile.state = "stale";
        this.stateRevision++;
      }
    }
  }

  evictColdTiles(frameIndex: number, nowMs: number): void {
    this.frameIndex = frameIndex;
    const graceMs = this.config.stream.evictionGraceSeconds * 1000;
    for (const [_ks, tile] of this.tiles) {
      if (tile.state === "ready" && tile.lastTouchedFrame < frameIndex - 2) {
        tile.state = "cooling";
        this.stateRevision++;
      }
      if (tile.state === "cooling" && (nowMs - tile.lastTouchedTimeMs) > graceMs) {
        tile.state = "evicted";
        this.stateRevision++;
      }
      if (tile.state === "cooling" && tile.lastTouchedFrame >= frameIndex - 1) {
        tile.state = "stale";
        this.stateRevision++;
      }
      if (tile.state === "stale" && tile.lastTouchedFrame < frameIndex - 5) {
        tile.state = "cooling";
        this.stateRevision++;
      }
    }
    let evicted = 0;
    for (const [ekey, tile] of this.tiles) {
      if (tile.state === "evicted") {
        this.tiles.delete(ekey);
        this.pendingBuildKeys.delete(ekey);
        if (this.activeBuild?.keyStr === ekey) this.activeBuild = null;
        this.stateRevision++;
        evicted++;
      }
    }
    this.stats.evictedTiles = evicted;
  }

  commitRevisionAt(): number { return this.commitRevision; }
  hasNewCommitsSince(revision: number): boolean { return this.commitRevision > revision; }
  stateRevisionAt(): number { return this.stateRevision; }
  hasStateChangesSince(revision: number): boolean { return this.stateRevision > revision; }

  forEachTile(fn: (tile: FarSummaryTile) => void): void {
    for (const tile of this.tiles.values()) fn(tile);
  }

  getStats(): FarSummaryStats {
    let requested = 0, building = 0, ready = 0, stale = 0, cooling = 0, evicted = 0;
    for (const [, tile] of this.tiles) {
      switch (tile.state) {
        case "requested": requested++; break;
        case "building": building++; break;
        case "ready": ready++; break;
        case "stale": stale++; break;
        case "cooling": cooling++; break;
        case "evicted": evicted++; break;
      }
    }
    this.stats.requestedTiles = requested;
    this.stats.buildingTiles = building;
    this.stats.readyTiles = ready;
    this.stats.staleTiles = stale;
    return { ...this.stats, evictedTiles: evicted };
  }

  getTileCount(): number {
    return this.tiles.size;
  }

  private startNextBuild(terrainSampler: FarTerrainSampler, nowMs: number): boolean {
    const next = this.nextPendingBuild();
    if (!next) return false;
    const existing = this.tiles.get(next.keyStr);
    if (!existing) {
      this.pendingBuildKeys.delete(next.keyStr);
      return true;
    }
    if (existing.state === "building") return true;

    const ringConfig = this.config.rings[next.req.ring];
    if (!ringConfig) {
      console.warn(`[far-summary] missing ring config for ring ${next.req.ring}`);
      existing.state = "evicted";
      this.pendingBuildKeys.delete(next.keyStr);
      this.stateRevision++;
      return true;
    }

    existing.state = "building";
    this.pendingBuildKeys.delete(next.keyStr);
    this.stateRevision++;
    this.activeBuild = {
      keyStr: next.keyStr,
      req: next.req,
      state: createFarSummaryTileBuild({
        key: next.req.key,
        ringConfig,
        terrainSampler,
        frameIndex: this.frameIndex,
        nowMs,
      }),
      startedAtMs: performance.now(),
    };
    return true;
  }

  private finishActiveBuild(active: ActiveBuild, commitBudget: number): void {
    const existing = this.tiles.get(active.keyStr);
    if (!existing) return;

    try {
      const builtTile = finishFarSummaryTileBuild(active.state);
      this.stats.tilesBuiltThisFrame++;
      if (this.stats.tilesCommittedThisFrame >= commitBudget) {
        const hasSamples = existing.samples.length > 0;
        existing.state = hasSamples ? "stale" : "requested";
        this.stateRevision++;
        this.pendingBuildKeys.set(active.keyStr, active.req);
      } else {
        this.tiles.set(active.keyStr, builtTile);
        this.stateRevision++;
        this.stats.tilesCommittedThisFrame++;
        this.commitRevision++;
      }
      const elapsed = performance.now() - active.startedAtMs;
      if (elapsed > this.stats.maxBuildTimeMs) {
        this.stats.maxBuildTimeMs = elapsed;
      }
    } catch (err) {
      console.error(`[far-summary] build failed for ${active.keyStr}:`, err);
      existing.state = "missing";
      this.stateRevision++;
    }
  }

  private nextPendingBuild(): { keyStr: string; req: FarSummaryRingRequest } | null {
    let best: { keyStr: string; req: FarSummaryRingRequest } | null = null;
    for (const [keyStr, req] of this.pendingBuildKeys) {
      if (!best || compareRequests(req, best.req) < 0) best = { keyStr, req };
    }
    return best;
  }
}

function compareRequests(a: FarSummaryRingRequest, b: FarSummaryRingRequest): number {
  return a.priority - b.priority ||
    a.ring - b.ring ||
    a.key.z - b.key.z ||
    a.key.x - b.key.x;
}

function sampleFromTile(tile: FarSummaryTile, x: number, z: number): FarSummarySample | null {
  const { cellSizeM, tileCells, originX, originZ, samples } = tile;
  if (samples.length === 0) return null;
  const localX = (x - originX) / cellSizeM;
  const localZ = (z - originZ) / cellSizeM;
  const sx = Math.floor(localX);
  const sz = Math.floor(localZ);
  if (sx < 0 || sx >= tileCells || sz < 0 || sz >= tileCells) return null;
  return samples[sz * tileCells + sx] ?? null;
}
