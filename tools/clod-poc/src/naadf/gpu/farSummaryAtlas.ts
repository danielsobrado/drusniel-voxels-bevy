import * as THREE from "three";
import type { FarSummaryTile } from "../types.js";
import type { NaadfWorldState } from "../summaryStreamer.js";

const DEFAULT_ATLAS_TILES_X = 3;
const DEFAULT_ATLAS_TILES_Z = 3;
const FLOAT_RGBA_COMPONENTS = 4;

export interface FarSummaryGpuAtlasRingView {
  originX: number;
  originZ: number;
  cellM: number;
  startM: number;
  endM: number;
  rowOffsetCells: number;
  widthCells: number;
  heightCells: number;
  valid: number;
}

export interface FarSummaryGpuAtlasView {
  readonly texture: THREE.DataTexture;
  readonly rings: FarSummaryGpuAtlasRingView[];
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
  ringCount?: number;
  tilesX?: number;
  tilesZ?: number;
}

export class FarSummaryGpuAtlas {
  readonly view: FarSummaryGpuAtlasView;
  private readonly tileCells: number;
  private readonly tilesX: number;
  private readonly tilesZ: number;
  private readonly ringCount: number;
  private readonly ringWidthCells: number;
  private readonly ringHeightCells: number;
  private readonly data: Float32Array;
  private lastSignature = "";

  constructor(options: FarSummaryGpuAtlasOptions) {
    this.tileCells = Math.max(1, Math.floor(options.tileCells));
    this.tilesX = Math.max(1, Math.floor(options.tilesX ?? DEFAULT_ATLAS_TILES_X));
    this.tilesZ = Math.max(1, Math.floor(options.tilesZ ?? DEFAULT_ATLAS_TILES_Z));
    this.ringCount = Math.max(1, Math.floor(options.ringCount ?? 1));
    this.ringWidthCells = this.tileCells * this.tilesX;
    this.ringHeightCells = this.tileCells * this.tilesZ;
    const width = this.ringWidthCells;
    const height = this.ringHeightCells * this.ringCount;
    this.data = new Float32Array(width * height * FLOAT_RGBA_COMPONENTS);

    const texture = new THREE.DataTexture(this.data, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.name = "naadf-far-summary-height-atlas";
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    this.view = {
      texture,
      rings: Array.from({ length: this.ringCount }, (_, ringIndex) => this.emptyRingView(ringIndex)),
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
    if (state.farTiles.size === 0 || state.config.farClipmap.rings.length === 0) {
      this.invalidate();
      return;
    }

    const signatureParts: string[] = [];
    const planned: Array<{
      ringIndex: number;
      minTileX: number;
      minTileZ: number;
      selected: FarSummaryTile[];
    }> = [];

    const maxRings = Math.min(this.ringCount, state.config.farClipmap.rings.length);
    for (let ringIndex = 0; ringIndex < maxRings; ringIndex++) {
      const readyTiles = [...state.farTiles.values()]
        .filter((tile) => tile.key.ring === ringIndex && tile.state === "ready")
        .sort((a, b) => Math.hypot(a.originX - state.predictedX, a.originZ - state.predictedZ)
          - Math.hypot(b.originX - state.predictedX, b.originZ - state.predictedZ));

      if (readyTiles.length === 0) {
        signatureParts.push(`${ringIndex}:missing`);
        planned.push({ ringIndex, minTileX: 0, minTileZ: 0, selected: [] });
        continue;
      }

      const anchor = readyTiles[0]!;
      const minTileX = anchor.key.x - Math.floor(this.tilesX / 2);
      const minTileZ = anchor.key.z - Math.floor(this.tilesZ / 2);
      const selected = selectTiles(readyTiles, minTileX, minTileZ, this.tilesX, this.tilesZ);
      planned.push({ ringIndex, minTileX, minTileZ, selected });
      signatureParts.push(buildRingSignature(ringIndex, selected, minTileX, minTileZ));
    }

    const signature = signatureParts.join(";");
    if (signature === this.lastSignature) return;

    this.data.fill(0);
    let validRings = 0;
    for (let ringIndex = 0; ringIndex < this.ringCount; ringIndex++) {
      const ring = state.config.farClipmap.rings[ringIndex];
      const plan = planned.find((entry) => entry.ringIndex === ringIndex);
      if (!ring || !plan || plan.selected.length === 0) {
        this.view.rings[ringIndex] = this.emptyRingView(ringIndex, ring);
        continue;
      }

      for (const tile of plan.selected) {
        this.blitTile(tile, tile.key.x - plan.minTileX, tile.key.z - plan.minTileZ, ringIndex);
      }

      const spanM = ring.cellM * this.tileCells;
      this.view.rings[ringIndex] = {
        originX: plan.minTileX * spanM,
        originZ: plan.minTileZ * spanM,
        cellM: ring.cellM,
        startM: ring.startM,
        endM: ring.endM,
        rowOffsetCells: ringIndex * this.ringHeightCells,
        widthCells: this.ringWidthCells,
        heightCells: this.ringHeightCells,
        valid: 1,
      };
      validRings++;
    }

    const firstValid = this.view.rings.find((ring) => ring.valid > 0) ?? this.view.rings[0]!;
    this.view.originX = firstValid.originX;
    this.view.originZ = firstValid.originZ;
    this.view.cellM = firstValid.cellM;
    this.view.valid = validRings > 0 ? 1 : 0;
    this.view.revision++;
    this.view.texture.needsUpdate = true;
    this.lastSignature = signature;
  }

  dispose(): void {
    this.view.texture.dispose();
  }

  private invalidate(): void {
    if (this.view.valid === 0 && this.lastSignature === "") return;
    this.view.valid = 0;
    this.view.revision++;
    this.data.fill(0);
    for (let ringIndex = 0; ringIndex < this.ringCount; ringIndex++) {
      this.view.rings[ringIndex] = this.emptyRingView(ringIndex);
    }
    this.view.texture.needsUpdate = true;
    this.lastSignature = "";
  }

  private blitTile(tile: FarSummaryTile, tileX: number, tileZ: number, ringIndex: number): void {
    if (tileX < 0 || tileZ < 0 || tileX >= this.tilesX || tileZ >= this.tilesZ) return;
    const atlasWidth = this.view.widthCells;
    const baseX = tileX * this.tileCells;
    const baseZ = ringIndex * this.ringHeightCells + tileZ * this.tileCells;
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

  private emptyRingView(ringIndex: number, ring?: { startM: number; endM: number; cellM: number }): FarSummaryGpuAtlasRingView {
    return {
      originX: 0,
      originZ: 0,
      cellM: ring?.cellM ?? 1,
      startM: ring?.startM ?? 0,
      endM: ring?.endM ?? 0,
      rowOffsetCells: ringIndex * this.ringHeightCells,
      widthCells: this.ringWidthCells,
      heightCells: this.ringHeightCells,
      valid: 0,
    };
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

function buildRingSignature(
  ringIndex: number,
  tiles: FarSummaryTile[],
  minTileX: number,
  minTileZ: number,
): string {
  const tileSig = tiles
    .map((tile) => `${tile.key.x},${tile.key.z},${tile.revision}`)
    .sort()
    .join("|");
  return `${ringIndex}:${minTileX}:${minTileZ}:${tileSig}`;
}
