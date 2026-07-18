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
import { gravelBarBodyPhase } from "./gravel_bar_field.js";
import type { HydrologyTile } from "./hydrologyTileSource.js";

export interface HydrologyTileAtlasSource {
  readonly tileSizeM: number;
  readonly tileRes: number;
  readonly atlasTilesPerSide: number;
  peek(tileX: number, tileZ: number): HydrologyTile | null;
  prefetch(centerX: number, centerZ: number, radiusM: number): void;
}

export interface HydrologyAtlasDirtyRect {
  x: number;
  z: number;
  width: number;
  height: number;
}

export const HYDROLOGY_ATLAS_INVALID_SHORE_DISTANCE = -1;

export interface HydrologyStreamingAtlasOptions {
  tileSizeM: number;
  tileRes: number;
  tilesPerSide: number;
  /** Vegetation-only option: encodes body phase below the half-unit round threshold.
   * Water-owned atlases leave this false and preserve raw body-kind values. */
  encodeBodyPhaseInKindLane?: boolean;
}

export interface HydrologyStreamingAtlasStats {
  recenters: number;
  filledTiles: number;
  totalTiles: number;
  texelUploads: number;
}

const BODY_PHASE_LANE_SCALE = 0.25;

export class HydrologyStreamingAtlas {
  readonly tileSizeM: number;
  readonly tileRes: number;
  readonly tilesPerSide: number;
  readonly res: number;
  readonly cellSize: number;
  readonly data: Float32Array<ArrayBuffer>;
  readonly dataB: Float32Array<ArrayBuffer>;

  private readonly encodeBodyPhaseInKindLane: boolean;
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
    this.encodeBodyPhaseInKindLane = options.encodeBodyPhaseInKindLane === true;
    this.filled = new Array<boolean>(this.tilesPerSide * this.tilesPerSide).fill(false);
    this.stats = { recenters: 0, filledTiles: 0, totalTiles: this.filled.length, texelUploads: 0 };
    this.invalidateAll();
  }

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
    for (let i = 3; i < this.data.length; i += 4) {
      this.data[i] = HYDROLOGY_ATLAS_INVALID_SHORE_DISTANCE;
    }
  }

  private blitTile(tile: HydrologyTile, slotX: number, slotZ: number): HydrologyAtlasDirtyRect {
    const verts = tile.res + 1;
    const baseX = slotX * this.tileRes;
    const baseZ = slotZ * this.tileRes;
    const width = Math.min(verts, this.res - baseX);
    const height = Math.min(verts, this.res - baseZ);
    for (let iz = 0; iz < height; iz++) {
      const src = iz * verts;
      let dst = ((baseZ + iz) * this.res + baseX) * 4;
      for (let ix = 0; ix < width; ix++) {
        const s = src + ix;
        this.data[dst] = tile.waterY[s];
        this.data[dst + 1] = tile.bodyMask[s];
        this.data[dst + 2] = tile.terrainY[s];
        this.data[dst + 3] = tile.shoreDistance[s];
        this.dataB[dst] = tile.flowX[s];
        this.dataB[dst + 1] = tile.flowZ[s];
        this.dataB[dst + 2] = tile.flowStrength[s];
        this.dataB[dst + 3] = this.encodeBodyPhaseInKindLane
          ? tile.bodyKind[s] + gravelBarBodyPhase(tile.bodyId[s]) * BODY_PHASE_LANE_SCALE
          : tile.bodyKind[s];
        dst += 4;
      }
    }
    this.stats.texelUploads += width * height;
    return { x: baseX, z: baseZ, width, height };
  }
}
