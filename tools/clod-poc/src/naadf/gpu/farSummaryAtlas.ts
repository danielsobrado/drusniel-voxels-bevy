import * as THREE from "three";
import type { FarSummaryTile } from "../types.js";
import type { NaadfWorldState } from "../summaryStreamer.js";

const DEFAULT_ATLAS_TILES_X = 3;
const DEFAULT_ATLAS_TILES_Z = 3;
const FLOAT_RGBA_COMPONENTS = 4;

export interface FarSummaryGpuAtlasView {
  readonly texture: THREE.DataTexture;
  originX: number;
  originZ: number;
  cellM: number;
  widthCells: number;
  heightCells: number;
  valid: number;
  revision: number;
}

export interface FarSummaryGpuAtlasOptions {
  tileCells: number;
  tilesX?: number;
  tilesZ?: number;
}

export class FarSummaryGpuAtlas {
  readonly view: FarSummaryGpuAtlasView;
  private readonly tileCells: number;
  private readonly tilesX: number;
  private readonly tilesZ: number;
  private readonly data: Float32Array;
  private lastSignature = "";

  constructor(options: FarSummaryGpuAtlasOptions) {
    this.tileCells = Math.max(1, Math.floor(options.tileCells));
    this.tilesX = Math.max(1, Math.floor(options.tilesX ?? DEFAULT_ATLAS_TILES_X));
    this.tilesZ = Math.max(1, Math.floor(options.tilesZ ?? DEFAULT_ATLAS_TILES_Z));
    const width = this.tileCells * this.tilesX;
    const height = this.tileCells * this.tilesZ;
    this.data = new Float32Array(width * height * FLOAT_RGBA_COMPONENTS);

    const texture = new THREE.DataTexture(this.data, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.name = "naadf-far-summary-height-atlas";
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    this.view = {
      texture,
      originX: 0,
      originZ: 0,
      cellM: 1,
      widthCells: width,
      heightCells: height,
      valid: 0,
      revision: 0,
    };
  }

  updateFromState(state: NaadfWorldState): void {
    const ringIndex = 0;
    const ring = state.config.farClipmap.rings[ringIndex];
    if (!ring || state.farTiles.size === 0) {
      this.invalidate();
      return;
    }

    const readyTiles = [...state.farTiles.values()]
      .filter((tile) => tile.key.ring === ringIndex && tile.state === "ready")
      .sort((a, b) => Math.hypot(a.originX - state.predictedX, a.originZ - state.predictedZ)
        - Math.hypot(b.originX - state.predictedX, b.originZ - state.predictedZ));

    if (readyTiles.length === 0) {
      this.invalidate();
      return;
    }

    const anchor = readyTiles[0]!;
    const minTileX = anchor.key.x - Math.floor(this.tilesX / 2);
    const minTileZ = anchor.key.z - Math.floor(this.tilesZ / 2);
    const selected = selectTiles(readyTiles, minTileX, minTileZ, this.tilesX, this.tilesZ);
    const signature = buildSignature(selected, minTileX, minTileZ, state.revision);
    if (signature === this.lastSignature) return;

    this.data.fill(0);
    for (const tile of selected) {
      this.blitTile(tile, tile.key.x - minTileX, tile.key.z - minTileZ);
    }

    const spanM = ring.cellM * this.tileCells;
    this.view.originX = minTileX * spanM;
    this.view.originZ = minTileZ * spanM;
    this.view.cellM = ring.cellM;
    this.view.valid = selected.length > 0 ? 1 : 0;
    this.view.revision++;
    this.view.texture.needsUpdate = true;
    this.lastSignature = signature;
  }

  dispose(): void {
    this.view.texture.dispose();
  }

  private invalidate(): void {
    if (this.view.valid === 0) return;
    this.view.valid = 0;
    this.view.revision++;
    this.data.fill(0);
    this.view.texture.needsUpdate = true;
    this.lastSignature = "";
  }

  private blitTile(tile: FarSummaryTile, tileX: number, tileZ: number): void {
    if (tileX < 0 || tileZ < 0 || tileX >= this.tilesX || tileZ >= this.tilesZ) return;
    const atlasWidth = this.view.widthCells;
    const baseX = tileX * this.tileCells;
    const baseZ = tileZ * this.tileCells;
    const copyCells = Math.min(this.tileCells, tile.resolution);

    for (let z = 0; z < copyCells; z++) {
      for (let x = 0; x < copyCells; x++) {
        const src = z * tile.resolution + x;
        const dst = ((baseZ + z) * atlasWidth + baseX + x) * FLOAT_RGBA_COMPONENTS;
        this.data[dst] = tile.avgHeight[src] ?? 0;
        this.data[dst + 1] = tile.minHeight[src] ?? 0;
        this.data[dst + 2] = tile.maxHeight[src] ?? 0;
        this.data[dst + 3] = 1;
      }
    }
  }
}

function selectTiles(
  tiles: FarSummaryTile[],
  minTileX: number,
  minTileZ: number,
  tilesX: number,
  tilesZ: number,
): FarSummaryTile[] {
  return tiles.filter((tile) =>
    tile.key.x >= minTileX
    && tile.key.x < minTileX + tilesX
    && tile.key.z >= minTileZ
    && tile.key.z < minTileZ + tilesZ,
  );
}

function buildSignature(
  tiles: FarSummaryTile[],
  minTileX: number,
  minTileZ: number,
  revision: number,
): string {
  const tileSig = tiles
    .map((tile) => `${tile.key.x},${tile.key.z},${tile.revision}`)
    .sort()
    .join("|");
  return `${minTileX}:${minTileZ}:${revision}:${tileSig}`;
}
