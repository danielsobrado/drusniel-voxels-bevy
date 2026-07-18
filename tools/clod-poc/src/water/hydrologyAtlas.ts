// Streaming hydrology atlas (Phase 4b): a tile-aligned, camera-following window of
// canonical Layout A texels (R=waterY, G=wetMask, B=carvedBedY, A=shoreDistance — see
// hydrologyGpuPacking.ts) covering the world around the vegetation rings, INCLUDING the
// region outside the startup world where the res×res startup texture clamps.
//
// Texels are copied verbatim from HydrologyTile vertex arrays (hydrologyTileSource.ts),
// so the atlas is bit-identical to the CPU tile authority wherever it has data. Tiles
// not yet resident leave their texels at the invalid sentinel (shoreDistance < 0);
// GPU samples that touch an invalid texel fall back to plain-terrain semantics and
// self-correct once the worker-built tile arrives.
//
// The atlas texel lattice is the tile vertex lattice: texel (ix, iz) sits at world
// (originX + ix*cellSize, originZ + iz*cellSize) with cellSize = tileSizeM / tileRes and
// origin snapped to a tile corner, so filling a slot is a row-wise copy, never a resample.
import { gravelBarBodyPhase } from "./gravel_bar_field.js";
import type { HydrologyTile } from "./hydrologyTileSource.js";

/** Narrow tile-cache view the atlas consumes (implemented by HydrologySystem). */
export interface HydrologyTileAtlasSource {
  readonly tileSizeM: number;
  readonly tileRes: number;
  /** Configured atlas window edge in tiles; 0 disables the streaming atlas. */
  readonly atlasTilesPerSide: number;
  /** Resident tile lookup; must never build synchronously. */
  peek(tileX: number, tileZ: number): HydrologyTile | null;
  /** Queue worker builds for tiles the atlas window will need. */
  prefetch(centerX: number, centerZ: number, radiusM: number): void;
}

/** Texel rectangle (texel units) that changed this update and needs a GPU upload. */
export interface HydrologyAtlasDirtyRect {
  x: number;
  z: number;
  width: number;
  height: number;
}

/** Layout A alpha channel below this marks a texel with no tile data yet. */
export const HYDROLOGY_ATLAS_INVALID_SHORE_DISTANCE = -1;

export interface HydrologyStreamingAtlasOptions {
  tileSizeM: number;
  tileRes: number;
  tilesPerSide: number;
  includeBodyPhase?: boolean;
}

export interface HydrologyStreamingAtlasStats {
  recenters: number;
  filledTiles: number;
  totalTiles: number;
  texelUploads: number;
}

export class HydrologyStreamingAtlas {
  readonly tileSizeM: number;
  readonly tileRes: number;
  readonly tilesPerSide: number;
  /** Texels per atlas edge: tilesPerSide*tileRes cells plus the closing vertex row. */
  readonly res: number;
  readonly cellSize: number;
  /** Layout A texels, row-major (iz*res + ix)*4. */
  readonly data: Float32Array<ArrayBuffer>;
  /** Layout B texels, same lattice: R = flowX, G = flowZ, B = flowStrength,
   *  A = bodyKind. Validity is carried by Layout A's shoreDistance channel. */
  readonly dataB: Float32Array<ArrayBuffer>;
  /** Optional stone-only R32 phase plane derived from bodyId. */
  readonly bodyPhase: Float32Array<ArrayBuffer> | null;

  private originTileX = Number.NaN;
  private originTileZ = Number.NaN;
  private readonly filled: boolean[];
  private readonly stats: HydrologyStreamingAtlasStats;

  constructor(options: HydrologyStreamingAtlasOptions) {
    this.tileSizeM = Math.max(16, options.tileSizeM);
    this.tileRes = Math.max(4, Math.floor(options.tileRes));
    this.tilesPerSide = Math.max(1, Math.floor(options.tilesPerSide));
    this.res = this.tilesPerSide * this.tileRes + 1;
    this.cellSize = this.tileSizeM / this.tileRes;
    this.data = new Float32Array(this.res * this.res * 4);
    this.dataB = new Float32Array(this.res * this.res * 4);
    this.bodyPhase = options.includeBodyPhase ? new Float32Array(this.res * this.res) : null;
    this.filled = new Array<boolean>(this.tilesPerSide * this.tilesPerSide).fill(false);
    this.stats = { recenters: 0, filledTiles: 0, totalTiles: this.filled.length, texelUploads: 0 };
    this.invalidateAll();
  }

  /** World position of texel (0, 0). */
  get originX(): number {
    return this.originTileX * this.tileSizeM;
  }

  get originZ(): number {
    return this.originTileZ * this.tileSizeM;
  }

  get initialized(): boolean {
    return Number.isFinite(this.originTileX) && Number.isFinite(this.originTileZ);
  }

  currentStats(): HydrologyStreamingAtlasStats {
    return { ...this.stats, filledTiles: this.filled.filter(Boolean).length };
  }

  /**
   * Re-anchor the window around (centerX, centerZ) and copy in any resident tiles the
   * window is still missing. Returns the texel rects that changed (a single full-atlas
   * rect after a recenter). Cheap when idle: filled slots are skipped, unfilled slots
   * cost one Map lookup each.
   */
  update(centerX: number, centerZ: number, source: HydrologyTileAtlasSource): HydrologyAtlasDirtyRect[] {
    const wantedOriginTileX = Math.floor(centerX / this.tileSizeM) - (this.tilesPerSide >> 1);
    const wantedOriginTileZ = Math.floor(centerZ / this.tileSizeM) - (this.tilesPerSide >> 1);
    const recentred = wantedOriginTileX !== this.originTileX || wantedOriginTileZ !== this.originTileZ;
    if (recentred) {
      this.originTileX = wantedOriginTileX;
      this.originTileZ = wantedOriginTileZ;
      this.filled.fill(false);
      this.invalidateAll();
      this.stats.recenters++;
    }

    const dirty: HydrologyAtlasDirtyRect[] = [];
    for (let sz = 0; sz < this.tilesPerSide; sz++) {
      for (let sx = 0; sx < this.tilesPerSide; sx++) {
        const slot = sz * this.tilesPerSide + sx;
        if (this.filled[slot]) continue;
        const tile = source.peek(this.originTileX + sx, this.originTileZ + sz);
        if (!tile) continue;
        const rect = this.blitTile(tile, sx, sz);
        this.filled[slot] = true;
        if (!recentred) dirty.push(rect);
      }
    }
    if (recentred) return [{ x: 0, z: 0, width: this.res, height: this.res }];
    return dirty;
  }

  private invalidateAll(): void {
    this.data.fill(0);
    this.dataB.fill(0);
    this.bodyPhase?.fill(0);
    for (let i = 3; i < this.data.length; i += 4) {
      this.data[i] = HYDROLOGY_ATLAS_INVALID_SHORE_DISTANCE;
    }
  }

  /** Copy one tile's vertex arrays into its slot. Neighbouring slots share edge texels;
   *  overlapping writes carry identical values because tiles agree on shared edges. */
  private blitTile(tile: HydrologyTile, slotX: number, slotZ: number): HydrologyAtlasDirtyRect {
    const verts = tile.res + 1;
    const baseX = slotX * this.tileRes;
    const baseZ = slotZ * this.tileRes;
    const width = Math.min(verts, this.res - baseX);
    const height = Math.min(verts, this.res - baseZ);
    for (let iz = 0; iz < height; iz++) {
      const src = iz * verts;
      let dst = ((baseZ + iz) * this.res + baseX) * 4;
      let phaseDst = (baseZ + iz) * this.res + baseX;
      for (let ix = 0; ix < width; ix++) {
        const s = src + ix;
        this.data[dst] = tile.waterY[s];
        this.data[dst + 1] = tile.bodyMask[s];
        this.data[dst + 2] = tile.terrainY[s];
        this.data[dst + 3] = tile.shoreDistance[s];
        this.dataB[dst] = tile.flowX[s];
        this.dataB[dst + 1] = tile.flowZ[s];
        this.dataB[dst + 2] = tile.flowStrength[s];
        this.dataB[dst + 3] = tile.bodyKind[s];
        if (this.bodyPhase) this.bodyPhase[phaseDst] = gravelBarBodyPhase(tile.bodyId[s]);
        dst += 4;
        phaseDst += 1;
      }
    }
    this.stats.texelUploads += width * height;
    return { x: baseX, z: baseZ, width, height };
  }
}
