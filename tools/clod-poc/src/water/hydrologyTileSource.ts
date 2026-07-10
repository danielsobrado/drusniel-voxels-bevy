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
// (bodyKind, bodyId) sample nearest — interpolating an id across a boundary would be
// meaningless.
import type { TerrainHeightSampler } from "./water_field_types.js";
import type { HydrologySample } from "./hydrologyGrid.js";
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

export interface HydrologyTileCacheStats {
  builds: number;
  hits: number;
  misses: number;
  evictions: number;
  buildMsTotal: number;
  samples: number;
}

export class HydrologyTileCache {
  private readonly sampler: TerrainHeightSampler;
  private readonly tileSizeM: number;
  private readonly res: number;
  private readonly cellSize: number;
  private readonly maxResidentTiles: number;
  private readonly drySentinelDepthM: number;
  /** Insertion-ordered; re-inserted on access so the first key is the LRU victim. */
  private readonly tiles = new Map<string, HydrologyTile>();
  readonly stats: HydrologyTileCacheStats = {
    builds: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    buildMsTotal: 0,
    samples: 0,
  };

  constructor(sampler: TerrainHeightSampler, options: HydrologyTileCacheOptions) {
    this.sampler = sampler;
    this.tileSizeM = Math.max(16, options.tileSizeM);
    this.res = Math.max(4, Math.floor(options.tileRes));
    this.cellSize = this.tileSizeM / this.res;
    this.maxResidentTiles = Math.max(1, Math.floor(options.maxResidentTiles));
    this.drySentinelDepthM = Math.max(1, options.drySentinelDepthM);
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
    const tile = this.buildTile(tileX, tileZ);
    this.stats.builds++;
    this.stats.buildMsTotal += nowMs() - t0;
    this.tiles.set(key, tile);
    while (this.tiles.size > this.maxResidentTiles) {
      const oldest = this.tiles.keys().next().value as string;
      this.tiles.delete(oldest);
      this.stats.evictions++;
    }
    return tile;
  }

  private buildTile(tileX: number, tileZ: number): HydrologyTile {
    const res = this.res;
    const verts = res + 1;
    const count = verts * verts;
    const originX = tileX * this.tileSizeM;
    const originZ = tileZ * this.tileSizeM;
    const tile: HydrologyTile = {
      tileX,
      tileZ,
      originX,
      originZ,
      cellSize: this.cellSize,
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
    const options = { drySentinelDepthM: this.drySentinelDepthM };
    for (let iz = 0; iz < verts; iz++) {
      const wz = originZ + iz * this.cellSize;
      for (let ix = 0; ix < verts; ix++) {
        const wx = originX + ix * this.cellSize;
        const s = sampleInfiniteHydrology(wx, wz, this.sampler, options);
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

  const bilinear = (f: Float32Array): number => {
    const a = f[i00] * (1 - fx) + f[i10] * fx;
    const b = f[i01] * (1 - fx) + f[i11] * fx;
    return a * (1 - fz) + b * fz;
  };
  const nearest = fx < 0.5 ? (fz < 0.5 ? i00 : i01) : fz < 0.5 ? i10 : i11;

  const terrainY = bilinear(tile.terrainY);
  const waterY = bilinear(tile.waterY);
  const depthRaw = waterY - terrainY;
  const bodyMask = depthRaw > 0 ? clamp(bilinear(tile.bodyMask), 0, 1) : 0;
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
    bodyKind: tile.bodyKind[nearest],
    bodyId: tile.bodyId[nearest],
    shoreDistance: bilinear(tile.shoreDistance),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nowMs(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}
