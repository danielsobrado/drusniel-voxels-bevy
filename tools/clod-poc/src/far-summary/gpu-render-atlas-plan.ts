import type { FarSummaryConfig, FarSummaryRingConfig } from "./config.js";
import type { StreamCenter } from "./stream-center.js";
import {
  FAR_SUMMARY_RENDER_ATLAS_TILES_X,
  FAR_SUMMARY_RENDER_ATLAS_TILES_Z,
} from "./gpu-render-atlas-constants.js";
import type { FarSummaryGpuRenderAtlasPlan } from "./gpu-render-atlas-types.js";

export function planFarSummaryGpuRenderAtlas(
  center: StreamCenter,
  config: Pick<FarSummaryConfig, "rings">,
  revision: number,
): FarSummaryGpuRenderAtlasPlan {
  const tileCells = commonFarSummaryRenderAtlasTileCells(config.rings);
  const ringHeightCells = tileCells * FAR_SUMMARY_RENDER_ATLAS_TILES_Z;
  const rings: FarSummaryGpuRenderAtlasPlan["rings"] = [];
  const tiles: FarSummaryGpuRenderAtlasPlan["tiles"] = [];
  const signatureParts: string[] = [];

  for (let ringIndex = 0; ringIndex < config.rings.length; ringIndex++) {
    const ring = config.rings[ringIndex]!;
    const tileSpanM = ring.cellM * ring.tileCells;
    const centerTileX = Math.floor(center.predictedX / tileSpanM);
    const centerTileZ = Math.floor(center.predictedZ / tileSpanM);
    const minTileX = centerTileX - Math.floor(FAR_SUMMARY_RENDER_ATLAS_TILES_X / 2);
    const minTileZ = centerTileZ - Math.floor(FAR_SUMMARY_RENDER_ATLAS_TILES_Z / 2);
    const rowOffsetCells = ringIndex * ringHeightCells;

    rings.push({
      originX: minTileX * tileSpanM,
      originZ: minTileZ * tileSpanM,
      cellM: ring.cellM,
      startM: ring.startM,
      endM: ring.endM,
      rowOffsetCells,
      widthCells: ring.tileCells * FAR_SUMMARY_RENDER_ATLAS_TILES_X,
      heightCells: ring.tileCells * FAR_SUMMARY_RENDER_ATLAS_TILES_Z,
      valid: 1,
    });
    signatureParts.push(`${ringIndex}:${minTileX}:${minTileZ}:${ring.cellM}:${ring.tileCells}`);

    for (let localZ = 0; localZ < FAR_SUMMARY_RENDER_ATLAS_TILES_Z; localZ++) {
      for (let localX = 0; localX < FAR_SUMMARY_RENDER_ATLAS_TILES_X; localX++) {
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

  return { signature: signatureParts.join(";"), rings, tiles };
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
