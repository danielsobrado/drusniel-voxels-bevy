// Water-owned streaming hydrology atlas (Phase W2).
//
// A second HydrologyStreamingAtlas window (independent of the vegetation one in
// gpu/hydrology_atlas_gpu.ts) that follows the *camera* and exposes its Layout A/B
// planes as THREE.DataTextures for the water clipmap's atlas-driven levels. Owning a
// separate window keeps a single writer per atlas (no recenter flip-flop between the
// camera and the vegetation ring center) and removes any init-order coupling with the
// vegetation GPU startup; both windows share the same worker-built tile cache, so the
// added cost is a few memcpy blits, not extra tile builds.
//
// The window is sized from the ring spans it must cover: with tile snapping, a window
// of N tiles guarantees coverage of ±((N>>1) * tileSizeM) around the center, so N is
// the smallest odd count with (N>>1)*tileSizeM >= the largest atlas-level half-span.
import * as THREE from "three";
import { HydrologyStreamingAtlas, type HydrologyTileAtlasSource } from "./hydrologyAtlas.js";
import type { WaterAtlasGridParams } from "./water_material_types.js";

export interface WaterHydrologyAtlasStats {
  recenters: number;
  filledTiles: number;
  totalTiles: number;
  textureUploads: number;
}

export function waterAtlasTilesPerSide(maxLevelHalfSpanM: number, tileSizeM: number): number {
  return 2 * Math.ceil(maxLevelHalfSpanM / Math.max(16, tileSizeM)) + 1;
}

export class WaterHydrologyAtlasRuntime {
  readonly atlas: HydrologyStreamingAtlas;
  private readonly source: HydrologyTileAtlasSource;
  private readonly prefetchRadiusM: number;
  private readonly textureA: THREE.DataTexture;
  private readonly textureB: THREE.DataTexture;
  private textureUploads = 0;

  constructor(source: HydrologyTileAtlasSource, tilesPerSide: number) {
    this.source = source;
    this.atlas = new HydrologyStreamingAtlas({
      tileSizeM: source.tileSizeM,
      tileRes: source.tileRes,
      tilesPerSide,
    });
    this.prefetchRadiusM = (tilesPerSide / 2) * source.tileSizeM;
    this.textureA = makeAtlasTexture(this.atlas.data, this.atlas.res, "water-hydrology-atlas-a");
    this.textureB = makeAtlasTexture(this.atlas.dataB, this.atlas.res, "water-hydrology-atlas-b");
  }

  /** Recenter/refill around the camera and mark the textures for upload when texels
   *  changed. Call once per frame before the clipmap update. */
  update(centerX: number, centerZ: number): void {
    this.source.prefetch(centerX, centerZ, this.prefetchRadiusM);
    const dirty = this.atlas.update(centerX, centerZ, this.source);
    if (dirty.length > 0) {
      this.textureA.needsUpdate = true;
      this.textureB.needsUpdate = true;
      this.textureUploads++;
    }
  }

  /** World position of atlas texel (0,0); null until the first update. */
  windowOrigin(): { x: number; z: number } | null {
    if (!this.atlas.initialized) return null;
    return { x: this.atlas.originX, z: this.atlas.originZ };
  }

  /** Largest ring half-span this window can guarantee after tile snapping. */
  get coveredHalfSpanM(): number {
    return (this.atlas.tilesPerSide >> 1) * this.atlas.tileSizeM;
  }

  materialParamsForLevel(levelCellSize: number): WaterAtlasGridParams {
    return {
      atlasA: this.textureA,
      atlasB: this.textureB,
      res: this.atlas.res,
      atlasCellSize: this.atlas.cellSize,
      levelCellSize,
    };
  }

  currentStats(): WaterHydrologyAtlasStats {
    const stats = this.atlas.currentStats();
    return {
      recenters: stats.recenters,
      filledTiles: stats.filledTiles,
      totalTiles: stats.totalTiles,
      textureUploads: this.textureUploads,
    };
  }

  dispose(): void {
    this.textureA.dispose();
    this.textureB.dispose();
  }
}

function makeAtlasTexture(data: Float32Array, res: number, name: string): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.FloatType);
  texture.name = name;
  // rgba32float is not filterable without an optional feature; the vertex stage reads
  // exact texels via textureLoad, so nearest/no-mips is both sufficient and required.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
