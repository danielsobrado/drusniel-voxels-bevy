import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import type { TreeFoliageAtlasStatus } from "./tree_system_assets_runtime.js";

export interface TreeFoliageAtlasDebugStatus {
  status: TreeFoliageAtlasStatus;
  reason: string | null;
  widthPx: number;
  heightPx: number;
  columns: number;
  rows: number;
  cellSize: number;
  mipmapped: boolean;
}

declare global {
  interface Window {
    __drusnielTreeFoliageAtlas?: TreeFoliageAtlasDebugStatus;
    __drusnielTreeFoliageAtlasTexture?: TreeFoliageAtlas["texture"];
  }
}

export function publishTreeFoliageAtlasDebugStatus(
  atlas: TreeFoliageAtlas,
  status: TreeFoliageAtlasStatus,
  reason: string | null,
): TreeFoliageAtlasDebugStatus {
  const image = atlas.texture.image as { width?: number; height?: number };
  const value: TreeFoliageAtlasDebugStatus = {
    status,
    reason,
    widthPx: Number(image.width ?? atlas.columns * atlas.cellSize),
    heightPx: Number(image.height ?? atlas.rows * atlas.cellSize),
    columns: atlas.columns,
    rows: atlas.rows,
    cellSize: atlas.cellSize,
    mipmapped: atlas.texture.generateMipmaps,
  };
  if (typeof window !== "undefined") {
    window.__drusnielTreeFoliageAtlas = value;
    window.__drusnielTreeFoliageAtlasTexture = atlas.texture;
  }
  return value;
}
