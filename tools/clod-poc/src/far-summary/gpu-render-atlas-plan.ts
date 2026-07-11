import type { FarSummaryConfig, FarSummaryRingConfig } from "./config.js";
import type { StreamCenter } from "./stream-center.js";
import { FAR_SUMMARY_RENDER_ATLAS_MIN_TILES_PER_SIDE } from "./gpu-render-atlas-constants.js";
import type { FarSummaryGpuRenderAtlasPlan } from "./gpu-render-atlas-types.js";

export function planFarSummaryGpuRenderAtlas(
  center: StreamCenter,
  config: Pick<FarSummaryConfig, "rings">,
  revision: number,
): FarSummaryGpuRenderAtlasPlan {
  const tileCells = commonFarSummaryRenderAtlasTileCells(config.rings);
  const tilesPerSide = farSummaryRenderAtlasTilesPerSide(config.rings);
  const ringHeightCells = tileCells * tilesPerSide;
  const rings: FarSummaryGpuRenderAtlasPlan["rings"] = [];
  const tiles: FarSummaryGpuRenderAtlasPlan["tiles"] = [];
  const signatureParts: string[] = [`tiles:${tilesPerSide}`];

  for (let ringIndex = 0; ringIndex < config.rings.length; ringIndex++) {
    const ring = config.rings[ringIndex]!;
    const tileSpanM = ring.cellM * ring.tileCells;
    const centerTileX = Math.floor(center.worldX / tileSpanM);
    const centerTileZ = Math.floor(center.worldZ / tileSpanM);
    const halfTiles = Math.floor(tilesPerSide / 2);
    const minTileX = centerTileX - halfTiles;
    const minTileZ = centerTileZ - halfTiles;
    const rowOffsetCells = ringIndex * ringHeightCells;

    rings.push({
      originX: minTileX * tileSpanM,
      originZ: minTileZ * tileSpanM,
      cellM: ring.cellM,
      startM: ring.startM,
      endM: ring.endM,
      rowOffsetCells,
      widthCells: ring.tileCells * tilesPerSide,
      heightCells: ring.tileCells * tilesPerSide,
      valid: 1,
    });
    signatureParts.push(`${ringIndex}:${minTileX}:${minTileZ}:${ring.cellM}:${ring.tileCells}`);

    for (let localZ = 0; localZ < tilesPerSide; localZ++) {
      for (let localX = 0; localX < tilesPerSide; localX++) {
        const tileX = minTileX + localX;
        const tileZ = minTileZ + localZ;
        tiles.push({
          ring: ringIndex,
          tileX,
          tileZ,
          cellSizeM: ring.cellM,
          tileCells: ring.tileCells,
          originX: tileX * tileSpanM,
          originZ: tileZ * tileSpanM,
          sizeX: tileSpanM,
          sizeZ: tileSpanM,
          revision,
          atlasX: localX * ring.tileCells,
          atlasY: rowOffsetCells + localZ * ring.tileCells,
        });
      }
    }
  }

  return { signature: signatureParts.join(";"), rings, tiles, tilesPerSide };
}

export function commonFarSummaryRenderAtlasTileCells(rings: readonly FarSummaryRingConfig[]): number {
  const first = rings[0]?.tileCells;
  if (!first || first <= 0) throw new Error("far-summary render atlas requires at least one ring");
  for (const ring of rings) {
    if (ring.tileCells !== first) {
      throw new Error("far-summary render atlas requires equal tileCells across rings");
    }
  }
  return first;
}

export function farSummaryRenderAtlasTilesPerSide(rings: readonly FarSummaryRingConfig[]): number {
  let required = FAR_SUMMARY_RENDER_ATLAS_MIN_TILES_PER_SIDE;
  for (const ring of rings) {
    const tileSpanM = ring.cellM * ring.tileCells;
    if (tileSpanM <= 0) throw new Error("far-summary render atlas requires positive ring tile spans");
    required = Math.max(required, Math.ceil(ring.endM / tileSpanM) * 2 + 1);
  }
  return required % 2 === 0 ? required + 1 : required;
}
