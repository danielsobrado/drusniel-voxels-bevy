import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryStats, FarSummaryTile, FarSummaryTileKey, FarSummarySample } from "./types.js";
import type { FarSummaryRingRequest, TileBounds } from "./clipmap-rings.js";
import { findCachedTileForSample } from "./clipmap-rings.js";
import { tileKeyToString, worldToTileCoord } from "./tile-key.js";
import { createFarSummaryStats, resetFrameFallbackStats, resetFrameStats } from "./stats.js";
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

interface PendingCommit {
  keyStr: string;
  req: FarSummaryRingRequest;
  tile: FarSummaryTile;
  startedAtMs: number;
}

export interface FarSummaryRequestStateCounts {
  ready: number;
  building: number;
  staleWithSamples: number;
  missing: number;
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
  private invalidationEpoch = 0;
  private readonly pendingCommits: PendingCommit[] = [];

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
          builtEpoch: -1,
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
          (existing.state === "stale" || existing.state === "cooling") &&
          existing.samples.length > 0 &&
          existing.builtEpoch === this.invalidationEpoch
        ) {
          existing.state = "ready";
          this.stateRevision++;
          this.stats.staleRestores++;
          continue;
        }

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
    deferCompletedTile?: (tile: FarSummaryTile) => void,
  ): void {
    this.frameIndex = frameIndex;
    const maxBuilds = Math.max(0, overrideMaxBuilds ?? this.config.stream.maxTileBuildsPerFrame);
    const commitBudget = Math.max(0, this.config.stream.maxTileCommitsPerFrame);
    this.drainPendingCommits(commitBudget);
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

      this.finishActiveBuild(active, commitBudget, deferCompletedTile);
      this.activeBuild = null;
      completedBuilds++;
      if (performance.now() >= deadlineMs) return;
    }
  }

  commitExternalTile(tile: FarSummaryTile): void {
    const keyStr = tileKeyToString(tile.key);
    const existing = this.tiles.get(keyStr);
    const committed: FarSummaryTile = {
      ...tile,
      state: "ready",
      builtEpoch: this.invalidationEpoch,
      lastTouchedFrame: Math.max(tile.lastTouchedFrame, existing?.lastTouchedFrame ?? tile.lastTouchedFrame),
      lastTouchedTimeMs: Math.max(tile.lastTouchedTimeMs, existing?.lastTouchedTimeMs ?? tile.lastTouchedTimeMs),
    };
    this.pendingBuildKeys.delete(keyStr);
    this.dropPendingCommit(keyStr);
    if (this.activeBuild?.keyStr === keyStr) this.activeBuild = null;
    this.stats.tilesBuiltThisFrame++;
    this.commitBuiltTile(keyStr, committed);
  }

  discardDeferredTile(key: FarSummaryTileKey): void {
    const keyStr = tileKeyToString(key);
    const tile = this.tiles.get(keyStr);
    if (!tile || (tile.state !== "building" && tile.state !== "requested")) return;
    this.pendingBuildKeys.delete(keyStr);
    this.dropPendingCommit(keyStr);
    if (this.activeBuild?.keyStr === keyStr) this.activeBuild = null;
    tile.state = "evicted";
    this.stateRevision++;
  }

  getTile(key: FarSummaryTileKey): FarSummaryTile | null {
    const ks = tileKeyToString(key);
    return this.tiles.get(ks) ?? null;
  }

  sampleExactRing(x: number, z: number, ringIndex: number): FarSummarySample | null {
    const tile = this.sampleableTileAt(x, z, ringIndex);
    if (!tile) return null;
    const sample = sampleFromTile(tile, x, z);
    if (sample) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
    }
    return sample;
  }

  /** Allocation-free variant of sampleExactRing for per-vertex refill loops: writes the
   *  blended sample into `out` and returns whether it was produced. */
  sampleExactRingInto(x: number, z: number, ringIndex: number, out: FarSummarySample): boolean {
    const tile = this.sampleableTileAt(x, z, ringIndex);
    if (!tile) return false;
    const ok = sampleFromTileInto(tile, x, z, out);
    if (ok) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
    }
    return ok;
  }

  /** Tile lookup shared by the sampling paths. Runs per vertex of every refill, so the
   *  key string is memoized: consecutive samples overwhelmingly land in the same tile,
   *  and reusing the string skips both the key-object and template allocation. State
   *  checks always run against the fresh Map lookup, so the memo cannot serve a stale
   *  or evicted tile. */
  private lastSampleRing = -1;
  private lastSampleTx = Number.NaN;
  private lastSampleTz = Number.NaN;
  private lastSampleKs = "";
  private sampleableTileAt(x: number, z: number, ringIndex: number): FarSummaryTile | null {
    const ringConfig = this.config.rings[ringIndex];
    if (!ringConfig) {
      this.stats.cacheMisses++;
      return null;
    }
    const tx = worldToTileCoord(x, ringConfig.cellM, ringConfig.tileCells);
    const tz = worldToTileCoord(z, ringConfig.cellM, ringConfig.tileCells);
    if (ringIndex !== this.lastSampleRing || tx !== this.lastSampleTx || tz !== this.lastSampleTz) {
      this.lastSampleRing = ringIndex;
      this.lastSampleTx = tx;
      this.lastSampleTz = tz;
      this.lastSampleKs = tileKeyToString({ ring: ringIndex, x: tx, z: tz, cellSizeM: ringConfig.cellM });
    }
    const tile = this.tiles.get(this.lastSampleKs);
    if (!tile || tile.state === "evicted") {
      this.stats.cacheMisses++;
      return null;
    }
    if ((tile.state === "stale" || tile.state === "cooling") && !this.config.stream.keepStaleUntilReplacement) {
      this.stats.cacheMisses++;
      return null;
    }
    return tile;
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

  countRequestStates(requests: readonly FarSummaryRingRequest[]): FarSummaryRequestStateCounts {
    const seen = new Set<string>();
    const counts: FarSummaryRequestStateCounts = {
      ready: 0,
      building: 0,
      staleWithSamples: 0,
      missing: 0,
    };

    for (const req of requests) {
      const keyStr = tileKeyToString(req.key);
      if (seen.has(keyStr)) continue;
      seen.add(keyStr);
      const tile = this.tiles.get(keyStr);
      if (!tile || tile.state === "missing" || tile.state === "evicted") {
        counts.missing++;
      } else if (tile.state === "ready") {
        counts.ready++;
      } else if (tile.state === "building" || tile.state === "requested") {
        counts.building++;
      } else if ((tile.state === "stale" || tile.state === "cooling") && tile.samples.length > 0) {
        counts.staleWithSamples++;
      } else {
        counts.missing++;
      }
    }

    return counts;
  }

  countProceduralFallback(): void { this.stats.proceduralFallbacks++; }
  countLowerRingFallback(): void { this.stats.lowerRingFallbacks++; }
  countConservativeFallback(): void { this.stats.conservativeFallbacks++; }

  resetFallbackCounters(): void {
    resetFrameFallbackStats(this.stats);
  }

  markStale(bounds: TileBounds | null): void {
    if (bounds === null) this.invalidationEpoch++;
    this.cancelInvalidatedActiveBuild(bounds);
    this.dropInvalidatedPendingCommits(bounds);

    for (const [, tile] of this.tiles) {
      if (tile.state === "evicted") continue;
      if (bounds !== null && !tileIntersectsBounds(tile, bounds)) continue;
      this.markTileStaleOrRequested(tile);
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
        this.dropPendingCommit(ekey);
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

  private finishActiveBuild(
    active: ActiveBuild,
    commitBudget: number,
    deferCompletedTile?: (tile: FarSummaryTile) => void,
  ): void {
    const existing = this.tiles.get(active.keyStr);
    if (!existing) return;

    try {
      const builtTile = finishFarSummaryTileBuild(active.state);
      builtTile.builtEpoch = this.invalidationEpoch;
      this.stats.tilesBuiltThisFrame++;
      if (deferCompletedTile) {
        deferCompletedTile(builtTile);
      } else if (this.stats.tilesCommittedThisFrame >= commitBudget) {
        this.pendingCommits.push({ keyStr: active.keyStr, req: active.req, tile: builtTile, startedAtMs: active.startedAtMs });
      } else {
        this.commitBuiltTile(active.keyStr, builtTile);
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

  private drainPendingCommits(commitBudget: number): void {
    while (this.pendingCommits.length > 0 && this.stats.tilesCommittedThisFrame < commitBudget) {
      const pending = this.pendingCommits.shift()!;
      this.commitBuiltTile(pending.keyStr, pending.tile);
      const elapsed = performance.now() - pending.startedAtMs;
      if (elapsed > this.stats.maxBuildTimeMs) {
        this.stats.maxBuildTimeMs = elapsed;
      }
    }
  }

  private commitBuiltTile(keyStr: string, tile: FarSummaryTile): void {
    this.tiles.set(keyStr, tile);
    this.stateRevision++;
    this.stats.tilesCommittedThisFrame++;
    this.commitRevision++;
  }

  private cancelInvalidatedActiveBuild(bounds: TileBounds | null): void {
    const active = this.activeBuild;
    if (!active) return;
    if (bounds !== null && !requestIntersectsBounds(active.req, this.config, bounds)) return;
    this.activeBuild = null;
    this.pendingBuildKeys.set(active.keyStr, active.req);
    this.stats.buildsDiscarded++;
    const tile = this.tiles.get(active.keyStr);
    if (tile && tile.state !== "evicted") this.markTileStaleOrRequested(tile);
  }

  private dropInvalidatedPendingCommits(bounds: TileBounds | null): void {
    for (let index = this.pendingCommits.length - 1; index >= 0; index--) {
      const pending = this.pendingCommits[index]!;
      if (bounds !== null && !tileIntersectsBounds(pending.tile, bounds)) continue;
      this.pendingCommits.splice(index, 1);
      this.pendingBuildKeys.set(pending.keyStr, pending.req);
      this.stats.buildsDiscarded++;
      const tile = this.tiles.get(pending.keyStr);
      if (tile && tile.state !== "evicted") this.markTileStaleOrRequested(tile);
    }
  }

  private dropPendingCommit(keyStr: string): void {
    for (let index = this.pendingCommits.length - 1; index >= 0; index--) {
      if (this.pendingCommits[index]?.keyStr === keyStr) this.pendingCommits.splice(index, 1);
    }
  }

  private markTileStaleOrRequested(tile: FarSummaryTile): void {
    if (tile.samples.length > 0) {
      if (tile.state !== "stale" || tile.builtEpoch !== -1) {
        tile.state = "stale";
        tile.builtEpoch = -1;
        this.stateRevision++;
      }
      return;
    }
    if (tile.state !== "requested") {
      tile.state = "requested";
      tile.builtEpoch = -1;
      this.stateRevision++;
    }
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
  if (localX < 0 || localX >= tileCells || localZ < 0 || localZ >= tileCells) return null;
  return bilinearTileSample(tile, localX, localZ);
}

function sampleFromTileInto(tile: FarSummaryTile, x: number, z: number, out: FarSummarySample): boolean {
  const { cellSizeM, tileCells, originX, originZ, samples } = tile;
  if (samples.length === 0) return false;
  const localX = (x - originX) / cellSizeM;
  const localZ = (z - originZ) / cellSizeM;
  if (localX < 0 || localX >= tileCells || localZ < 0 || localZ >= tileCells) return false;
  return bilinearTileSampleInto(tile, localX, localZ, out);
}

export function readTileSample(
  tile: FarSummaryTile,
  cellX: number,
  cellZ: number,
  out: FarSummarySample,
): boolean {
  if (tile.samples.length === 0) return false;
  if (cellX < 0 || cellX >= tile.tileCells || cellZ < 0 || cellZ >= tile.tileCells) return false;
  const sample = tile.samples[cellZ * tile.tileCells + cellX];
  if (!sample) return false;
  out.heightMin = sample.heightMin;
  out.heightMax = sample.heightMax;
  out.heightAvg = sample.heightAvg;
  out.normalX = sample.normalX;
  out.normalY = sample.normalY;
  out.normalZ = sample.normalZ;
  out.dominantMaterial = sample.dominantMaterial;
  out.materialVariance = sample.materialVariance;
  out.canopyCoverage = sample.canopyCoverage;
  out.waterCoverage = sample.waterCoverage;
  out.waterLevel = sample.waterLevel;
  out.bodyKind = sample.bodyKind;
  out.shoreDistance = sample.shoreDistance;
  out.flowX = sample.flowX;
  out.flowZ = sample.flowZ;
  out.canopyHeightAvg = sample.canopyHeightAvg;
  out.speciesPine = sample.speciesPine;
  out.speciesBroadleaf = sample.speciesBroadleaf;
  out.speciesDeadwood = sample.speciesDeadwood;
  out.structureCoverage = sample.structureCoverage;
  out.caveEntranceCoverage = sample.caveEntranceCoverage;
  out.occluderHeight = sample.occluderHeight;
  out.slope = sample.slope;
  out.roughness = sample.roughness;
  return true;
}

function emptySample(): FarSummarySample {
  return {
    heightMin: 0,
    heightMax: 0,
    heightAvg: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    dominantMaterial: 0,
    materialVariance: 0,
    canopyCoverage: 0,
    waterCoverage: 0,
    waterLevel: 0,
    bodyKind: 0,
    shoreDistance: 0,
    flowX: 0,
    flowZ: 0,
    canopyHeightAvg: 0,
    speciesPine: 0,
    speciesBroadleaf: 0,
    speciesDeadwood: 0,
    structureCoverage: 0,
    caveEntranceCoverage: 0,
    occluderHeight: 0,
    slope: 0,
    roughness: 0,
  };
}

/** Read-only reference to a stored cell sample; the corner values are only read during
 *  the bilinear blend, so no defensive copy is needed. */
function cornerSampleRef(tile: FarSummaryTile, cellX: number, cellZ: number): FarSummarySample | null {
  if (cellX < 0 || cellX >= tile.tileCells || cellZ < 0 || cellZ >= tile.tileCells) return null;
  return tile.samples[cellZ * tile.tileCells + cellX] ?? null;
}

/** Bilinear blend written into `out`. This runs per vertex of every clipmap/shell refill
 *  (thousands of calls per refill), so it must not allocate: corners are referenced, not
 *  copied, and the result lands in a caller-provided sample. */
function bilinearTileSampleInto(tile: FarSummaryTile, localX: number, localZ: number, out: FarSummarySample): boolean {
  const sampleX = localX - 0.5;
  const sampleZ = localZ - 0.5;
  const baseX = Math.floor(sampleX);
  const baseZ = Math.floor(sampleZ);
  const x0 = clampInt(baseX, 0, tile.tileCells - 1);
  const z0 = clampInt(baseZ, 0, tile.tileCells - 1);
  const x1 = clampInt(baseX + 1, 0, tile.tileCells - 1);
  const z1 = clampInt(baseZ + 1, 0, tile.tileCells - 1);
  const tx = x0 === x1 ? 0 : Math.max(0, Math.min(1, sampleX - baseX));
  const tz = z0 === z1 ? 0 : Math.max(0, Math.min(1, sampleZ - baseZ));
  if (tile.samples.length === 0) return false;
  const s00 = cornerSampleRef(tile, x0, z0);
  const s10 = cornerSampleRef(tile, x1, z0);
  const s01 = cornerSampleRef(tile, x0, z1);
  const s11 = cornerSampleRef(tile, x1, z1);
  if (!s00 || !s10 || !s01 || !s11) return false;

  out.heightAvg = bilerp(s00.heightAvg, s10.heightAvg, s01.heightAvg, s11.heightAvg, tx, tz);
  out.heightMin = bilerp(s00.heightMin, s10.heightMin, s01.heightMin, s11.heightMin, tx, tz);
  out.heightMax = bilerp(s00.heightMax, s10.heightMax, s01.heightMax, s11.heightMax, tx, tz);
  const nx = bilerp(s00.normalX, s10.normalX, s01.normalX, s11.normalX, tx, tz);
  const ny = bilerp(s00.normalY, s10.normalY, s01.normalY, s11.normalY, tx, tz);
  const nz = bilerp(s00.normalZ, s10.normalZ, s01.normalZ, s11.normalZ, tx, tz);
  const normalLen = Math.hypot(nx, ny, nz);
  if (normalLen > 1e-8) {
    out.normalX = nx / normalLen;
    out.normalY = ny / normalLen;
    out.normalZ = nz / normalLen;
  } else {
    out.normalX = 0;
    out.normalY = 1;
    out.normalZ = 0;
  }
  const nearest = nearestSample(s00, s10, s01, s11, tx, tz);
  out.dominantMaterial = nearest.dominantMaterial;
  out.materialVariance = bilerp(s00.materialVariance, s10.materialVariance, s01.materialVariance, s11.materialVariance, tx, tz);
  out.canopyCoverage = bilerp(s00.canopyCoverage, s10.canopyCoverage, s01.canopyCoverage, s11.canopyCoverage, tx, tz);
  out.waterCoverage = bilerp(s00.waterCoverage, s10.waterCoverage, s01.waterCoverage, s11.waterCoverage, tx, tz);
  out.waterLevel = bilerp(s00.waterLevel, s10.waterLevel, s01.waterLevel, s11.waterLevel, tx, tz);
  out.bodyKind = nearest.bodyKind;
  out.shoreDistance = bilerp(s00.shoreDistance, s10.shoreDistance, s01.shoreDistance, s11.shoreDistance, tx, tz);
  out.flowX = bilerp(s00.flowX, s10.flowX, s01.flowX, s11.flowX, tx, tz);
  out.flowZ = bilerp(s00.flowZ, s10.flowZ, s01.flowZ, s11.flowZ, tx, tz);
  out.canopyHeightAvg = bilerp(s00.canopyHeightAvg, s10.canopyHeightAvg, s01.canopyHeightAvg, s11.canopyHeightAvg, tx, tz);
  out.speciesPine = bilerp(s00.speciesPine, s10.speciesPine, s01.speciesPine, s11.speciesPine, tx, tz);
  out.speciesBroadleaf = bilerp(s00.speciesBroadleaf, s10.speciesBroadleaf, s01.speciesBroadleaf, s11.speciesBroadleaf, tx, tz);
  out.speciesDeadwood = bilerp(s00.speciesDeadwood, s10.speciesDeadwood, s01.speciesDeadwood, s11.speciesDeadwood, tx, tz);
  out.structureCoverage = bilerp(s00.structureCoverage, s10.structureCoverage, s01.structureCoverage, s11.structureCoverage, tx, tz);
  out.caveEntranceCoverage = bilerp(s00.caveEntranceCoverage, s10.caveEntranceCoverage, s01.caveEntranceCoverage, s11.caveEntranceCoverage, tx, tz);
  out.occluderHeight = bilerp(s00.occluderHeight, s10.occluderHeight, s01.occluderHeight, s11.occluderHeight, tx, tz);
  out.slope = bilerp(s00.slope, s10.slope, s01.slope, s11.slope, tx, tz);
  out.roughness = bilerp(s00.roughness, s10.roughness, s01.roughness, s11.roughness, tx, tz);
  return true;
}

function bilinearTileSample(tile: FarSummaryTile, localX: number, localZ: number): FarSummarySample | null {
  const out = emptySample();
  return bilinearTileSampleInto(tile, localX, localZ, out) ? out : null;
}

function bilerp(v00: number, v10: number, v01: number, v11: number, tx: number, tz: number): number {
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * tz;
}

function nearestSample(
  s00: FarSummarySample,
  s10: FarSummarySample,
  s01: FarSummarySample,
  s11: FarSummarySample,
  tx: number,
  tz: number,
): FarSummarySample {
  if (tx < 0.5) return tz < 0.5 ? s00 : s01;
  return tz < 0.5 ? s10 : s11;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tileIntersectsBounds(tile: FarSummaryTile, bounds: TileBounds): boolean {
  const minX = tile.originX;
  const minZ = tile.originZ;
  const maxX = tile.originX + tile.cellSizeM * tile.tileCells;
  const maxZ = tile.originZ + tile.cellSizeM * tile.tileCells;
  return minX < bounds.maxX && maxX > bounds.minX && minZ < bounds.maxZ && maxZ > bounds.minZ;
}

function requestIntersectsBounds(req: FarSummaryRingRequest, config: FarSummaryConfig, bounds: TileBounds): boolean {
  const tileCells = config.rings[req.ring]?.tileCells ?? 32;
  const minX = req.key.x * req.key.cellSizeM * tileCells;
  const minZ = req.key.z * req.key.cellSizeM * tileCells;
  const maxX = minX + req.key.cellSizeM * tileCells;
  const maxZ = minZ + req.key.cellSizeM * tileCells;
  return minX < bounds.maxX && maxX > bounds.minX && minZ < bounds.maxZ && maxZ > bounds.minZ;
}
