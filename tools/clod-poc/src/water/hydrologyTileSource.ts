// Deterministic tile cache over the infinite (outside-startup-world) hydrology field.
//
// The infinite field (sampleInfiniteHydrology) is a pure world-space function, so a tile
// is a pure function of (tileX, tileZ, sampler, options): rebuilding an evicted tile
// reproduces bit-identical data, and neighbouring tiles agree exactly on their shared
// edge because both sample the same world coordinates. Tiles exist to (a) amortise the
// per-sample analytic cost (each analytic call does many terrain lookups) across clipmap
// refills, and (b) provide the CPU-side arrays the unified GPU atlas (Phase 4) uploads.
//
// Grid layout: arrays hold (tileRes+1)^2 vertex samples; vertex (ix, iz) sits at world
// (tileX*tileSizeM + ix*cellSize, tileZ*tileSizeM + iz*cellSize) with
// cellSize = tileSizeM / tileRes. Continuous fields sample bilinearly; identity fields
// (bodyKind, bodyId) come from the nearest valid wet corner.
import type { TerrainHeightSampler } from "./water_field_types.js";
import { HYDROLOGY_BODY_DRY, type HydrologySample } from "./hydrologyGrid.js";
import { sampleInfiniteHydrology } from "./infinite_hydrology.js";

export interface HydrologyTile {
  readonly tileX: number;
  readonly tileZ: number;
  readonly originX: number;
  readonly originZ: number;
  readonly cellSize: number;
  /** Cells per edge; arrays are (res+1)^2 vertex samples. */
  readonly res: number;
  readonly terrainY: Float32Array;
  readonly waterY: Float32Array;
  readonly bodyMask: Float32Array;
  readonly lakeMask: Float32Array;
  readonly riverMask: Float32Array;
  readonly flowX: Float32Array;
  readonly flowZ: Float32Array;
  readonly flowStrength: Float32Array;
  readonly riverDepth: Float32Array;
  readonly moisture: Float32Array;
  readonly shoreDistance: Float32Array;
  readonly bodyKind: Uint8Array;
  readonly bodyId: Uint32Array;
}

export interface HydrologyTileCacheOptions {
  tileSizeM: number;
  tileRes: number;
  maxResidentTiles: number;
  drySentinelDepthM: number;
}

export interface HydrologyTileBuildOptions {
  tileSizeM: number;
  tileRes: number;
  drySentinelDepthM: number;
}

export type HydrologyWorldSampler = (x: number, z: number, sampler: TerrainHeightSampler, options: { drySentinelDepthM: number }) => HydrologySample;

/** Off-thread tile source (build worker). Tiles are pure functions of their coords,
 *  so remote builds are bit-identical to the synchronous fallback path. */
export interface HydrologyTileRemoteSource {
  available(): boolean;
  build(tiles: { tileX: number; tileZ: number }[]): Promise<HydrologyTile[]>;
}

export interface HydrologyTileCacheStats {
  builds: number;
  hits: number;
  misses: number;
  evictions: number;
  buildMsTotal: number;
  samples: number;
  /** Tiles adopted from the build worker (bypassing the synchronous path). */
  remoteBuilds: number;
  /** Tiles currently being built by the worker. */
  remoteInflight: number;
}

/** Worker-path pacing: small batches keep round-trips coarse; the inflight cap bounds
 *  wasted work when the camera turns away from a prefetched direction. */
const REMOTE_BATCH_TILES = 2;
const REMOTE_MAX_INFLIGHT_TILES = 8;
const IDENTITY_DISTANCE_EPSILON = 1e-12;

/** Pure tile build shared by the cache's synchronous fallback and the build worker;
 *  a tile is a pure function of (tileX, tileZ, sampler, options), so both paths
 *  produce bit-identical data. */
export function buildHydrologyTileData(
  tileX: number,
  tileZ: number,
  sampler: TerrainHeightSampler,
  options: HydrologyTileBuildOptions,
  sampleHydrology: HydrologyWorldSampler = sampleInfiniteHydrology,
): HydrologyTile {
  const tileSizeM = Math.max(16, options.tileSizeM);
  const res = Math.max(4, Math.floor(options.tileRes));
  const cellSize = tileSizeM / res;
  const drySentinelDepthM = Math.max(1, options.drySentinelDepthM);
  const verts = res + 1;
  const count = verts * verts;
  const originX = tileX * tileSizeM;
  const originZ = tileZ * tileSizeM;
  const tile: HydrologyTile = {
    tileX,
    tileZ,
    originX,
    originZ,
    cellSize,
    res,
    terrainY: new Float32Array(count),
    waterY: new Float32Array(count),
    bodyMask: new Float32Array(count),
    lakeMask: new Float32Array(count),
    riverMask: new Float32Array(count),
    flowX: new Float32Array(count),
    flowZ: new Float32Array(count),
    flowStrength: new Float32Array(count),
    riverDepth: new Float32Array(count),
    moisture: new Float32Array(count),
    shoreDistance: new Float32Array(count),
    bodyKind: new Uint8Array(count),
    bodyId: new Uint32Array(count),
  };
  const sampleOptions = { drySentinelDepthM };
  for (let iz = 0; iz < verts; iz++) {
    const wz = originZ + iz * cellSize;
    for (let ix = 0; ix < verts; ix++) {
      const wx = originX + ix * cellSize;
      const s = sampleHydrology(wx, wz, sampler, sampleOptions);
      const i = iz * verts + ix;
      tile.terrainY[i] = s.terrainY;
      tile.waterY[i] = s.waterY;
      tile.bodyMask[i] = s.bodyMask;
      tile.lakeMask[i] = s.lakeMask;
      tile.riverMask[i] = s.riverMask;
      tile.flowX[i] = s.flowX;
      tile.flowZ[i] = s.flowZ;
      tile.flowStrength[i] = s.flowStrength;
      tile.riverDepth[i] = s.riverDepth;
      tile.moisture[i] = s.moisture;
      tile.shoreDistance[i] = s.shoreDistance;
      tile.bodyKind[i] = s.bodyKind;
      tile.bodyId[i] = s.bodyId;
    }
  }
  return tile;
}

export class HydrologyTileCache {
  private readonly sampler: TerrainHeightSampler;
  private readonly tileSizeM: number;
  private readonly res: number;
  private readonly cellSize: number;
  private readonly maxResidentTiles: number;
  private readonly drySentinelDepthM: number;
  private readonly sampleHydrology: HydrologyWorldSampler;
  /** Insertion-ordered; re-inserted on access so the first key is the LRU victim. */
  private readonly tiles = new Map<string, HydrologyTile>();
  readonly stats: HydrologyTileCacheStats = {
    builds: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    buildMsTotal: 0,
    samples: 0,
    remoteBuilds: 0,
    remoteInflight: 0,
  };
  private remote: HydrologyTileRemoteSource | null = null;
  private readonly remoteInflight = new Set<string>();
  private remoteCompleted: HydrologyTile[] = [];
  private lastPrefetchTileX = Number.NaN;
  private lastPrefetchTileZ = Number.NaN;

  constructor(sampler: TerrainHeightSampler, options: HydrologyTileCacheOptions, sampleHydrology: HydrologyWorldSampler = sampleInfiniteHydrology) {
    this.sampler = sampler;
    this.tileSizeM = Math.max(16, options.tileSizeM);
    this.res = Math.max(4, Math.floor(options.tileRes));
    this.cellSize = this.tileSizeM / this.res;
    this.maxResidentTiles = Math.max(1, Math.floor(options.maxResidentTiles));
    this.drySentinelDepthM = Math.max(1, options.drySentinelDepthM);
    this.sampleHydrology = sampleHydrology;
  }

  /**
   * Consumers sampling coarser than this (metres per consumer cell) should bypass the
   * tile cache and hit the analytic field directly: a ring coarser than ~3 tile cells
   * covers so much area that caching its tiles would evict everything the fine rings
   * rely on (LRU thrash), while its own vertices barely resolve one tile cell anyway.
   */
  get coarseBypassCellSize(): number {
    return this.cellSize * 3;
  }

  get residentTiles(): number {
    return this.tiles.size;
  }

  get tileSize(): number {
    return this.tileSizeM;
  }

  get tileResolution(): number {
    return this.res;
  }

  /** Resident tile lookup that never builds (the streaming atlas polls unfilled slots
   *  every frame; a synchronous build here would reintroduce the 100–250 ms stall the
   *  worker path exists to avoid). Refreshes LRU recency without touching hit/miss
   *  stats so atlas polling does not distort cache diagnostics. */
  peekTile(tileX: number, tileZ: number): HydrologyTile | null {
    const key = `${tileX},${tileZ}`;
    const existing = this.tiles.get(key);
    if (!existing) return null;
    this.tiles.delete(key);
    this.tiles.set(key, existing);
    return existing;
  }

  attachRemote(remote: HydrologyTileRemoteSource | null): void {
    this.remote = remote;
  }

  /**
   * Keep the tiles the fine clipmap rings will need resident *before* their refills
   * sample them, so the synchronous build inside `sample()` (a 100–250 ms stall)
   * stays a rare fallback instead of the steady-state path during traversal.
   * Cheap when idle: re-enumerates candidates only after the camera crosses a tile
   * boundary or while worker results are outstanding.
   */
  prefetchAround(centerX: number, centerZ: number, radiusM: number): void {
    const completedTiles = this.remoteCompleted.length;
    if (this.remoteCompleted.length > 0) {
      for (const tile of this.remoteCompleted) this.adoptRemoteTile(tile);
      this.remoteCompleted = [];
    }
    this.stats.remoteInflight = this.remoteInflight.size;
    if (!this.remote?.available() || radiusM <= 0) return;
    const centerTileX = Math.floor(centerX / this.tileSizeM);
    const centerTileZ = Math.floor(centerZ / this.tileSizeM);
    if (
      centerTileX === this.lastPrefetchTileX
      && centerTileZ === this.lastPrefetchTileZ
      && this.remoteInflight.size === 0
      && completedTiles === 0
    ) {
      return;
    }
    this.lastPrefetchTileX = centerTileX;
    this.lastPrefetchTileZ = centerTileZ;
    if (this.remoteInflight.size >= REMOTE_MAX_INFLIGHT_TILES) return;

    const tileRadius = Math.ceil(radiusM / this.tileSizeM);
    const missing: { tileX: number; tileZ: number; d2: number }[] = [];
    for (let tz = centerTileZ - tileRadius; tz <= centerTileZ + tileRadius; tz++) {
      for (let tx = centerTileX - tileRadius; tx <= centerTileX + tileRadius; tx++) {
        const key = `${tx},${tz}`;
        if (this.tiles.has(key) || this.remoteInflight.has(key)) continue;
        const dx = tx - centerTileX;
        const dz = tz - centerTileZ;
        missing.push({ tileX: tx, tileZ: tz, d2: dx * dx + dz * dz });
      }
    }
    if (missing.length === 0) return;
    missing.sort((a, b) => a.d2 - b.d2);
    let index = 0;
    while (this.remoteInflight.size < REMOTE_MAX_INFLIGHT_TILES && index < missing.length) {
      const batch: { tileX: number; tileZ: number }[] = [];
      while (batch.length < REMOTE_BATCH_TILES && this.remoteInflight.size < REMOTE_MAX_INFLIGHT_TILES && index < missing.length) {
        const candidate = missing[index++]!;
        this.remoteInflight.add(`${candidate.tileX},${candidate.tileZ}`);
        batch.push({ tileX: candidate.tileX, tileZ: candidate.tileZ });
      }
      if (batch.length === 0) break;
      this.remote.build(batch).then((tiles) => {
        this.remoteCompleted.push(...tiles);
        // Tiles missing from the response raced a reconfigure; free their slots so the
        // next prefetch pass re-queues them.
        const builtKeys = new Set(tiles.map((tile) => `${tile.tileX},${tile.tileZ}`));
        for (const coord of batch) {
          const key = `${coord.tileX},${coord.tileZ}`;
          if (!builtKeys.has(key)) this.remoteInflight.delete(key);
        }
      }).catch(() => {
        // Worker failed; the synchronous fallback still guarantees correctness.
        for (const coord of batch) this.remoteInflight.delete(`${coord.tileX},${coord.tileZ}`);
      });
    }
    this.stats.remoteInflight = this.remoteInflight.size;
  }

  private adoptRemoteTile(tile: HydrologyTile): void {
    const key = `${tile.tileX},${tile.tileZ}`;
    this.remoteInflight.delete(key);
    if (this.tiles.has(key)) return;
    this.tiles.set(key, tile);
    this.stats.remoteBuilds++;
    this.trimToBudget();
  }

  private trimToBudget(): void {
    while (this.tiles.size > this.maxResidentTiles) {
      const oldest = this.tiles.keys().next().value as string;
      this.tiles.delete(oldest);
      this.stats.evictions++;
    }
  }

  sample(x: number, z: number): HydrologySample {
    this.stats.samples++;
    const tileX = Math.floor(x / this.tileSizeM);
    const tileZ = Math.floor(z / this.tileSizeM);
    const tile = this.getOrBuildTile(tileX, tileZ);
    return sampleTile(tile, x, z);
  }

  getOrBuildTile(tileX: number, tileZ: number): HydrologyTile {
    const key = `${tileX},${tileZ}`;
    const existing = this.tiles.get(key);
    if (existing) {
      this.stats.hits++;
      // Refresh recency (Map preserves insertion order).
      this.tiles.delete(key);
      this.tiles.set(key, existing);
      return existing;
    }
    this.stats.misses++;
    const t0 = nowMs();
    const tile = buildHydrologyTileData(tileX, tileZ, this.sampler, {
      tileSizeM: this.tileSizeM,
      tileRes: this.res,
      drySentinelDepthM: this.drySentinelDepthM,
    }, this.sampleHydrology);
    this.stats.builds++;
    this.stats.buildMsTotal += nowMs() - t0;
    this.remoteInflight.delete(key);
    this.tiles.set(key, tile);
    this.trimToBudget();
    return tile;
  }
}

export function sampleTile(tile: HydrologyTile, x: number, z: number): HydrologySample {
  const verts = tile.res + 1;
  const gx = clamp((x - tile.originX) / tile.cellSize, 0, tile.res);
  const gz = clamp((z - tile.originZ) / tile.cellSize, 0, tile.res);
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = Math.min(tile.res, x0 + 1);
  const z1 = Math.min(tile.res, z0 + 1);
  const fx = gx - x0;
  const fz = gz - z0;
  const i00 = z0 * verts + x0;
  const i10 = z0 * verts + x1;
  const i01 = z1 * verts + x0;
  const i11 = z1 * verts + x1;

  const bilinear = (field: Float32Array): number => {
    const a = field[i00] * (1 - fx) + field[i10] * fx;
    const b = field[i01] * (1 - fx) + field[i11] * fx;
    return a * (1 - fz) + b * fz;
  };

  const terrainY = bilinear(tile.terrainY);
  const waterY = bilinear(tile.waterY);
  const depthRaw = waterY - terrainY;
  const interpolatedBodyMask = depthRaw > 0 ? clamp(bilinear(tile.bodyMask), 0, 1) : 0;
  const identityIndex = interpolatedBodyMask > 0
    ? nearestWetIdentityIndex(tile, [
        { index: i00, distanceSquared: fx * fx + fz * fz },
        { index: i10, distanceSquared: (1 - fx) * (1 - fx) + fz * fz },
        { index: i01, distanceSquared: fx * fx + (1 - fz) * (1 - fz) },
        { index: i11, distanceSquared: (1 - fx) * (1 - fx) + (1 - fz) * (1 - fz) },
      ])
    : -1;
  const bodyMask = identityIndex >= 0 ? interpolatedBodyMask : 0;

  return {
    terrainY,
    waterY,
    depth: bodyMask > 0 ? Math.max(0, depthRaw) : 0,
    bodyMask,
    lakeMask: bilinear(tile.lakeMask),
    riverMask: bilinear(tile.riverMask),
    flowX: bilinear(tile.flowX),
    flowZ: bilinear(tile.flowZ),
    flowStrength: bilinear(tile.flowStrength),
    riverDepth: bilinear(tile.riverDepth),
    waterYFar: waterY,
    moisture: bilinear(tile.moisture),
    bodyKind: identityIndex >= 0 ? tile.bodyKind[identityIndex] : HYDROLOGY_BODY_DRY,
    bodyId: identityIndex >= 0 ? tile.bodyId[identityIndex] : 0,
    shoreDistance: bilinear(tile.shoreDistance),
  };
}

interface IdentityCandidate {
  index: number;
  distanceSquared: number;
}

function nearestWetIdentityIndex(tile: HydrologyTile, candidates: readonly IdentityCandidate[]): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestMask = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const bodyId = tile.bodyId[candidate.index];
    const bodyKind = tile.bodyKind[candidate.index];
    const bodyMask = tile.bodyMask[candidate.index];
    if (bodyMask <= 0 || bodyId === 0 || bodyKind === HYDROLOGY_BODY_DRY) continue;
    const nearer = candidate.distanceSquared < bestDistance - IDENTITY_DISTANCE_EPSILON;
    const sameDistance = Math.abs(candidate.distanceSquared - bestDistance) <= IDENTITY_DISTANCE_EPSILON;
    if (!nearer && (!sameDistance || bodyMask <= bestMask)) continue;
    bestIndex = candidate.index;
    bestDistance = candidate.distanceSquared;
    bestMask = bodyMask;
  }
  return bestIndex;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nowMs(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}
